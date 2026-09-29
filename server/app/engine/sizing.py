"""Size charts (Men, Women, Kids) and grading pattern pieces to a size.

Measurements are of the finished garment laid flat, in centimetres. The business
edits them in the operations app (settings section "sizing"); these are the
starting values. The size *lists* are fixed per fit so orders can be validated
without the database; only the measurements are editable.

Grading: the base pattern pieces in garments.py are drawn for Men's M. A piece is
stretched to a size with separate width and height factors taken from the chart
(chest and length for tops, sleeve length for sleeves, hip and length for shorts).
Artwork (names, numbers, logos) keeps its proportions: it moves with the piece
but scales uniformly, so lettering is never squashed.
"""
from __future__ import annotations

FIT_SIZES: dict[str, tuple[str, ...]] = {
    "men": ("XS", "S", "M", "L", "XL", "XXL", "3XL"),
    "women": ("XS", "S", "M", "L", "XL", "XXL"),
    "kids": ("4Y", "6Y", "8Y", "10Y", "12Y", "14Y"),
}
ALL_SIZES: tuple[str, ...] = tuple(dict.fromkeys(s for sizes in FIT_SIZES.values() for s in sizes))
FIT_NAMES = {"men": "Men / unisex", "women": "Women", "kids": "Kids"}

# The base pieces (Men's M) in mm, and the chart values they were drawn for (cm).
SEAM_ALLOWANCE_MM = 10          # each side of the body piece
REFERENCE = {"chest": 52, "length": 72, "sleeve_short": 20, "sleeve_long": 62, "hip": 54, "shorts_length": 48}


def _row(size, body_chest, height, chest, length, shoulder, s_short, s_long, waist, hip, s_len):
    return {"size": size, "body_chest": body_chest, "height": height,
            "top": {"chest": chest, "length": length, "shoulder": shoulder, "sleeve_short": s_short,
                    "sleeve_long": s_long},
            "shorts": {"waist": waist, "hip": hip, "length": s_len}}


# chest / waist / hip = half width laid flat. length = high point of shoulder to hem.
# body_chest = the wearer's chest, all round, that each size fits. height (kids) = the child's height.
DEFAULT_SIZING = {
    "unit": "cm",
    "tolerance_cm": 1.0,
    "note": "Garment measurements, laid flat. Chest, waist and hip are measured across (half the "
            "circumference). Length is from the highest point of the shoulder to the hem.",
    "fits": {
        "men": {"name": "Men / unisex", "sizes": [
            _row("XS", [84, 89], None, 46, 67, 42, 18, 58, 34, 50, 43),
            _row("S", [90, 95], None, 49, 70, 44, 19, 60, 36, 52, 44),
            _row("M", [96, 101], None, 52, 72, 46, 20, 62, 38, 54, 45),
            _row("L", [102, 107], None, 55, 74, 48, 21, 64, 40, 56, 46),
            _row("XL", [108, 113], None, 58, 76, 50, 22, 65, 43, 58, 47),
            _row("XXL", [114, 119], None, 61, 78, 52, 23, 66, 46, 60, 48),
            _row("3XL", [120, 127], None, 64, 80, 54, 24, 67, 49, 62, 49),
        ]},
        "women": {"name": "Women", "sizes": [
            _row("XS", [78, 82], None, 42, 62, 36, 15, 56, 32, 48, 36),
            _row("S", [83, 87], None, 44.5, 64, 37.5, 16, 57, 34, 50, 37),
            _row("M", [88, 92], None, 47, 66, 39, 17, 58, 36, 52, 38),
            _row("L", [93, 98], None, 49.5, 68, 40.5, 18, 59, 38, 54, 39),
            _row("XL", [99, 105], None, 52, 70, 42, 19, 60, 40, 56, 40),
            _row("XXL", [106, 112], None, 55, 72, 43.5, 20, 61, 43, 58, 41),
        ]},
        "kids": {"name": "Kids", "sizes": [
            _row("4Y", [54, 58], [98, 110], 32, 44, 28, 11, 36, 25, 34, 28),
            _row("6Y", [58, 62], [110, 122], 34, 48, 30, 12, 40, 26, 36, 30),
            _row("8Y", [62, 67], [122, 134], 36, 52, 32, 13, 44, 27, 38, 32),
            _row("10Y", [67, 72], [134, 146], 38, 56, 34, 14, 48, 28, 40, 34),
            _row("12Y", [72, 77], [146, 158], 41, 60, 36, 15, 52, 30, 43, 36),
            _row("14Y", [77, 82], [158, 170], 44, 64, 38, 16, 55, 32, 46, 38),
        ]},
    },
}


def valid(fit: str, size: str) -> bool:
    return size in FIT_SIZES.get(fit, ())


def row(sizing: dict | None, fit: str, size: str) -> dict:
    """The chart row for a fit and size (falls back to the defaults)."""
    for chart in (sizing or {}, DEFAULT_SIZING):
        for r in ((chart.get("fits") or {}).get(fit) or {}).get("sizes", []):
            if r.get("size") == size:
                return r
    raise ValueError(f"size {size!r} is not a {fit} size")


def grade(panel_kind: str, sleeves: str, r: dict) -> tuple[float, float]:
    """Width and height factors that take a Men's M base piece to the chart row r."""
    top, shorts = r["top"], r["shorts"]
    body_x = (top["chest"] * 10 + 2 * SEAM_ALLOWANCE_MM) / (REFERENCE["chest"] * 10 + 2 * SEAM_ALLOWANCE_MM)
    if panel_kind in ("front", "back"):
        return body_x, top["length"] / REFERENCE["length"]
    if panel_kind == "sleeve":
        key = "sleeve_long" if sleeves == "long" else "sleeve_short"
        return body_x, top[key] / REFERENCE[key]
    return shorts["hip"] / REFERENCE["hip"], shorts["length"] / REFERENCE["shorts_length"]


def art_scale(sx: float, sy: float) -> float:
    """Uniform scale for lettering and logos on a graded piece: follow the narrower direction."""
    return min(sx, sy)


def measurements(garment: str, sleeves: str, r: dict) -> dict:
    """The finished-garment measurements production needs for one line (cm)."""
    if garment == "shorts":
        return {k: r["shorts"][k] for k in ("waist", "hip", "length")}
    top = r["top"]
    out = {"chest": top["chest"], "length": top["length"], "shoulder": top["shoulder"]}
    if sleeves == "short":
        out["sleeve"] = top["sleeve_short"]
    elif sleeves == "long":
        out["sleeve"] = top["sleeve_long"]
    return out
