"""POST /logos/suggest: procedural crest ideas as vector SVG.

Every suggestion is deterministic for the same team, sport and index, so paging
("load more") never reshuffles what the customer already saw. Output is plain
SVG so it prints sharp at any size.
"""
from __future__ import annotations

import base64
import hashlib
import math
import random
from xml.sax.saxutils import escape

from .engine.color import best_text_color, contrast_ratio, darken
from .schemas import LogoSuggestRequest

MAX_SUGGESTIONS = 64
_DEFAULT = {"primary": "#14213d", "secondary": "#1f5fbf", "accent": "#f5c518", "trim": "#0b1124", "text": "#f7f7f5"}

SHAPES = ["shield", "roundel", "hexagon", "diamond", "star", "pennant", "square", "chevron"]
EMBLEMS = ["initials", "star", "bolt", "ball", "wings", "crown", "flame", "stripes"]


def _f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def _poly(pts) -> str:
    return " ".join(f"{_f(x)},{_f(y)}" for x, y in pts)


def _regular(n: int, r: float, rot: float = -90, cx: float = 100, cy: float = 100):
    return [(cx + r * math.cos(math.radians(rot + 360 * i / n)), cy + r * math.sin(math.radians(rot + 360 * i / n)))
            for i in range(n)]


def _shape(kind: str, fill: str, stroke: str) -> tuple[str, tuple[float, float, float]]:
    """Outline markup plus the emblem box (cx, cy, size) that fits inside it."""
    s = f'fill="{fill}" stroke="{stroke}" stroke-width="8" stroke-linejoin="round"'
    if kind == "shield":
        return f'<path d="M100,12 L176,36 L170,110 C164,150 132,176 100,190 C68,176 36,150 30,110 L24,36 Z" {s}/>', (100, 92, 90)
    if kind == "roundel":
        return (f'<circle cx="100" cy="100" r="86" {s}/><circle cx="100" cy="100" r="68" fill="none" '
                f'stroke="{stroke}" stroke-width="3"/>'), (100, 100, 88)
    if kind == "hexagon":
        return f'<polygon points="{_poly(_regular(6, 88, -90))}" {s}/>', (100, 100, 96)
    if kind == "diamond":
        return f'<polygon points="100,10 190,100 100,190 10,100" {s}/>', (100, 100, 80)
    if kind == "star":
        pts = []
        for i in range(16):
            r = 90 if i % 2 == 0 else 72
            a = math.radians(-90 + i * 22.5)
            pts.append((100 + r * math.cos(a), 100 + r * math.sin(a)))
        return f'<polygon points="{_poly(pts)}" {s}/>', (100, 100, 92)
    if kind == "pennant":
        return f'<path d="M30,18 L170,18 L170,130 L100,188 L30,130 Z" {s}/>', (100, 88, 96)
    if kind == "square":
        return f'<rect x="18" y="18" width="164" height="164" rx="34" {s}/>', (100, 100, 104)
    return f'<path d="M24,20 L176,20 L176,120 L100,186 L24,120 Z M24,70 L100,120 L176,70" {s}/>', (100, 80, 84)


def _emblem(kind: str, cx: float, cy: float, size: float, fg: str, accent: str, initials: str, sport: str) -> str:
    h = size / 2
    if kind == "initials" and initials:
        fs = size * (0.62 if len(initials) <= 2 else 0.46)
        return (f'<text x="{_f(cx)}" y="{_f(cy + fs * 0.35)}" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" '
                f'font-weight="900" font-size="{_f(fs)}" fill="{fg}">{escape(initials)}</text>')
    if kind == "star" or (kind == "initials" and not initials):
        pts = []
        for i in range(10):
            r = h * (0.95 if i % 2 == 0 else 0.4)
            a = math.radians(-90 + i * 36)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        return f'<polygon points="{_poly(pts)}" fill="{fg}"/>'
    if kind == "bolt":
        pts = [(0.15, -1), (-0.55, 0.12), (-0.02, 0.12), (-0.25, 1), (0.55, -0.2), (0.02, -0.2), (0.3, -1)]
        return f'<polygon points="{_poly((cx + x * h * 0.8, cy + y * h * 0.9) for x, y in pts)}" fill="{fg}"/>'
    if kind == "ball":
        r = h * 0.8
        base = f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(r)}" fill="{fg}"/>'
        line = f'fill="none" stroke="{accent}" stroke-width="{_f(r * 0.1)}"'
        if sport in ("basketball", "netball"):
            return base + (f'<path d="M{_f(cx - r)},{_f(cy)} H{_f(cx + r)} M{_f(cx)},{_f(cy - r)} V{_f(cy + r)} '
                           f'M{_f(cx - r * 0.7)},{_f(cy - r * 0.7)} Q{_f(cx)},{_f(cy)} {_f(cx - r * 0.7)},{_f(cy + r * 0.7)} '
                           f'M{_f(cx + r * 0.7)},{_f(cy - r * 0.7)} Q{_f(cx)},{_f(cy)} {_f(cx + r * 0.7)},{_f(cy + r * 0.7)}" {line}/>')
        if sport in ("cricket", "hockey", "badminton"):
            return base + (f'<path d="M{_f(cx - r * 0.5)},{_f(cy - r * 0.85)} Q{_f(cx - r * 0.1)},{_f(cy)} {_f(cx - r * 0.5)},{_f(cy + r * 0.85)} '
                           f'M{_f(cx + r * 0.5)},{_f(cy - r * 0.85)} Q{_f(cx + r * 0.1)},{_f(cy)} {_f(cx + r * 0.5)},{_f(cy + r * 0.85)}" {line}/>')
        pent = _regular(5, r * 0.38, -90, cx, cy)
        return base + f'<polygon points="{_poly(pent)}" fill="{accent}"/>' + "".join(
            f'<line x1="{_f(x)}" y1="{_f(y)}" x2="{_f(cx + (x - cx) * 2.3)}" y2="{_f(cy + (y - cy) * 2.3)}" {line}/>'
            for x, y in pent)
    if kind == "wings":
        feathers = []
        for side in (-1, 1):
            for i in range(4):
                y0 = cy - h * 0.4 + i * h * 0.25
                feathers.append(f'<path d="M{_f(cx + side * h * 0.12)},{_f(y0)} Q{_f(cx + side * h * 0.9)},{_f(y0 - h * 0.35)} '
                                f'{_f(cx + side * h * (1 - i * 0.18))},{_f(y0 + h * 0.18)} Z" fill="{fg}"/>')
        return "".join(feathers) + f'<circle cx="{_f(cx)}" cy="{_f(cy)}" r="{_f(h * 0.18)}" fill="{accent}"/>'
    if kind == "crown":
        pts = [(-1, 0.6), (-1, -0.5), (-0.5, 0), (0, -0.8), (0.5, 0), (1, -0.5), (1, 0.6)]
        return (f'<polygon points="{_poly((cx + x * h * 0.85, cy + y * h * 0.8) for x, y in pts)}" fill="{fg}"/>'
                f'<rect x="{_f(cx - h * 0.85)}" y="{_f(cy + h * 0.52)}" width="{_f(h * 1.7)}" height="{_f(h * 0.2)}" fill="{accent}"/>')
    if kind == "flame":
        return (f'<path d="M{_f(cx)},{_f(cy - h)} C{_f(cx + h * 0.9)},{_f(cy - h * 0.2)} {_f(cx + h * 0.7)},{_f(cy + h)} {_f(cx)},{_f(cy + h)} '
                f'C{_f(cx - h * 0.7)},{_f(cy + h)} {_f(cx - h * 0.9)},{_f(cy - h * 0.1)} {_f(cx - h * 0.2)},{_f(cy - h * 0.45)} '
                f'C{_f(cx - h * 0.15)},{_f(cy)} {_f(cx + h * 0.1)},{_f(cy)} {_f(cx)},{_f(cy - h)} Z" fill="{fg}"/>'
                f'<path d="M{_f(cx)},{_f(cy - h * 0.1)} C{_f(cx + h * 0.4)},{_f(cy + h * 0.3)} {_f(cx + h * 0.3)},{_f(cy + h * 0.85)} '
                f'{_f(cx)},{_f(cy + h * 0.85)} C{_f(cx - h * 0.3)},{_f(cy + h * 0.85)} {_f(cx - h * 0.35)},{_f(cy + h * 0.3)} '
                f'{_f(cx)},{_f(cy - h * 0.1)} Z" fill="{accent}"/>')
    # stripes
    return "".join(f'<rect x="{_f(cx - h * 0.8)}" y="{_f(cy - h * 0.7 + i * h * 0.5)}" width="{_f(h * 1.6)}" '
                   f'height="{_f(h * 0.28)}" rx="{_f(h * 0.06)}" fill="{fg if i % 2 == 0 else accent}"/>' for i in range(3))


def initials_of(team: str) -> str:
    words = [w for w in team.replace("-", " ").split() if w]
    if not words:
        return ""
    if len(words) == 1:
        return words[0][:2].upper() if words[0].isascii() else words[0][:1]
    return "".join(w[0] for w in words[:3]).upper()


def suggest(req: LogoSuggestRequest) -> dict:
    pal = req.palette.model_dump() if req.palette else dict(_DEFAULT)
    sport = req.sport or "football"
    key = f"{req.team_name}|{sport}|{pal['primary']}|{pal['secondary']}|{pal['accent']}"
    base_seed = int(hashlib.sha1(key.encode()).hexdigest()[:8], 16)
    initials = initials_of(req.team_name)
    end = min(MAX_SUGGESTIONS, req.offset + req.limit)
    logos = []
    for i in range(req.offset, end):
        r = random.Random(base_seed + i)
        shape = SHAPES[i % len(SHAPES)]
        emblem = EMBLEMS[(i // len(SHAPES) + i) % len(EMBLEMS)]
        if emblem == "initials" and not initials:
            emblem = r.choice(["star", "ball", "bolt"])
        fill_role, fg_role = r.choice([("primary", "accent"), ("secondary", "text"), ("accent", "primary"), ("primary", "text")])
        fill, fg = pal[fill_role], pal[fg_role]
        if contrast_ratio(fg, fill) < 2.5:
            fg = best_text_color(fill, [pal["text"], pal["accent"], "#f7f7f5", "#111111"])
        stroke = pal["trim"] if contrast_ratio(pal["trim"], fill) > 1.5 else darken(fill, 0.5)
        accent = pal["secondary"] if pal["secondary"] != fill else pal["accent"]
        outline, (cx, cy, size) = _shape(shape, fill, stroke)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">'
               f'{outline}{_emblem(emblem, cx, cy, size, fg, accent, initials, sport)}</svg>')
        name = f"{shape.title()} {emblem}"
        logos.append({"id": f"logo_{base_seed:x}_{i}", "name": name, "shape": shape, "emblem": emblem, "svg": svg,
                      "data_url": "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()})
    return {"logos": logos, "offset": req.offset, "next_offset": end if end < MAX_SUGGESTIONS else None,
            "total": MAX_SUGGESTIONS}
