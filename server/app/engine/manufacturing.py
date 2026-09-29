"""Manufacturing-readiness checks for dye-sublimation cut-and-sew garments."""
from __future__ import annotations

from ..schemas import MAX_LOGOS, Check, DesignSpec, LogoElement, TextElement
from . import layout
from .color import contrast_ratio, likely_out_of_gamut, luminance
from . import sizing

MIN_FEATURE_MM = 0.5      # below this, detail is lost to dye spread on polyester
MIN_TEXT_CONTRAST = 3.0   # numbers must be readable by referees / broadcast
TARGET_DPI = 300          # raster logos below this look soft at arm's length
MIN_DPI = 72              # below this they visibly pixelate; block release


def _label(spec: DesignSpec, el) -> str:
    if isinstance(el, LogoElement):
        return f"logo {el.name or el.id}".strip()
    if el.bind:
        return {"team_name": "team name", "player_name": "player name", "number": "number"}[el.bind]
    return f"text '{el.text}'"


def _art_scale(spec: DesignSpec, fit_size: str) -> float:
    """How much artwork grows on a size ("M" = Men's M, or "women:L", "kids:8Y")."""
    fit, _, size = fit_size.rpartition(":")
    fit = fit or "men"
    if not sizing.valid(fit, size):
        return 1.0
    kind = "shorts_front" if spec.garment == "shorts" else "front"
    return sizing.art_scale(*sizing.grade(kind, spec.sleeves, sizing.row(None, fit, size)))


def run_checks(spec: DesignSpec, min_feature_mm: float, sizes: list[str] | None = None) -> list[Check]:
    """sizes: the order sizes to check raster DPI against, as "M" (Men's) or "fit:size" such as "kids:8Y".
    The largest print is the worst case."""
    checks: list[Check] = []
    pal = spec.palette.model_dump()

    shifted = [f"{role} {hexv}" for role, hexv in pal.items() if likely_out_of_gamut(hexv)]
    if shifted:
        checks.append(Check(id="gamut", level="warn",
                            message="Likely outside CMYK sublimation gamut, expect a duller print: "
                                    + ", ".join(shifted) + ". Proof with the printer's ICC profile, or use fluorescent inks."))
    else:
        checks.append(Check(id="gamut", level="pass", message="All palette colours are within typical sublimation gamut."))

    t = spec.typography
    if layout.uses_layers(spec):
        shows_text = any(isinstance(e, TextElement) and e.bind and layout.text_value(spec, e) for e in spec.elements)
    else:
        shows_text = bool(t.number or t.team_name or t.player_name)
    if shows_text:
        cr = contrast_ratio(pal["text"], pal["primary"])
        level = "pass" if cr >= 4.5 else "warn" if cr >= MIN_TEXT_CONTRAST else "fail"
        checks.append(Check(id="text_contrast", level=level,
                            message=f"Name/number contrast vs base colour is {cr:.1f}:1 "
                                    f"(minimum {MIN_TEXT_CONTRAST}:1, 4.5:1 recommended)."))
        checks.append(Check(id="text_outlines", level="info",
                            message="Convert text to outlines in the RIP (or embed the licensed font) before printing."))

    if min_feature_mm == float("inf"):
        checks.append(Check(id="min_feature", level="pass", message="No fine detail in the artwork."))
    elif min_feature_mm < MIN_FEATURE_MM:
        checks.append(Check(id="min_feature", level="fail",
                            message=f"Smallest detail is {min_feature_mm:.2f} mm; sublimation needs at least {MIN_FEATURE_MM} mm."))
    else:
        checks.append(Check(id="min_feature", level="pass",
                            message=f"Smallest printed detail is {min_feature_mm:.1f} mm (min {MIN_FEATURE_MM} mm)."))

    checks += _layer_checks(spec, sizes or [])

    whites = [role for role, hexv in pal.items() if luminance(hexv) > 0.92]
    if whites:
        checks.append(Check(id="white_ink", level="info",
                            message=f"Sublimation has no white ink: {', '.join(whites)} will be the fabric itself, "
                                    "so the garment must be white polyester."))

    if any(isinstance(e, LogoElement) and e.kind == "raster" for e in spec.elements):
        checks.append(Check(id="vector", level="info",
                            message="Garment artwork is vector; uploaded raster logos print at their own resolution (see DPI checks)."))
    else:
        checks.append(Check(id="vector", level="pass",
                            message="Artwork is vector: prints sharp at any size; rasterise at 150-300 DPI if the RIP needs it."))
    pieces = "front and back" if spec.garment == "shorts" or spec.sleeves == "none" else \
        f"front, back and both {'long ' if spec.sleeves == 'long' else ''}sleeves"
    extra = " Sleeveless: armholes get a printed binding." if spec.garment != "shorts" and spec.sleeves == "none" else ""
    if spec.garment == "jersey" and spec.collar != "crew":
        extra += f" The {spec.collar} collar is knitted separately in the {spec.accents.collar_role} colour."
    checks.append(Check(id="panels", level="pass",
                        message=f"Artwork is laid out on the {pieces} pattern pieces, graded to the Men, Women and "
                                f"Kids size charts for cut-and-sew.{extra}"))
    checks.append(Check(id="fabric", level="info",
                        message="Use polyester of 65% or more (100% preferred). Pieces include 10 mm bleed past the magenta cut line."))
    return checks


def _layer_checks(spec: DesignSpec, sizes: list[str]) -> list[Check]:
    out: list[Check] = []
    unsafe = []
    for el in spec.elements:
        if not layout.is_safe(spec, el):
            unsafe.append(el)
            out.append(Check(id="seam_safe", level="fail", element_id=el.id,
                             message=f"The {_label(spec, el)} crosses a seam or the {el.panel} panel's safe print area. "
                                     "Move or shrink it inside the dashed line."))
    if spec.elements and not unsafe:
        out.append(Check(id="seam_safe", level="pass", message="All layers sit inside the seam-safe print areas."))

    for el in spec.elements:
        if isinstance(el, TextElement) and el.color and layout.text_value(spec, el):
            cr = contrast_ratio(el.color, spec.palette.primary)
            if cr < MIN_TEXT_CONTRAST:
                out.append(Check(id="layer_contrast", level="fail" if el.bind == "number" else "warn", element_id=el.id,
                                 message=f"The {_label(spec, el)} colour has {cr:.1f}:1 contrast against the base "
                                         f"(minimum {MIN_TEXT_CONTRAST}:1)."))

    logos = [e for e in spec.elements if isinstance(e, LogoElement)]
    worst = max(sizes, key=lambda s: _art_scale(spec, s)) if sizes else "M"
    scale = _art_scale(spec, worst)
    worst_label = worst.replace("men:", "").replace(":", " ")
    for el in logos:
        if el.kind == "vector":
            out.append(Check(id="logo_dpi", level="pass", element_id=el.id,
                             message=f"The {_label(spec, el)} is an SVG vector and prints sharp at any size."))
            continue
        if not el.pixel_width:
            out.append(Check(id="logo_dpi", level="warn", element_id=el.id,
                             message=f"The {_label(spec, el)} has no pixel size, so its print resolution is unknown."))
            continue
        printed_in = el.width * scale / 25.4
        dpi = el.pixel_width / printed_in
        level = "pass" if dpi >= TARGET_DPI else "warn" if dpi >= MIN_DPI else "fail"
        out.append(Check(id="logo_dpi", level=level, element_id=el.id,
                         message=f"The {_label(spec, el)} prints at {dpi:.0f} DPI on size {worst_label} "
                                 f"({el.width * scale:.0f} mm wide); {TARGET_DPI} DPI or more is recommended."
                                 + (f" Below {MIN_DPI} DPI it will pixelate." if level == "fail" else "")))
    if len(logos) > MAX_LOGOS:
        out.append(Check(id="logo_count", level="fail", message=f"At most {MAX_LOGOS} logos per design."))
    return out


def is_manufacturing_ready(checks: list[Check]) -> bool:
    return not any(c.level == "fail" for c in checks)
