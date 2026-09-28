"""Flat pattern pieces (size M, millimetres) for cut-and-sew sublimation.

These are simplified block patterns for the prototype. In production they are
replaced by the factory's own graded DXF/AAMA pattern pieces; the renderer only
needs each piece as an SVG path plus a few landmark lines.
"""
from __future__ import annotations

from dataclasses import dataclass

# Uniform grading factors relative to M. Real grading is not uniform (length and
# chest grade differently); swap in the factory's graded pieces for production.
SIZE_SCALE = {"XS": 0.88, "S": 0.94, "M": 1.0, "L": 1.06, "XL": 1.12, "XXL": 1.18}


@dataclass(frozen=True)
class Panel:
    name: str
    kind: str          # front | back | sleeve | shorts_front | shorts_back
    d: str             # outline path (cut line)
    w: float
    h: float
    neck: str | None = None    # neckline path, for collar trim
    cuff: str | None = None
    waist: str | None = None


_BODY_REST = "L480,45 C470,120 470,200 540,240 L540,720 L0,720 L0,240 C70,200 70,120 60,45 Z"
_NECK_CREW_FRONT = "M180,0 C185,70 235,90 270,90 C305,90 355,70 360,0"
_NECK_V_FRONT = "M180,0 L270,150 L360,0"
_NECK_BACK = "M180,0 C190,22 230,28 270,28 C310,28 350,22 360,0"

_SLEEVE = "M0,150 C60,40 160,0 230,0 C300,0 400,40 460,150 L410,260 L50,260 Z"
_SHORTS = "M40,0 L600,0 L620,300 L640,480 L370,480 L320,360 L270,480 L0,480 L20,300 Z"


def _body(name: str, kind: str, neck: str) -> Panel:
    return Panel(name, kind, f"{neck} {_BODY_REST}", 540, 720, neck=neck)


def _sleeve(name: str) -> Panel:
    return Panel(name, "sleeve", _SLEEVE, 460, 260, cuff="M50,260 L410,260")


GARMENT_PANELS: dict[str, list[Panel]] = {
    "jersey": [_body("front", "front", _NECK_CREW_FRONT), _body("back", "back", _NECK_BACK),
               _sleeve("sleeve_left"), _sleeve("sleeve_right")],
    "vneck": [_body("front", "front", _NECK_V_FRONT), _body("back", "back", _NECK_BACK),
              _sleeve("sleeve_left"), _sleeve("sleeve_right")],
    "shorts": [Panel("front", "shorts_front", _SHORTS, 640, 480, waist="M40,0 L600,0"),
               Panel("back", "shorts_back", _SHORTS, 640, 480, waist="M40,0 L600,0")],
}

# Mock-up sleeves: attached at the armhole (shoulder S, underarm U) and flaring
# out to the cuff (S2, U2). The 5th point tucks under the body so the concave
# armhole never shows a gap. Right sleeve; the left is mirrored.
MOCK_SLEEVE_RIGHT = ((480, 45), (650, 125), (660, 265), (540, 240), (440, 140))  # S, S2, U2, U, inner


def mirrored_sleeve() -> tuple[tuple[float, float], ...]:
    return tuple((540 - x, y) for x, y in MOCK_SLEEVE_RIGHT)
