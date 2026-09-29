"""Where customer layers (text, logos) may go on each pattern piece.

Coordinates are panel millimetres at size M, origin at the piece's top-left.
Safe zones keep artwork at least ~20 mm inside every seam so nothing is cut
through or swallowed by stitching; they are convex, so a layer is safe when all
four corners of its (rotated) box are inside.
"""
from __future__ import annotations

import math

from ..schemas import DesignSpec, LogoElement, TextElement

TEXT_ASCENT = 0.35      # baseline sits this many font-sizes below the layer centre
TEXT_HEIGHT = 0.75      # cap height relative to font size
CHAR_WIDTH = 0.6        # average glyph advance relative to font size

_NECK_DEPTH = {"front": {"jersey": 90, "vneck": 150}, "back": {"jersey": 28, "vneck": 28}}


POLO_PLACKET_END = 150     # the button placket runs down the front to here (mm)


def safe_zone(garment: str, panel: str, sleeves: str = "short", collar: str = "crew") -> list[tuple[float, float]] | None:
    """Convex polygon for a customer-editable panel, or None when the panel takes no layers."""
    if panel not in ("front", "back"):
        return None
    if garment == "shorts":
        return [(70, 60), (570, 60), (595, 330), (45, 330)]
    top = _NECK_DEPTH[panel][garment] + 20
    if garment == "jersey" and collar == "polo" and panel == "front":
        top = max(top, POLO_PLACKET_END + 12)
    if sleeves == "none":
        # The deeper sleeveless armhole: stay 20 mm or more inside it and the narrower shoulders.
        # (Convex, like every zone: is_safe tests each edge.)
        top = max(top, 62)
        return [(165, top), (375, top), (500, 400), (500, 690), (40, 690), (40, 400)]
    return [(100, top), (440, top), (500, 270), (500, 690), (40, 690), (40, 270)]


def text_value(spec: DesignSpec, el: TextElement) -> str:
    t = spec.typography
    if el.bind == "team_name":
        return t.team_name.upper()
    if el.bind == "player_name":
        return t.player_name.upper()
    if el.bind == "number":
        return t.number
    return el.text


def element_size(spec: DesignSpec, el) -> tuple[float, float]:
    """Width and height in mm of a layer's unrotated box."""
    if isinstance(el, LogoElement):
        return el.width, el.width * el.aspect
    s = text_value(spec, el)
    natural = len(s) * el.size * CHAR_WIDTH
    max_w = getattr(el, "max_width", None)
    w = min(natural, max_w) if isinstance(max_w, (int, float)) and max_w > 0 else natural
    return w, el.size * TEXT_HEIGHT


def corners(spec: DesignSpec, el) -> list[tuple[float, float]]:
    w, h = element_size(spec, el)
    a = math.radians(el.rotation)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((el.x + dx * ca - dy * sa, el.y + dx * sa + dy * ca))
    return out


def _inside(poly: list[tuple[float, float]], p: tuple[float, float]) -> bool:
    sign = 0
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        cross = (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1)
        if abs(cross) < 1e-9:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True


def is_safe(spec: DesignSpec, el) -> bool:
    zone = safe_zone(spec.garment, el.panel, spec.sleeves, spec.collar)
    if zone is None:
        return False
    w, _ = element_size(spec, el)
    if w <= 0:      # empty text draws nothing
        return True
    return all(_inside(zone, c) for c in corners(spec, el))


def default_elements(spec: DesignSpec) -> list[dict]:
    """Bound team/player/number layers matching the classic placement."""
    if spec.garment == "shorts":
        return [{"id": "number_front", "type": "text", "bind": "number", "panel": "front",
                 "x": 150, "y": 382, "size": 80, "max_width": 140}]
    name_y = 217.5 if spec.garment == "vneck" else 187.5
    return [
        {"id": "team_front", "type": "text", "bind": "team_name", "panel": "front",
         "x": 270, "y": name_y, "size": 50, "max_width": 330},
        {"id": "number_front", "type": "text", "bind": "number", "panel": "front",
         "x": 270, "y": name_y + 108, "size": 120, "max_width": 220},
        {"id": "player_back", "type": "text", "bind": "player_name", "panel": "back",
         "x": 270, "y": 140, "size": 56, "max_width": 390},
        {"id": "number_back", "type": "text", "bind": "number", "panel": "back",
         "x": 270, "y": 369, "size": 240, "max_width": 400},
    ]


def uses_layers(spec: DesignSpec) -> bool:
    """Once the app switches a design to text layers (or any bound layer exists), the
    layers replace the classic name/number placement, even if every layer is later deleted."""
    if (spec.model_extra or {}).get("text_layers"):
        return True
    return any(isinstance(e, TextElement) and e.bind for e in spec.elements)
