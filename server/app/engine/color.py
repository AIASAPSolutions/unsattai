"""Colour maths used by the renderer and the manufacturing checks."""
from __future__ import annotations

import colorsys
import math


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def rgb_to_hex(r: float, g: float, b: float) -> str:
    c = lambda v: max(0, min(255, round(v)))
    return f"#{c(r):02x}{c(g):02x}{c(b):02x}"


def mix(a: str, b: str, t: float) -> str:
    """Linear blend: t=0 -> a, t=1 -> b."""
    ra, ga, ba = hex_to_rgb(a)
    rb, gb, bb = hex_to_rgb(b)
    return rgb_to_hex(ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t)


def darken(h: str, t: float) -> str:
    return mix(h, "#000000", t)


def lighten(h: str, t: float) -> str:
    return mix(h, "#ffffff", t)


def rotate_hue(h: str, degrees: float, sat: float | None = None, val: float | None = None) -> str:
    r, g, b = (v / 255 for v in hex_to_rgb(h))
    hh, s, v = colorsys.rgb_to_hsv(r, g, b)
    hh = (hh + degrees / 360) % 1
    r, g, b = colorsys.hsv_to_rgb(hh, s if sat is None else sat, v if val is None else val)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def _lin(c: float) -> float:
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(h: str) -> float:
    r, g, b = (_lin(v) for v in hex_to_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def to_lab(h: str) -> tuple[float, float, float]:
    r, g, b = (_lin(v) for v in hex_to_rgb(h))
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def chroma_hue(h: str) -> tuple[float, float]:
    _, a, b = to_lab(h)
    return math.hypot(a, b), math.degrees(math.atan2(b, a)) % 360


# Approximate maximum Lab chroma reachable by CMYK sublimation inks on white
# polyester, by hue angle. Deliberately rough: the print shop's ICC profile
# is the final authority; this only flags colours that are likely to shift.
_GAMUT_LIMITS = [(0, 80), (40, 85), (70, 95), (100, 100), (140, 75),
                 (180, 55), (220, 50), (260, 60), (300, 70), (330, 80), (360, 80)]


def max_print_chroma(hue: float) -> float:
    for (h0, c0), (h1, c1) in zip(_GAMUT_LIMITS, _GAMUT_LIMITS[1:]):
        if h0 <= hue <= h1:
            return c0 + (c1 - c0) * (hue - h0) / (h1 - h0)
    return 80


def likely_out_of_gamut(h: str) -> bool:
    c, hue = chroma_hue(h)
    return c > max_print_chroma(hue)


def best_text_color(bg: str, candidates: list[str]) -> str:
    return max(candidates, key=lambda c: contrast_ratio(bg, c))
