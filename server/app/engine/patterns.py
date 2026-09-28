"""Procedural, seed-deterministic vector pattern generators.

Every generator draws un-rotated artwork covering the square
[cx-R, cx+R] x [cy-R, cy+R] (millimetres); the caller rotates it by
pattern.angle about (cx, cy) and clips it to the garment panel. Same spec +
same seed => byte-identical SVG, so a design can always be re-rendered for
print at any size without storing artwork.
"""
from __future__ import annotations

import math
import random
from typing import Callable, Protocol

MIN_FEATURE_MM = 1.0   # nothing thinner/smaller than this is emitted


class Ctx(Protocol):
    def feature(self, mm: float) -> None: ...


def _f(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


def smooth_closed(points: list[tuple[float, float]]) -> str:
    """Closed quadratic B-spline through the midpoints of a polygon."""
    n = len(points)
    mids = [((points[i][0] + points[(i + 1) % n][0]) / 2, (points[i][1] + points[(i + 1) % n][1]) / 2)
            for i in range(n)]
    d = [f"M{_f(mids[-1][0])},{_f(mids[-1][1])}"]
    for i in range(n):
        d.append(f"Q{_f(points[i][0])},{_f(points[i][1])} {_f(mids[i][0])},{_f(mids[i][1])}")
    return "".join(d) + "Z"


def stripes(ctx, rng, p, cols, cx, cy, R):
    period = 120 * p.scale
    sw = period * (0.18 + 0.5 * p.density)
    ctx.feature(sw)
    out, x, i = [], cx - R, 0
    while x < cx + R:
        out.append(f'<rect x="{_f(x)}" y="{_f(cy - R)}" width="{_f(sw)}" height="{_f(2 * R)}" fill="{cols[i % len(cols)]}"/>')
        x += period
        i += 1
    return "".join(out)


def pinstripe(ctx, rng, p, cols, cx, cy, R):
    period = 30 * p.scale
    sw = max(MIN_FEATURE_MM, 3.0 * p.density * p.scale)
    ctx.feature(sw)
    out, x, i = [], cx - R, 0
    while x < cx + R:
        out.append(f'<line x1="{_f(x)}" y1="{_f(cy - R)}" x2="{_f(x)}" y2="{_f(cy + R)}" '
                   f'stroke="{cols[i % len(cols)]}" stroke-width="{_f(sw)}"/>')
        x += period
        i += 1
    return "".join(out)


def chevron(ctx, rng, p, cols, cx, cy, R):
    row, zw, amp = 110 * p.scale, 140 * p.scale, 45 * p.scale
    sw = max(MIN_FEATURE_MM * 2, (8 + 26 * p.density) * p.scale)
    ctx.feature(sw)
    out, y, i = [], cy - R, 0
    while y < cy + R + amp:
        pts, x, up = [], cx - R - zw, True
        while x < cx + R + zw:
            pts.append(f"{_f(x)},{_f(y - amp if up else y)}")
            x += zw / 2
            up = not up
        out.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="{cols[i % len(cols)]}" '
                   f'stroke-width="{_f(sw)}" stroke-linejoin="miter"/>')
        y += row
        i += 1
    return "".join(out)


def camo(ctx, rng, p, cols, cx, cy, R):
    cell = 150 * p.scale
    n = int((2 * R / cell) ** 2 * (1.2 + 2.5 * p.density))
    out = []
    for _ in range(n):
        bx, by = rng.uniform(cx - R, cx + R), rng.uniform(cy - R, cy + R)
        r = rng.uniform(35, 95) * p.scale
        k = rng.randint(6, 9)
        pts = []
        for j in range(k):
            a = 2 * math.pi * j / k + rng.uniform(-0.25, 0.25)
            rr = r * rng.uniform(0.55, 1.35)
            pts.append((bx + rr * math.cos(a), by + rr * 0.8 * math.sin(a)))
        out.append(f'<path d="{smooth_closed(pts)}" fill="{rng.choice(cols)}"/>')
    ctx.feature(35 * p.scale * 0.55)
    return "".join(out)


def halftone(ctx, rng, p, cols, cx, cy, R):
    g = max(14.0, 24 * p.scale)
    out = []
    y, row = cy - R, 0
    while y <= cy + R:
        t = (y - (cy - R)) / (2 * R)          # 0 at top -> 1 at bottom
        r = g * 0.5 * min(1.0, (1 - t) ** 1.3 * (0.5 + p.density))
        if r >= MIN_FEATURE_MM / 2:
            x = cx - R + (g / 2 if row % 2 else 0)
            while x <= cx + R:
                out.append(f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{_f(r)}"/>')
                x += g
        y += g * 0.866
        row += 1
    ctx.feature(MIN_FEATURE_MM)
    return f'<g fill="{cols[0]}">{"".join(out)}</g>'


def geometric(ctx, rng, p, cols, cx, cy, R):
    g = 110 * p.scale
    n = int(2 * R / g) + 2
    x0, y0 = cx - R - g / 2, cy - R - g / 2
    pts = [[(x0 + i * g + rng.uniform(-0.35, 0.35) * g, y0 + j * g + rng.uniform(-0.35, 0.35) * g)
            for i in range(n)] for j in range(n)]
    out = []
    for j in range(n - 1):
        for i in range(n - 1):
            a, b, c, d = pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]
            for tri in ((a, b, c), (a, c, d)):
                if rng.random() > p.density:
                    continue
                op = rng.uniform(0.35, 1.0)
                path = "M" + " L".join(f"{_f(x)},{_f(y)}" for x, y in tri) + "Z"
                out.append(f'<path d="{path}" fill="{rng.choice(cols)}" fill-opacity="{op:.2f}"/>')
    ctx.feature(g * 0.3)
    return "".join(out)


def hexagon(ctx, rng, p, cols, cx, cy, R):
    r = 45 * p.scale
    sw = max(MIN_FEATURE_MM * 1.5, 4 * p.scale)
    ctx.feature(sw)
    w, h = math.sqrt(3) * r, 1.5 * r
    out, row, y = [], 0, cy - R
    while y <= cy + R + r:
        x = cx - R + (w / 2 if row % 2 else 0)
        while x <= cx + R + w:
            pts = " ".join(f"{_f(x + r * math.cos(math.radians(60 * k + 30)))},"
                           f"{_f(y + r * math.sin(math.radians(60 * k + 30)))}" for k in range(6))
            filled = rng.random() < p.density * 0.35
            fill = rng.choice(cols) if filled else "none"
            out.append(f'<polygon points="{pts}" fill="{fill}" stroke="{cols[0]}" stroke-width="{_f(sw)}"/>')
            x += w
        y += h
        row += 1
    return "".join(out)


def waves(ctx, rng, p, cols, cx, cy, R):
    gap, amp, wl = 70 * p.scale, 22 * p.scale, 240 * p.scale
    sw = max(MIN_FEATURE_MM * 2, (6 + 22 * p.density) * p.scale)
    ctx.feature(sw)
    out, y, i = [], cy - R, 0
    while y < cy + R + amp:
        phase = rng.uniform(0, wl)
        x = cx - R - wl - phase
        d, up = [f"M{_f(x)},{_f(y)}"], True
        while x < cx + R + wl:
            d.append(f"Q{_f(x + wl / 4)},{_f(y - 2 * amp if up else y + 2 * amp)} {_f(x + wl / 2)},{_f(y)}")
            x += wl / 2
            up = not up
        out.append(f'<path d="{"".join(d)}" fill="none" stroke="{cols[i % len(cols)]}" '
                   f'stroke-width="{_f(sw)}" stroke-linecap="round"/>')
        y += gap
        i += 1
    return "".join(out)


def shards(ctx, rng, p, cols, cx, cy, R):
    ox, oy = cx - R * rng.uniform(0.1, 0.4), cy - R * rng.uniform(0.1, 0.4)
    n = int(8 + 16 * p.density)
    out = []
    for _ in range(n):
        a = rng.uniform(-0.2, math.pi / 2 + 0.2)
        spread = rng.uniform(0.03, 0.12) * (1.4 - p.density * 0.5)
        L1, L2 = rng.uniform(0.7, 1.9) * R, rng.uniform(0.7, 1.9) * R
        near = rng.uniform(0.0, 0.5) * R
        pts = [(ox + near * math.cos(a), oy + near * math.sin(a)),
               (ox + L1 * math.cos(a - spread), oy + L1 * math.sin(a - spread)),
               (ox + L2 * math.cos(a + spread), oy + L2 * math.sin(a + spread))]
        path = "M" + " L".join(f"{_f(x)},{_f(y)}" for x, y in pts) + "Z"
        out.append(f'<path d="{path}" fill="{rng.choice(cols)}" fill-opacity="{rng.uniform(0.55, 1):.2f}"/>')
    ctx.feature(8)
    return "".join(out)


def splatter(ctx, rng, p, cols, cx, cy, R):
    n = int(6 + 14 * p.density)
    out = []
    for _ in range(n):
        x, y = rng.uniform(cx - R * 0.8, cx + R * 0.8), rng.uniform(cy - R * 0.8, cy + R * 0.8)
        col = rng.choice(cols)
        r = rng.uniform(15, 45) * p.scale
        k = rng.randint(7, 11)
        blob = [(x + r * rng.uniform(0.7, 1.2) * math.cos(2 * math.pi * j / k),
                 y + r * rng.uniform(0.7, 1.2) * math.sin(2 * math.pi * j / k)) for j in range(k)]
        out.append(f'<path d="{smooth_closed(blob)}" fill="{col}"/>')
        for _ in range(rng.randint(8, 20)):
            a, dist = rng.uniform(0, 2 * math.pi), r * rng.uniform(1.2, 3.2)
            dr = max(MIN_FEATURE_MM, rng.uniform(1.5, 7) * p.scale * (1.4 - dist / (3.2 * r)))
            out.append(f'<circle cx="{_f(x + dist * math.cos(a))}" cy="{_f(y + dist * math.sin(a))}" '
                       f'r="{_f(dr)}" fill="{col}"/>')
    ctx.feature(MIN_FEATURE_MM * 2)
    return "".join(out)


def topo(ctx, rng, p, cols, cx, cy, R):
    sw = max(MIN_FEATURE_MM * 1.5, 3 * p.scale)
    ctx.feature(sw)
    step = (22 + 20 * (1 - p.density)) * p.scale
    out = []
    for c in range(2):
        px, py = rng.uniform(cx - R * 0.5, cx + R * 0.5), rng.uniform(cy - R * 0.5, cy + R * 0.5)
        phases = [rng.uniform(0, 2 * math.pi) for _ in range(3)]
        r, i = step, 0
        while r < R * 1.1:
            pts = []
            for k in range(24):
                a = 2 * math.pi * k / 24
                wob = 1 + 0.18 * math.sin(2 * a + phases[0]) + 0.1 * math.sin(3 * a + phases[1] + r / 90) \
                    + 0.06 * math.sin(5 * a + phases[2])
                pts.append((px + r * wob * math.cos(a), py + r * wob * math.sin(a)))
            out.append(f'<path d="{smooth_closed(pts)}" fill="none" stroke="{cols[(i + c) % len(cols)]}" '
                       f'stroke-width="{_f(sw)}"/>')
            r += step
            i += 1
    return "".join(out)


def gradient(ctx, rng, p, cols, cx, cy, R):
    return ""   # the base layer carries the gradient


GENERATORS: dict[str, Callable] = {
    "stripes": stripes, "pinstripe": pinstripe, "chevron": chevron, "camo": camo,
    "halftone": halftone, "geometric": geometric, "hexagon": hexagon, "waves": waves,
    "shards": shards, "splatter": splatter, "topo": topo, "gradient": gradient,
}


def draw(ctx: Ctx, pattern, cols: list[str], seed: int, cx: float, cy: float, R: float) -> str:
    rng = random.Random(seed)
    return GENERATORS[pattern.type](ctx, rng, pattern, cols, cx, cy, R)
