from __future__ import annotations

import logging
import random

from .config import settings
from .engine import i18n, layout
from .engine.garments import spec_panels
from .engine.manufacturing import is_manufacturing_ready, run_checks
from .engine.renderer import RenderCtx, panel_art, render_mockup
from .providers import PROVIDERS, ProviderError, parse_brief, resolve
from .schemas import DesignSpec, GenerateRequest
from .store import Store

log = logging.getLogger("design.service")


def render_preview(spec: DesignSpec, prefix: str | None = None, sizes: list[str] | None = None) -> dict:
    svg, ctx = render_mockup(spec, prefix)
    checks = run_checks(spec, ctx.min_feature_mm, sizes)
    return {"mockup_svg": svg, "checks": [c.model_dump() for c in checks],
            "manufacturing_ready": is_manufacturing_ready(checks)}


def _panel_note(spec: DesignSpec, p) -> str:
    """What the flat piece is, so a front piece without its sleeves doesn't read as sleeveless."""
    if p.kind in ("front", "back") and spec.garment != "shorts":
        if spec.sleeves == "none":
            note = "Sleeveless: the armholes are finished with a binding."
        else:
            note = f"Flat {p.kind} piece as printed. The {'long ' if spec.sleeves == 'long' else ''}sleeves are " \
                   "separate pieces, sewn on."
        if spec.garment == "jersey" and spec.collar != "crew":
            note += f" The {spec.collar} collar is knitted separately"
            note += " and the button placket is cut at the centre front, so keep text below it." \
                if spec.collar == "polo" and p.kind == "front" else "."
        return note
    if p.kind == "sleeve":
        return "Sleeves follow the jersey's colours and trim."
    return ""


def render_panels(spec: DesignSpec, include_elements: bool = True, sizes: list[str] | None = None) -> dict:
    """One SVG per pattern piece in panel millimetres (viewBox 0 0 w h), clipped to the cut line."""
    art_spec = spec if include_elements else spec.model_copy(update={"elements": []})
    if not include_elements and layout.uses_layers(spec):
        # keep classic typography out of the background too: the editor draws the bound layers itself
        art_spec = art_spec.model_copy(update={"typography": spec.typography.model_copy(
            update={"team_name": "", "player_name": "", "number": ""})})
    ctx = RenderCtx(art_spec, "pn")
    panels = []
    for p in spec_panels(spec):
        clip = ctx.uid("clip")
        before = len(ctx.defs)
        art = panel_art(ctx, p, pad=4)
        defs = "".join(ctx.defs[before:])
        side = {"front": "front", "shorts_front": "front", "back": "back", "shorts_back": "back"}.get(p.kind)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {p.w:g} {p.h:g}" width="{p.w:g}" height="{p.h:g}">'
               f'<defs>{defs}<clipPath id="{clip}"><path d="{p.d}"/></clipPath></defs>'
               f'<g clip-path="url(#{clip})">{art}</g>'
               f'<path d="{p.d}" fill="none" stroke="#0b0d10" stroke-opacity="0.5" stroke-width="2"/></svg>')
        zone = layout.safe_zone(spec.garment, side, spec.sleeves, spec.collar) if side else None
        panels.append({"name": p.name, "kind": p.kind, "side": side, "width": p.w, "height": p.h, "outline": p.d,
                       "svg": svg, "editable": zone is not None, "note": _panel_note(spec, p),
                       "safe_zone": [list(pt) for pt in zone] if zone else None})
    _, mctx = render_mockup(spec, "pc")
    checks = run_checks(spec, mctx.min_feature_mm, sizes)
    return {
        "garment": spec.garment,
        "panels": panels,
        "layers": [{"id": e.id, "panel": e.panel, "safe": layout.is_safe(spec, e),
                    "size": list(layout.element_size(spec, e)), "corners": [list(c) for c in layout.corners(spec, e)]}
                   for e in spec.elements],
        "default_elements": layout.default_elements(spec),
        "checks": [c.model_dump() for c in checks],
        "manufacturing_ready": is_manufacturing_ready(checks),
    }


def with_options(spec: DesignSpec, prompt: str, sleeves: str | None, collar: str | None) -> DesignSpec:
    from .understand import garment_options
    return spec.model_copy(update=garment_options(spec.garment, prompt, sleeves, collar))


def generate(store: Store, req: GenerateRequest) -> dict:
    if not req.sport:
        req = req.model_copy(update={"sport": parse_brief(i18n.normalize(req.prompt)).sport or "football"})
    seed = req.seed if req.seed is not None else random.randrange(2**31 - 1)
    wanted = req.provider or settings.provider
    provider = resolve(wanted)
    fallback_reason = None
    if not provider.available():
        fallback_reason = f"provider '{provider.name}' is not configured"
        provider = PROVIDERS["rule"]

    try:
        specs = provider.generate(req, req.variants, seed)
    except Exception as e:  # any provider failure degrades to the offline engine, never to an error page
        if provider.name == "rule":
            raise
        level = logging.WARNING if isinstance(e, ProviderError) else logging.ERROR
        log.log(level, "provider %s failed, falling back to rules: %s", provider.name, e, exc_info=level == logging.ERROR)
        fallback_reason = f"{provider.name} failed: {e}"
        provider = PROVIDERS["rule"]
        specs = provider.generate(req, req.variants, seed)

    if len(specs) < req.variants:
        specs += PROVIDERS["rule"].generate(req, req.variants - len(specs), seed + 1000)
    specs = [with_options(s, req.prompt, req.options.sleeves, req.options.collar) for s in specs]

    gid, ids = store.save_generation(req.model_dump(), provider.name, fallback_reason, specs)
    return {
        "generation_id": gid, "provider": provider.name, "requested_provider": wanted,
        "fallback_reason": fallback_reason, "seed": seed,
        "designs": [{"id": did, "variant_index": i, "spec": s.model_dump(), **render_preview(s, did)}
                    for i, (did, s) in enumerate(zip(ids, specs))],
    }
