"""Shared contract for every spec provider (rule engine, Claude, in-house SLM).

A provider receives the customer's GenerateRequest and returns N DesignSpecs.
The model-facing part of the spec (the "creative spec") is deliberately small
and closed-vocabulary so that a ~1B-parameter model can learn it from logged
data; see slm/README.md.
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod

from ..engine.color import best_text_color, contrast_ratio
from ..schemas import (COLOR_ROLES, COVERAGES, FONTS, HEX_RE, PATTERNS, Accents, DesignSpec, GenerateRequest,
                       Palette, PatternSpec, Typography)


class ProviderError(RuntimeError):
    pass


class SpecProvider(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def generate(self, req: GenerateRequest, n: int, seed: int) -> list[DesignSpec]: ...


# ------------------------------------------------------------------ prompting

SYSTEM_PROMPT = """You are a senior sportswear designer at a dye-sublimation factory. You turn a customer's brief into a compact JSON design spec; a deterministic renderer then draws it as vector artwork on the garment's pattern pieces.

What makes a design manufacturable, and therefore what the spec must respect:
- palette: five hex colours (#rrggbb) with roles. primary is the base fabric colour, secondary and accent drive the pattern and side panels, trim colours the collar, cuffs and waistband, and text colours names and numbers. text must contrast strongly with primary (4.5:1 or better) so referees and cameras can read numbers.
- Sublimation prints CMYK dyes on white polyester. Very saturated RGB neons print duller than on screen, and there is no white ink, so white areas are bare fabric.
- pattern.type is one of: stripes, pinstripe, chevron, camo, halftone, geometric, hexagon, waves, shards, splatter, topo, gradient. pattern.colors lists one to three palette roles used to draw it; avoid primary there because the pattern sits on top of primary. scale runs 0.4-2.5 (1 is standard), angle -90 to 90 degrees, density 0.1-1, opacity 0.15-1. coverage is one of: full, top, bottom, diagonal_band, side_panels, chest_band.
- A busy full-coverage pattern behind a back number hurts legibility: lower its opacity or pick a coverage that keeps the back centre calm.
- accents: side_panels (boolean), shoulder_stripes (0-3), collar_role and cuff_role (palette roles).
- font: block, athletic (collegiate slab) or modern (condensed).

Honour the colours, patterns, and cultural or regional references in the brief. style_name is a short evocative collection name. rationale is one or two sentences a customer would understand."""

SLM_SYSTEM_PROMPT = SYSTEM_PROMPT + """

Reply with exactly one JSON object with the keys: style_name, base ("solid" or "gradient"), palette {primary, secondary, accent, trim, text}, pattern {type, colors, scale, angle, density, opacity, coverage}, accents {side_panels, shoulder_stripes, collar_role, cuff_role}, font, rationale."""


def build_user_message(req: GenerateRequest, n: int = 1, variant_index: int | None = None) -> str:
    lines = [f"Brief: {req.prompt.strip()}",
             f"Garment: {req.garment}. Sport: {req.sport or 'not specified'}."]
    if req.team_name:
        lines.append(f"Team name: {req.team_name}.")
    if req.locked_colors:
        roles = ", ".join(f"{r}={c}" for r, c in zip(COLOR_ROLES, req.locked_colors))
        lines.append(f"Locked colours (must be used exactly): {roles}.")
    if n > 1 and variant_index is None:
        lines.append(f"Create {n} clearly different variants: vary the pattern type, palette emphasis and coverage.")
    if variant_index is not None and n > 1:
        lines.append(f"This is variant {variant_index + 1} of {n}; make it clearly different from a typical first idea.")
    return "\n".join(lines)


_role = {"type": "string", "enum": list(COLOR_ROLES)}
CREATIVE_SCHEMA: dict = {
    "type": "object", "additionalProperties": False,
    "required": ["style_name", "base", "palette", "pattern", "accents", "font", "rationale"],
    "properties": {
        "style_name": {"type": "string"},
        "base": {"type": "string", "enum": ["solid", "gradient"]},
        "palette": {"type": "object", "additionalProperties": False, "required": list(COLOR_ROLES),
                    "properties": {r: {"type": "string", "description": "hex colour #rrggbb"} for r in COLOR_ROLES}},
        "pattern": {"type": "object", "additionalProperties": False,
                    "required": ["type", "colors", "scale", "angle", "density", "opacity", "coverage"],
                    "properties": {
                        "type": {"type": "string", "enum": list(PATTERNS)},
                        "colors": {"type": "array", "items": _role},
                        "scale": {"type": "number"}, "angle": {"type": "number"},
                        "density": {"type": "number"}, "opacity": {"type": "number"},
                        "coverage": {"type": "string", "enum": list(COVERAGES)}}},
        "accents": {"type": "object", "additionalProperties": False,
                    "required": ["side_panels", "shoulder_stripes", "collar_role", "cuff_role"],
                    "properties": {"side_panels": {"type": "boolean"}, "shoulder_stripes": {"type": "integer"},
                                   "collar_role": _role, "cuff_role": _role}},
        "font": {"type": "string", "enum": list(FONTS)},
        "rationale": {"type": "string"},
    },
}

VARIANTS_SCHEMA: dict = {
    "type": "object", "additionalProperties": False, "required": ["variants"],
    "properties": {"variants": {"type": "array", "items": CREATIVE_SCHEMA}},
}


def creative_part(spec: DesignSpec) -> dict:
    """The model-facing subset of a spec, which is the SLM's training target."""
    return {
        "style_name": spec.style_name, "base": spec.base, "palette": spec.palette.model_dump(),
        "pattern": spec.pattern.model_dump(), "accents": spec.accents.model_dump(),
        "font": spec.typography.font, "rationale": spec.rationale,
    }


# ------------------------------------------------------------------ sanitising

_DEFAULT_PALETTE = {"primary": "#14213d", "secondary": "#1f5fbf", "accent": "#f5c518", "trim": "#0b1124", "text": "#f7f7f5"}


def _hex(v, fallback: str) -> str:
    s = str(v or "").strip().lower()
    if s and not s.startswith("#"):
        s = "#" + s
    if len(s) == 4:
        s = "#" + "".join(ch * 2 for ch in s[1:])
    return s if HEX_RE.match(s) else fallback


def _num(v, lo: float, hi: float, default: float) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def sanitize(raw: dict, req: GenerateRequest, seed: int) -> DesignSpec:
    """Coerce any provider's raw output into a valid, printable DesignSpec.

    Small models make small mistakes (bad hex, out-of-range numbers); this
    repairs them instead of discarding the whole design, and enforces the
    customer's locked colours and a legible text colour.
    """
    raw = raw if isinstance(raw, dict) else {}
    pal_in = raw.get("palette") if isinstance(raw.get("palette"), dict) else {}
    pal = {r: _hex(pal_in.get(r), _DEFAULT_PALETTE[r]) for r in COLOR_ROLES}
    for role, c in zip(("primary", "secondary", "accent", "trim"), req.locked_colors):
        pal[role] = c
    if contrast_ratio(pal["text"], pal["primary"]) < 3.0:
        pal["text"] = best_text_color(pal["primary"], [pal["text"], "#f7f7f5", "#111111", pal["accent"], pal["secondary"]])

    p = raw.get("pattern") if isinstance(raw.get("pattern"), dict) else {}
    cols = [c for c in (p.get("colors") or []) if c in COLOR_ROLES][:3] or ["secondary", "accent"]
    pattern = PatternSpec(
        type=p.get("type") if p.get("type") in PATTERNS else "stripes",
        colors=cols,
        scale=_num(p.get("scale"), 0.4, 2.5, 1.0), angle=_num(p.get("angle"), -90, 90, 0),
        density=_num(p.get("density"), 0.1, 1.0, 0.6), opacity=_num(p.get("opacity"), 0.15, 1.0, 0.9),
        coverage=p.get("coverage") if p.get("coverage") in COVERAGES else "full",
    )
    a = raw.get("accents") if isinstance(raw.get("accents"), dict) else {}
    accents = Accents(
        side_panels=bool(a.get("side_panels", False)),
        shoulder_stripes=int(_num(a.get("shoulder_stripes"), 0, 3, 0)),
        collar_role=a.get("collar_role") if a.get("collar_role") in COLOR_ROLES else "trim",
        cuff_role=a.get("cuff_role") if a.get("cuff_role") in COLOR_ROLES else "trim",
    )
    font = raw.get("font") or (raw.get("typography") or {}).get("font")
    typography = Typography(team_name=req.team_name, player_name=req.player_name, number=req.number,
                            font=font if font in FONTS else "block")
    return DesignSpec(
        garment=req.garment, sport=req.sport or "football",
        style_name=str(raw.get("style_name") or "Untitled")[:48],
        base="gradient" if raw.get("base") == "gradient" else "solid",
        palette=Palette(**pal), pattern=pattern, accents=accents, typography=typography,
        seed=seed % (2**31 - 1), rationale=str(raw.get("rationale") or "")[:600],
    )


def parse_json_object(text: str) -> dict:
    """Parse a JSON object, tolerating markdown fences a small model may add."""
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):]
    start, end = t.find("{"), t.rfind("}")
    if start < 0 or end < 0:
        raise ProviderError("model reply contained no JSON object")
    try:
        return json.loads(t[start:end + 1])
    except json.JSONDecodeError as e:
        raise ProviderError(f"model reply was not valid JSON: {e}") from e
