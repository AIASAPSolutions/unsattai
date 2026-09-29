"""POST /designs/from-image: turn a picture designed elsewhere into an editable, printable design.

A picture from another AI tool is usually 1024-1536 px and full of fake lettering,
so it is never printed as-is. Instead it is recognised and rebuilt as a UrJersey
design: vector pattern pieces at full print resolution, real colours measured from
the picture's pixels, and names and numbers as exact text layers. That design then
goes through the same editor, manufacturing checks and print files as any other.

Two stages:
1. Pixels (free, always): cut away a plain background, measure the garment's main
   colours, and estimate stripes, direction, busy areas and gradients.
2. Vision model (when AI edits are on and the phone has allowance left): look at the
   picture and choose pattern, coverage, accents and colour roles. Its colours are
   snapped to the measured ones. Counts as one AI edit; the same picture is cached.

Up to three interpretations are returned so the customer can pick the closest.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import math
import time
from collections import deque

from PIL import Image, ImageOps

from . import ai_edit, service
from .engine.color import best_text_color, contrast_ratio, hex_to_rgb, rgb_to_hex, to_lab
from .providers.base import sanitize
from .schemas import PATTERNS, FromImageRequest, GenerateRequest
from .store import Store

log = logging.getLogger("urjersey.from_image")

MAX_IMAGE_BYTES = 6_000_000
MAX_PIXELS = 6000 * 6000
WORK_SIZE = 160          # analysis resolution (long side)
VISION_SIZE = 1024       # what the model sees (long side), keeps the call cheap


class ImageRejected(ValueError):
    pass


# ----------------------------------------------------------------- pixels

def _decode(data_url: str) -> tuple[Image.Image, bytes]:
    head, _, b64 = data_url.partition(",")
    if head not in ("data:image/png;base64", "data:image/jpeg;base64"):
        raise ImageRejected("Upload a PNG or JPEG picture.")
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError as e:
        raise ImageRejected("The picture could not be read.") from e
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageRejected("The picture is larger than 6 MB.")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.width * img.height > MAX_PIXELS:
            raise ImageRejected("The picture has too many pixels.")
        img = ImageOps.exif_transpose(img).convert("RGB")
    except ImageRejected:
        raise
    except Exception as e:  # truncated or not really an image
        raise ImageRejected("The picture could not be read.") from e
    return img, raw


def _pixels(img: Image.Image) -> list:
    # getdata() is deprecated in newer Pillow; get_flattened_data() does not exist in older ones.
    get = getattr(img, "get_flattened_data", None) or img.getdata
    return list(get())


def _dist(a, b) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _between(p, a, b) -> bool:
    """p lies close to the segment a-b in RGB, i.e. looks like a mix of a and b."""
    ab = [y - x for x, y in zip(a, b)]
    ap = [y - x for x, y in zip(a, p)]
    L2 = sum(v * v for v in ab)
    if L2 == 0:
        return False
    t = sum(x * y for x, y in zip(ap, ab)) / L2
    if not 0.1 < t < 0.9:
        return False
    closest = [x + t * v for x, v in zip(a, ab)]
    return _dist(p, closest) < 28


def _garment_mask(small: Image.Image) -> tuple[list[bool], bool]:
    """True for garment pixels. Background = plain colour connected to the border."""
    w, h = small.size
    px = small.load()
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + \
             [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    bg = tuple(sorted(c[i] for c in border)[len(border) // 2] for i in range(3))
    plain = sum(1 for c in border if _dist(c, bg) < 40) / len(border) > 0.7
    mask = [True] * (w * h)
    if plain:
        seen = [False] * (w * h)
        q = deque((x, y) for x in range(w) for y in (0, h - 1))
        q.extend((x, y) for y in range(h) for x in (0, w - 1))
        while q:
            x, y = q.popleft()
            i = y * w + x
            if seen[i]:
                continue
            seen[i] = True
            if _dist(px[x, y], bg) >= 40:
                continue
            mask[i] = False
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                    q.append((nx, ny))
        # Garment parts that match the background (white stripes on a white backdrop) touch the
        # border through the garment's sides; fill each column between its first and last garment pixel.
        for x in range(w):
            ys = [y for y in range(h) if mask[y * w + x]]
            for y in range(ys[0], ys[-1] + 1) if ys else ():
                mask[y * w + x] = True
    share = sum(mask) / len(mask)
    if not plain or share < 0.08 or share > 0.97:
        # Busy background or nothing found: use the centre of the picture.
        mask = [(w * 0.2 <= x <= w * 0.8 and h * 0.15 <= y <= h * 0.9) for y in range(h) for x in range(w)]
        plain = False
    return mask, plain


def _colours(small: Image.Image, mask: list[bool]) -> list[dict]:
    pixels = [c for c, m in zip(_pixels(small), mask) if m]
    strip = Image.new("RGB", (len(pixels), 1))
    strip.putdata(pixels)
    q = strip.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: 8 * 3]
    counts = sorted(q.getcolors(), reverse=True)
    found: list[dict] = []
    for n, idx in counts:
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        hexv = rgb_to_hex(*rgb)
        lab = to_lab(hexv)
        for f in found:  # merge near-identical shades
            if _dist(lab, f["lab"]) < 12:
                f["n"] += n
                break
        else:
            found.append({"hex": hexv, "lab": lab, "n": n})
    total = sum(f["n"] for f in found) or 1
    found.sort(key=lambda f: -f["n"])
    # Edge pixels (anti-aliasing, JPEG blur, downscaling) blend two neighbouring colours.
    # Drop a small colour that sits on the line between two bigger ones.
    kept: list[dict] = []
    for f in found:
        blend = any(_between(hex_to_rgb(f["hex"]), hex_to_rgb(a["hex"]), hex_to_rgb(b["hex"])) for i, a in enumerate(kept) for b in kept[i + 1:]
                    if a["n"] > f["n"] * 2 and b["n"] > f["n"] * 2)
        if not blend:
            kept.append(f)
    found = kept
    return [{"hex": f["hex"], "share": round(f["n"] / total, 3)} for f in found if f["n"] / total >= 0.01][:6]


def _structure(small: Image.Image, mask: list[bool]) -> dict:
    """Edge density and direction inside the garment, and where the busy areas are."""
    w, h = small.size
    g = _pixels(small.convert("L"))
    # Shrink the mask so the garment's own outline doesn't count as pattern.
    for _ in range(3):
        mask = [m and 0 < i % w < w - 1 and mask[i - 1] and mask[i + 1] and w <= i < len(mask) - w
                and mask[i - w] and mask[i + w] for i, m in enumerate(mask)]
    ys = [i // w for i, m in enumerate(mask) if m]
    y0, y1 = (min(ys), max(ys) + 1) if ys else (0, h)
    bins = {"vertical": 0, "horizontal": 0, "diag_up": 0, "diag_down": 0}
    rows = [0] * 10
    rows_all = [0] * 10
    strong = inside = 0
    lum_by_row: list[list[int]] = [[] for _ in range(h)]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            if not (mask[i] and mask[i - 1] and mask[i + 1] and mask[i - w] and mask[i + w]):
                continue
            inside += 1
            lum_by_row[y].append(g[i])
            third = min(9, max(0, (y - y0) * 10 // max(1, y1 - y0)))
            rows_all[third] += 1
            gx = g[i + 1] - g[i - 1]
            gy = g[i + w] - g[i - w]
            if abs(gx) + abs(gy) < 60:
                continue
            strong += 1
            rows[third] += 1
            a = math.degrees(math.atan2(gy, gx)) % 180    # direction of change, 0 = left-right
            if a < 22.5 or a >= 157.5:
                bins["vertical"] += 1          # change across x: vertical lines
            elif 67.5 <= a < 112.5:
                bins["horizontal"] += 1
            elif a < 67.5:
                bins["diag_down"] += 1
            else:
                bins["diag_up"] += 1
    density = strong / inside if inside else 0.0
    means = [sum(r) / len(r) for r in lum_by_row if len(r) > 3]
    ramp = (max(means) - min(means)) if len(means) > 4 else 0.0
    dominant, top = max(bins.items(), key=lambda kv: kv[1])
    return {"density": round(density, 3), "direction": dominant,
            "directional": round(top / strong, 2) if strong else 0.0,
            "busy_rows": [round(rows[i] / rows_all[i], 3) if rows_all[i] else 0.0 for i in range(10)],
            "ramp": round(ramp, 1)}


def _guess(colours: list[dict], s: dict) -> dict:
    """Pixel-only interpretation: pattern candidates, coverage, base and palette."""
    hexes = [c["hex"] for c in colours] or ["#14213d"]
    primary = hexes[0]
    secondary = hexes[1] if len(hexes) > 1 else best_text_color(primary, ["#f7f7f5", "#111111"])
    rest = hexes[2:]
    # accent: the most colourful of the smaller colours, else the secondary
    accent = max(rest, key=lambda c: math.hypot(*to_lab(c)[1:])) if rest else secondary
    trim = min(hexes, key=lambda c: to_lab(c)[0])       # collars are usually the darkest colour
    palette = {"primary": primary, "secondary": secondary, "accent": accent, "trim": trim,
               "text": best_text_color(primary, ["#f7f7f5", "#111111", accent])}

    d, direction, directional = s["density"], s["direction"], s["directional"]
    busy = s["busy_rows"]      # edge rate in 10 horizontal slices, top to bottom
    peak = max(busy)
    hot = [i for i, b in enumerate(busy) if peak and b > 0.3 * peak]
    # Pattern only in one part of the garment (a chest band, a busy top): a band, even if it is small overall.
    band = d >= 0.008 and bool(hot) and hot[-1] - hot[0] + 1 <= 5
    coverage = "full"
    if band:
        centre = (hot[0] + hot[-1] + 1) / 20
        coverage = "top" if centre < 0.3 else "bottom" if centre > 0.7 else "chest_band"
    candidates: list[tuple[str, float]] = []
    base = "solid"
    plain = False
    if d < 0.03 and not band:
        plain = True
        if s["ramp"] > 40:
            base = "gradient"
            candidates = [("gradient", 0)]
        candidates += [("pinstripe", 0), ("waves", 0)]
    elif directional > 0.5:
        angle = {"vertical": 0, "horizontal": 90, "diag_up": 45, "diag_down": -45}[direction]
        candidates = [("pinstripe" if d < 0.08 and not band else "stripes", angle), ("chevron", angle),
                      ("shards", angle)]
    elif d > 0.25:
        candidates = [("camo", 0), ("splatter", 0), ("geometric", 0)]
    else:
        candidates = [("geometric", 0), ("hexagon", 0), ("topo", 0)]
    return {"palette": palette, "base": base, "coverage": coverage, "candidates": candidates[:3],
            "opacity": 0.2 if plain else 0.9}


# ----------------------------------------------------------------- vision model

VISION_PROMPT = """You are recognising a sportswear design from a picture so it can be rebuilt for sublimation
printing. Look at the garment only (ignore people, backgrounds, mannequins and any lettering or logos).
Describe it with the fields below. Use the measured colours (hex, share of the garment) for the palette:
primary = main body colour, secondary = pattern and panels, accent = small bright details, trim = collar and
cuffs, text = the colour that would be readable for names and numbers on the body.
Pick the closest pattern type and 2 alternatives from the allowed list, the area it covers, its angle
(0 = vertical lines, 90 = horizontal hoops, 45 or -45 = diagonal), scale (0.4 small to 2.5 large), density
(0.1 sparse to 1 dense) and opacity (0.15 faint to 1 bold). Set is_garment false if the picture is not a
garment or garment design. For a top, also return sleeves (short, long, or none for a sleeveless vest) and
collar (crew for a round neck, polo, or mandarin for a stand-up band) as changes, as seen in the picture.
text_seen: any words or numbers printed on the garment, exactly as seen.
notes: one short sentence in the customer's language about what you recognised."""

VISION_SCHEMA = {
    "type": "object",
    "properties": {
        "is_garment": {"type": "boolean"},
        "garment_seen": {"type": "string", "enum": ["jersey", "vneck", "shorts", "other"]},
        "changes": ai_edit.OUTPUT_SCHEMA["properties"]["changes"],
        "alternatives": {"type": "array", "items": {"type": "string", "enum": list(PATTERNS)}},
        "text_seen": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": ["is_garment", "garment_seen", "changes", "alternatives", "text_seen", "notes"],
    "additionalProperties": False,
}


def _vision_jpeg(img: Image.Image) -> str:
    v = img.copy()
    v.thumbnail((VISION_SIZE, VISION_SIZE))
    buf = io.BytesIO()
    v.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def _ask_claude_vision(jpeg_b64: str, colours: list[dict], req: FromImageRequest) -> dict:
    import anthropic

    from .engine import i18n

    lang = i18n.LANGUAGE_NAMES.get(req.language, ("English",))[0]
    text = (f"Garment ordered: {req.garment}. Customer language: {lang}.\n"
            f"Measured colours: {json.dumps(colours)}")
    try:
        response = ai_edit._claude_client().messages.create(
            model=ai_edit.settings.ai_edit_model,
            max_tokens=900,
            system=VISION_PROMPT,
            output_config={"format": {"type": "json_schema", "schema": VISION_SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": jpeg_b64}},
                {"type": "text", "text": text},
            ]}],
        )
    except anthropic.AnthropicError as e:
        raise ai_edit.AIError(str(e)) from e
    if response.stop_reason in ("refusal", "max_tokens"):
        raise ai_edit.AIError(f"stopped: {response.stop_reason}")
    out = next((b.text for b in response.content if b.type == "text"), None)
    if out is None:
        raise ai_edit.AIError("no text in reply")
    return json.loads(out)


def ask_vision(jpeg_b64: str, colours: list[dict], req: FromImageRequest) -> dict:
    """Swapped out in tests. Only Claude can see pictures; an SLM setup uses pixels only."""
    if ai_edit.provider() != "claude":
        raise ai_edit.AIError("vision needs AI_EDITS=claude")
    return _ask_claude_vision(jpeg_b64, colours, req)


def _snap(hexv: str, colours: list[dict]) -> str:
    """Keep the model's colour choices tied to colours really in the picture."""
    if not colours:
        return hexv
    lab = to_lab(hexv)
    nearest = min(colours, key=lambda c: _dist(lab, to_lab(c["hex"])))
    return nearest["hex"] if _dist(lab, to_lab(nearest["hex"])) < 25 else hexv


# ----------------------------------------------------------------- endpoint

def from_image(store: Store, req: FromImageRequest, device: str) -> dict:
    img, raw = _decode(req.image)
    small = img.copy()
    small.thumbnail((WORK_SIZE, WORK_SIZE))
    mask, plain_bg = _garment_mask(small)
    colours = _colours(small, mask)
    structure = _structure(small, mask)
    guess = _guess(colours, structure)

    warnings: list[str] = []
    if not plain_bg:
        warnings.append("busy_background")
    if min(img.size) < 400:
        warnings.append("small_picture")

    # ---- vision (optional, counted, cached)
    status = ai_edit.allowance(store, device)
    vision, source, cached = None, "pixels", False
    if status["enabled"] and ai_edit.provider() == "claude":
        key = "img:" + hashlib.sha256(raw + b"v2" + req.garment.encode() + req.language.encode()
                                      + ai_edit.settings.ai_edit_model.encode()).hexdigest()
        vision = store.ai_cache_get(key)
        cached = vision is not None
        if vision is None:
            try:
                status = ai_edit._check(store, device)
                vision = ask_vision(_vision_jpeg(img), colours, req)
                store.ai_record_call(device, ai_edit._today(), time.time())
                store.ai_cache_put(key, vision)
                status = ai_edit.allowance(store, device)
            except ai_edit.QuotaExceeded:
                warnings.append("ai_limit")
            except (ai_edit.AIError, json.JSONDecodeError) as e:
                log.warning("vision failed: %s", e)
                warnings.append("ai_unavailable")
        if vision is not None:
            source = "ai"

    # ---- build interpretations
    raw_spec = {"palette": dict(guess["palette"]), "base": guess["base"],
                "pattern": {"coverage": guess["coverage"], "opacity": guess["opacity"], "scale": 1.0, "density": 0.6},
                "style_name": "From your picture"}
    candidates = list(guess["candidates"])
    recognised = {"garment_seen": None, "text_seen": [], "notes": ""}
    if vision:
        if not vision.get("is_garment", True):
            warnings.append("not_garment")
        recognised = {"garment_seen": vision.get("garment_seen"), "text_seen": vision.get("text_seen") or [],
                      "notes": str(vision.get("notes") or "")[:300]}
        for c in vision.get("changes") or []:
            field, value = c.get("field"), c.get("value", "")
            if field not in ai_edit.FIELDS or field.startswith("typography.") or field == "sport":
                continue  # names/numbers come from the order form, never from lettering in a picture
            v = ai_edit._coerce(field, value, "")
            if v is None:
                continue
            if field.startswith("palette."):
                v = _snap(v, colours)
            section, _, leaf = field.partition(".")
            if leaf:
                raw_spec.setdefault(section, {})[leaf] = v
            else:
                raw_spec[section] = v
        main = raw_spec.get("pattern", {}).get("type")
        angle = raw_spec.get("pattern", {}).get("angle", 0)
        alts = [a for a in vision.get("alternatives") or [] if a in PATTERNS and a != main]
        if main in PATTERNS:
            candidates = [(main, angle)] + [(a, angle) for a in alts] + [c for c in candidates if c[0] not in alts and c[0] != main]
        if recognised["text_seen"]:
            warnings.append("text_not_copied")
    if vision and recognised["garment_seen"] in ("jersey", "vneck", "shorts") and recognised["garment_seen"] != req.garment:
        warnings.append("garment_differs")

    pal = raw_spec["palette"]
    if contrast_ratio(pal["text"], pal["primary"]) < 3.0:
        pal["text"] = best_text_color(pal["primary"], [pal["text"], "#f7f7f5", "#111111", pal["accent"]])

    gen_req = GenerateRequest(prompt="picture upload", garment=req.garment, sport=req.sport or "football",
                              team_name=req.team_name, player_name=req.player_name, number=req.number,
                              variants=3, language=req.language)
    specs, seen = [], set()
    for ptype, angle in candidates:
        if ptype in seen or len(specs) == 3:
            continue
        seen.add(ptype)
        spec_raw = json.loads(json.dumps(raw_spec))
        spec_raw["pattern"] = {**spec_raw.get("pattern", {}), "type": ptype, "angle": angle}
        if ptype == "gradient":
            spec_raw["base"] = "gradient"
        specs.append(sanitize(spec_raw, gen_req, seed=len(specs) + 1))
    # Sleeves and collar: the customer's choice, else what the picture shows, else the defaults.
    seen_opts = {k: raw_spec.get(k) for k in ("sleeves", "collar")}
    specs = [service.with_options(sp, "", req.options.sleeves or seen_opts["sleeves"],
                                  req.options.collar or seen_opts["collar"]) for sp in specs]

    request_log = {"kind": "from_image", "image_sha256": hashlib.sha256(raw).hexdigest(), "garment": req.garment,
                   "sport": req.sport, "colours": colours, "structure": structure, "vision": vision}
    gid, ids = store.save_generation(request_log, f"image:{source}", None, specs)
    return {
        "generation_id": gid, "provider": f"image:{source}", "source": source,
        "colors": colours, "recognised": {**recognised, "pattern": specs[0].pattern.type,
                                          "coverage": specs[0].pattern.coverage, "base": specs[0].base,
                                          "sleeves": specs[0].sleeves, "collar": specs[0].collar},
        "warnings": warnings, "ai": {**status, "cached": cached},
        "designs": [{"id": did, "variant_index": i, "spec": s.model_dump(), **service.render_preview(s, did)}
                    for i, (did, s) in enumerate(zip(ids, specs))],
    }
