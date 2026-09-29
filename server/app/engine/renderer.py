"""DesignSpec -> SVG (customer mock-up and production print sheet)."""
from __future__ import annotations

import math
import uuid
from xml.sax.saxutils import escape, quoteattr

from ..schemas import DesignSpec, LogoElement, TextElement
from . import layout, patterns
from .color import contrast_ratio, darken, mix
from . import sizing
from .garments import (MOCK_SLEEVE_LONG_RIGHT, MOCK_SLEEVE_RIGHT, TOP_GARMENTS, Panel, mirrored_sleeve,
                       spec_panels)

# Indic fallbacks keep Hindi, Telugu and Tamil names printable when the Latin face lacks the glyphs.
_INDIC = "'Noto Sans Devanagari', 'Noto Sans Telugu', 'Noto Sans Tamil'"
FONT_STACKS = {
    "block": (f"'Arial Black', 'Helvetica Neue', Impact, Arial, {_INDIC}, sans-serif", 900),
    "athletic": (f"Rockwell, 'Roboto Slab', Georgia, {_INDIC}, serif", 800),
    "modern": (f"Bahnschrift, 'DIN Alternate', 'Arial Narrow', Arial, {_INDIC}, sans-serif", 700),
}



def _f(v: float) -> str:
    return patterns._f(v)


class RenderCtx:
    """Collects <defs>, unique ids and the smallest printed feature size."""

    def __init__(self, spec: DesignSpec, prefix: str | None = None):
        self.spec = spec
        self.prefix = prefix or "d" + uuid.uuid4().hex[:6]
        self.defs: list[str] = []
        self.min_feature_mm = math.inf
        self._n = 0
        # Print sheets for a size: (width factor, height factor) of the current piece. Artwork is
        # counter-scaled so it moves with the piece but keeps its proportions.
        self.grade: tuple[float, float] | None = None

    def graded(self, x: float, y: float, svg: str) -> str:
        """Keep a name, number or logo anchored at (x, y) undistorted on a stretched piece."""
        if not self.grade or not svg:
            return svg
        sx, sy = self.grade
        u = sizing.art_scale(sx, sy)
        return (f'<g transform="translate({_f(x)},{_f(y)}) scale({u / sx:.5f},{u / sy:.5f}) '
                f'translate({_f(-x)},{_f(-y)})">{svg}</g>')

    def uid(self, name: str) -> str:
        self._n += 1
        return f"{self.prefix}-{name}{self._n}"

    def feature(self, mm: float) -> None:
        self.min_feature_mm = min(self.min_feature_mm, mm)

    def c(self, role: str) -> str:
        return getattr(self.spec.palette, role)


# ----------------------------------------------------------------- layers

def _base(ctx: RenderCtx, x: float, y: float, w: float, h: float) -> str:
    sp = ctx.spec
    fill = sp.palette.primary
    if sp.base == "gradient" or sp.pattern.type == "gradient":
        gid = ctx.uid("grad")
        end = sp.palette.secondary if sp.pattern.type == "gradient" else mix(sp.palette.primary, sp.palette.secondary, 0.7)
        ctx.defs.append(f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
                        f'<stop offset="0.1" stop-color="{sp.palette.primary}"/>'
                        f'<stop offset="1" stop-color="{end}"/></linearGradient>')
        fill = f"url(#{gid})"
    return f'<rect x="{_f(x)}" y="{_f(y)}" width="{_f(w)}" height="{_f(h)}" fill="{fill}"/>'


def _coverage_mask(ctx: RenderCtx, coverage: str, x: float, y: float, w: float, h: float, pad: float) -> str | None:
    if coverage == "full":
        return None
    X, Y, W, H = x - pad, y - pad, w + 2 * pad, h + 2 * pad
    if coverage in ("top", "bottom"):
        gid = ctx.uid("covg")
        stops = ((0, 1), (0.4, 1), (0.72, 0)) if coverage == "top" else ((0.28, 0), (0.6, 1), (1, 1))
        st = "".join(f'<stop offset="{o}" stop-color="{"#fff" if v else "#000"}"/>' for o, v in stops)
        ctx.defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="0" y1="{_f(y)}" '
                        f'x2="0" y2="{_f(y + h)}">{st}</linearGradient>')
        shape = f'<rect x="{_f(X)}" y="{_f(Y)}" width="{_f(W)}" height="{_f(H)}" fill="url(#{gid})"/>'
    elif coverage == "diagonal_band":
        pts = [(X, y + 0.42 * h), (X + W, y + 0.12 * h), (X + W, y + 0.42 * h), (X, y + 0.72 * h)]
        shape = f'<polygon points="{" ".join(f"{_f(a)},{_f(b)}" for a, b in pts)}" fill="#fff"/>'
    elif coverage == "side_panels":
        shape = (f'<rect x="{_f(X)}" y="{_f(Y)}" width="{_f(0.2 * w + pad)}" height="{_f(H)}" fill="#fff"/>'
                 f'<rect x="{_f(x + 0.8 * w)}" y="{_f(Y)}" width="{_f(0.2 * w + pad)}" height="{_f(H)}" fill="#fff"/>')
    else:  # chest_band
        shape = f'<rect x="{_f(X)}" y="{_f(y + 0.18 * h)}" width="{_f(W)}" height="{_f(0.24 * h)}" fill="#fff"/>'
    mid = ctx.uid("cov")
    ctx.defs.append(f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="{_f(X)}" y="{_f(Y)}" '
                    f'width="{_f(W)}" height="{_f(H)}">{shape}</mask>')
    return mid


def _pattern_layer(ctx: RenderCtx, x: float, y: float, w: float, h: float, pad: float, kind: str) -> str:
    p = ctx.spec.pattern
    if p.type == "gradient":
        return ""
    coverage = p.coverage
    if kind == "sleeve" and coverage in ("side_panels", "chest_band"):
        return ""
    if kind.startswith("shorts") and coverage == "chest_band":
        coverage = "diagonal_band"
    cols = [ctx.c(r) for r in p.colors]
    cx, cy = x + w / 2, y + h / 2
    R = math.hypot(w, h) / 2 + pad
    art = patterns.draw(ctx, p, cols, ctx.spec.seed, cx, cy, R)
    mask = _coverage_mask(ctx, coverage, x, y, w, h, pad)
    attrs = f' opacity="{p.opacity:.2f}"' + (f' mask="url(#{mask})"' if mask else "")
    return f'<g{attrs}><g transform="rotate({_f(p.angle)} {_f(cx)} {_f(cy)})">{art}</g></g>'


def _accents(ctx: RenderCtx, panel: Panel) -> str:
    a, out = ctx.spec.accents, []
    if panel.kind in ("front", "back") and a.side_panels:
        col = ctx.c("secondary")
        out.append(f'<rect x="-20" y="240" width="75" height="500" fill="{col}"/>'
                   f'<rect x="485" y="240" width="75" height="500" fill="{col}"/>')
    if panel.kind.startswith("shorts") and a.side_panels:
        col = ctx.c("secondary")
        out.append(f'<path d="M30,-10 L85,-10 L70,310 L12,310 Z" fill="{col}"/>'
                   f'<path d="M555,-10 L610,-10 L628,310 L570,310 Z" fill="{col}"/>')
    if panel.neck:
        # Half of this stroke falls outside the cut line, leaving a ~9 mm printed collar band.
        out.append(f'<path d="{panel.neck}" fill="none" stroke="{ctx.c(a.collar_role)}" stroke-width="18"/>')
        ctx.feature(9)
    if panel.armhole:
        # Sleeveless: a printed binding band around each armhole (half the stroke is outside the cut).
        out.append(f'<path d="{panel.armhole}" fill="none" stroke="{ctx.c(a.cuff_role)}" stroke-width="18"/>')
        ctx.feature(9)
    if panel.kind == "sleeve":
        cuff = panel.h - 22
        out.append(f'<rect x="-20" y="{_f(cuff)}" width="500" height="40" fill="{ctx.c(a.cuff_role)}"/>')
        for k in range(a.shoulder_stripes):
            out.append(f'<rect x="-20" y="{_f(cuff - 24 - k * 20)}" width="500" height="10" fill="{ctx.c("accent")}"/>')
        if a.shoulder_stripes:
            ctx.feature(10)
    if panel.waist:
        out.append(f'<rect x="-20" y="-20" width="700" height="60" fill="{ctx.c("trim")}"/>')
    return "".join(out)


def _text(ctx: RenderCtx, s: str, x: float, y: float, size: float, max_w: float, *, font: str | None = None,
          fill: str | None = None, rotation: float = 0, cx: float | None = None, cy: float | None = None) -> str:
    if not s:
        return ""
    fam, weight = FONT_STACKS[font or ctx.spec.typography.font]
    fill = fill or ctx.c("text")
    stroke = ctx.c("trim") if contrast_ratio(ctx.c("trim"), fill) > 2 else darken(ctx.c("primary"), 0.6)
    fit = f' textLength="{_f(max_w)}" lengthAdjust="spacingAndGlyphs"' if len(s) * size * 0.62 > max_w else ""
    rot = f' transform="rotate({_f(rotation)} {_f(cx)} {_f(cy)})"' if rotation and cx is not None else ""
    ctx.feature(size * 0.12)   # approximate stroke weight of the glyphs
    return ctx.graded(cx if cx is not None else x, cy if cy is not None else y - size * 0.35,
                      f'<text x="{_f(x)}" y="{_f(y)}" text-anchor="middle" font-family={quoteattr(fam)} '
                      f'font-weight="{weight}" font-size="{_f(size)}" fill="{fill}" stroke="{stroke}" '
                      f'stroke-width="{_f(max(1.0, size * 0.04))}" paint-order="stroke" stroke-linejoin="round"{fit}{rot}>'
                      f'{escape(s)}</text>')


def _typography(ctx: RenderCtx, panel: Panel) -> str:
    if layout.uses_layers(ctx.spec):
        return ""
    t = ctx.spec.typography
    if panel.kind == "front":
        name_y = 235 if ctx.spec.garment == "vneck" else 205
        return (_text(ctx, t.team_name.upper(), 270, name_y, 50, 360)
                + _text(ctx, t.number, 270, name_y + 150, 120, 220))
    if panel.kind == "back":
        return (_text(ctx, t.player_name.upper(), 270, 160, 56, 400)
                + _text(ctx, t.number, 270, 460, 260, 420))
    if panel.kind == "shorts_front":
        return _text(ctx, t.number, 150, 410, 80, 140)
    return ""


def _side(panel: Panel) -> str | None:
    return {"front": "front", "shorts_front": "front", "back": "back", "shorts_back": "back"}.get(panel.kind)


def _elements(ctx: RenderCtx, panel: Panel) -> str:
    side = _side(panel)
    out = []
    for el in ctx.spec.elements:
        if el.panel != side:
            continue
        if isinstance(el, TextElement):
            s = layout.text_value(ctx.spec, el)
            fill = el.color or ctx.c(el.color_role or "text")
            w, _ = layout.element_size(ctx.spec, el)
            out.append(_text(ctx, s, el.x, el.y + el.size * layout.TEXT_ASCENT, el.size,
                             el.max_width or max(w, 1) * 1.02, font=el.font, fill=fill,
                             rotation=el.rotation, cx=el.x, cy=el.y))
        elif isinstance(el, LogoElement):
            w, h = el.width, el.width * el.aspect
            rot = f' transform="rotate({_f(el.rotation)} {_f(el.x)} {_f(el.y)})"' if el.rotation else ""
            out.append(ctx.graded(el.x, el.y, f'<image x="{_f(el.x - w / 2)}" y="{_f(el.y - h / 2)}" width="{_f(w)}" '
                                              f'height="{_f(h)}" preserveAspectRatio="xMidYMid meet" '
                                              f'href={quoteattr(el.src)}{rot}/>'))
    return "".join(out)


def panel_art(ctx: RenderCtx, panel: Panel, pad: float) -> str:
    return (_base(ctx, -pad, -pad, panel.w + 2 * pad, panel.h + 2 * pad)
            + _pattern_layer(ctx, 0, 0, panel.w, panel.h, pad, panel.kind)
            + _accents(ctx, panel) + _typography(ctx, panel) + _elements(ctx, panel))


# ----------------------------------------------------------------- mock-up

def _pts(ps) -> str:
    return "M" + " L".join(f"{_f(x)},{_f(y)}" for x, y in ps) + "Z"


def _lerp(a, b, t):
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


OUTLINE = 'fill="none" stroke="#0b0d10" stroke-opacity="0.55" stroke-width="2" stroke-linejoin="round"'
EDGE = OUTLINE.replace('fill="none" ', "")      # the same outline on a filled shape


def _mock_sleeves(ctx: RenderCtx, fill_id: str) -> str:
    long = ctx.spec.sleeves == "long"
    right = MOCK_SLEEVE_LONG_RIGHT if long else MOCK_SLEEVE_RIGHT
    sleeves = [right, mirrored_sleeve(right)]
    reach = 0.5 if long else 1.0      # cuff band and stripes sit near the cuff, not halfway up a long sleeve
    clip = ctx.uid("slv")
    ctx.defs.append(f'<clipPath id="{clip}"><path d="{" ".join(_pts(s) for s in sleeves)}"/></clipPath>')
    a = ctx.spec.accents
    trims = []
    for S, S2, U2, U, _ in sleeves:
        band = [S2, U2, _lerp(U2, U, 0.14 * reach), _lerp(S2, S, 0.14 * reach)]
        trims.append(f'<path d="{_pts(band)}" fill="{ctx.c(a.cuff_role)}"/>')
        for k in range(a.shoulder_stripes):
            f0, f1 = (0.2 + k * 0.12) * reach, (0.26 + k * 0.12) * reach
            stripe = [_lerp(S2, S, f0), _lerp(U2, U, f0), _lerp(U2, U, f1), _lerp(S2, S, f1)]
            trims.append(f'<path d="{_pts(stripe)}" fill="{ctx.c("accent")}"/>')
    return (f'<g clip-path="url(#{clip})"><use href="#{fill_id}"/>{"".join(trims)}'
            f'<rect x="-200" y="0" width="940" height="{640 if long else 320}" fill="#000" opacity="0.08"/></g>'
            + "".join(f'<path d="{_pts(s)}" {OUTLINE}/>' for s in sleeves))


def _mock_collar(ctx: RenderCtx, panel: Panel) -> str:
    """Polo and mandarin collars are knitted separately; the mock-up draws them on top."""
    sp = ctx.spec
    if sp.garment != "jersey" or sp.collar == "crew" or not panel.neck:
        return ""
    col, edge = ctx.c(sp.accents.collar_role), darken(ctx.c(sp.accents.collar_role), 0.7)
    if sp.collar == "mandarin":
        return (f'<path d="{panel.neck}" fill="none" stroke="{col}" stroke-width="30" stroke-linecap="round"/>'
                f'<path d="{panel.neck}" fill="none" stroke="{edge}" stroke-opacity="0.5" stroke-width="2" '
                f'transform="translate(0,-15)"/>')
    if panel.kind == "back":
        return (f'<path d="M170,-6 C190,26 230,34 270,34 C310,34 350,26 370,-6 L360,-16 C340,8 300,14 270,14 '
                f'C240,14 200,8 180,-16 Z" fill="{col}" {EDGE}/>')
    placket = (f'<rect x="256" y="88" width="28" height="62" fill="{col}" {EDGE}/>'
               + "".join(f'<circle cx="270" cy="{_f(y)}" r="5" fill="{edge}"/>' for y in (106, 122, 138)))
    flap = "M178,-10 L270,96 L222,118 L150,14 Z"
    return (placket + f'<path d="{flap}" fill="{col}" {EDGE}/>'
            + f'<path d="{flap}" transform="translate(540,0) scale(-1,1)" fill="{col}" {EDGE}/>')


def _mock_view(ctx: RenderCtx, panel: Panel, fill_id: str, sleeve_fill_id: str | None, shade_id: str, ox: float) -> str:
    clip = ctx.uid("body")
    ctx.defs.append(f'<clipPath id="{clip}"><path d="{panel.d}"/></clipPath>')
    parts = [f'<g transform="translate({_f(ox)},0)">']
    if sleeve_fill_id:
        parts.append(_mock_sleeves(ctx, sleeve_fill_id))
    if panel.kind == "front" and panel.neck:
        # inside of the back neck, visible through the front neckline
        parts.append(f'<path d="{panel.neck} Z" fill="{darken(ctx.c("primary"), 0.55)}"/>')
    parts.append(f'<g clip-path="url(#{clip})"><use href="#{fill_id}"/>{_accents(ctx, panel)}'
                 f'{_typography(ctx, panel)}{_elements(ctx, panel)}<rect x="-10" y="-10" width="{_f(panel.w + 20)}" '
                 f'height="{_f(panel.h + 20)}" fill="url(#{shade_id})"/></g>')
    parts.append(f'<path d="{panel.d}" {OUTLINE}/>')
    parts.append(_mock_collar(ctx, panel))
    label = "FRONT" if panel.kind in ("front", "shorts_front") else "BACK"
    parts.append(f'<text x="{_f(panel.w / 2)}" y="{_f(panel.h + 42)}" text-anchor="middle" '
                 f'font-family="Arial, sans-serif" font-size="22" letter-spacing="4" fill="#8a8f98">{label}</text>')
    parts.append("</g>")
    return "".join(parts)


def render_mockup(spec: DesignSpec, prefix: str | None = None) -> tuple[str, RenderCtx]:
    ctx = RenderCtx(spec, prefix)
    panels = {p.name: p for p in spec_panels(spec)}
    front, back = panels["front"], panels["back"]
    top = spec.garment in TOP_GARMENTS

    fill_id = ctx.uid("fill")
    body_fill = _base(ctx, -220, -120, front.w + 440, front.h + 240) \
        + _pattern_layer(ctx, 0, 0, front.w, front.h, 60, front.kind)
    ctx.defs.append(f'<g id="{fill_id}">{body_fill}</g>')
    sleeve_fill_id = None
    if top and spec.sleeves != "none":
        if spec.pattern.coverage in ("side_panels", "chest_band"):
            sleeve_fill_id = ctx.uid("sfill")
            ctx.defs.append(f'<g id="{sleeve_fill_id}">{_base(ctx, -220, -120, 980, 500)}</g>')
        else:
            sleeve_fill_id = fill_id

    shade_id = ctx.uid("shade")
    ctx.defs.append(f'<linearGradient id="{shade_id}" x1="0" y1="0" x2="1" y2="0">'
                    '<stop offset="0" stop-color="#000" stop-opacity="0.22"/>'
                    '<stop offset="0.18" stop-color="#000" stop-opacity="0"/>'
                    '<stop offset="0.5" stop-color="#fff" stop-opacity="0.07"/>'
                    '<stop offset="0.82" stop-color="#000" stop-opacity="0"/>'
                    '<stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>')

    step = 880 if top else 760
    views = _mock_view(ctx, front, fill_id, sleeve_fill_id, shade_id, 0) \
        + _mock_view(ctx, back, fill_id, sleeve_fill_id, shade_id, step)
    vb = "-160 -30 1740 800" if top else "-40 -30 1480 580"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" '
           f'aria-label={quoteattr(f"{spec.style_name} {spec.garment} mock-up")}>'
           f'<defs>{"".join(ctx.defs)}</defs>{views}</svg>')
    return svg, ctx


# ----------------------------------------------------------------- print sheet

def render_print_sheet(spec: DesignSpec, size: str = "M", mirror: bool = False, roll_width: float = 1600,
                       bleed: float = 10, design_id: str = "", only: str | None = None,
                       label: str = "", fit: str = "men", sizing_chart: dict | None = None) -> tuple[str, RenderCtx]:
    """Production sheet: every pattern piece, graded to `fit` and `size` from the size chart, with bleed
    and cut lines.

    Units are millimetres (width/height carry `mm`, so RIP software imports at 1:1). Everything is vector;
    raster logos are checked for 300 DPI at their printed size by the manufacturing checks.
    """
    if not sizing.valid(fit, size):
        raise ValueError(f"unknown size {size!r} for {fit}")
    r = sizing.row(sizing_chart, fit, size)
    ctx = RenderCtx(spec, "p" + uuid.uuid4().hex[:6])
    margin, gap, label_h = 20.0, 25.0, 18.0
    header_h = 48.0 if only is None else 63.0
    pieces = spec_panels(spec)
    if only is not None:
        pieces = [p for p in pieces if p.name == only]
        if not pieces:
            raise ValueError(f"unknown panel {only!r} for {spec.garment}")
    factors = {p.name: sizing.grade(p.kind, spec.sleeves, r) for p in pieces}
    if only is not None:
        roll_width = min(roll_width, pieces[0].w * factors[only][0] + 2 * bleed + 2 * margin)
    widest = max(p.w * factors[p.name][0] + 2 * bleed for p in pieces)
    if widest + 2 * margin > roll_width:
        raise ValueError(f"roll width {roll_width} mm is narrower than the widest piece ({widest:.0f} mm)")

    placed, x, y, row_h = [], margin, margin + header_h, 0.0
    for p in pieces:
        sx, sy = factors[p.name]
        pw, ph = p.w * sx + 2 * bleed, p.h * sy + 2 * bleed
        if x + pw > roll_width - margin and x > margin:
            x, y, row_h = margin, y + row_h + gap, 0.0
        placed.append((p, x + bleed, y + bleed))
        x += pw + gap
        row_h = max(row_h, ph + label_h)
    W, H = roll_width, y + row_h + margin

    fit_name = sizing.FIT_NAMES.get(fit, fit)
    items, labels = [], []
    for p, px, py in placed:
        sx, sy = factors[p.name]
        ctx.grade = (sx, sy)
        mid = ctx.uid("bleed")
        b = bleed / min(sx, sy)
        ctx.defs.append(f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="{_f(-b - 5)}" y="{_f(-b - 5)}" '
                        f'width="{_f(p.w + 2 * b + 10)}" height="{_f(p.h + 2 * b + 10)}">'
                        f'<path d="{p.d}" fill="#fff" stroke="#fff" stroke-width="{_f(2 * b)}" '
                        f'stroke-linejoin="round"/></mask>')
        art = panel_art(ctx, p, pad=b + 2)
        items.append(f'<g id="{ctx.prefix}-{p.name}" transform="translate({_f(px)},{_f(py)}) scale({sx:.5f},{sy:.5f})">'
                     f'<g mask="url(#{mid})">{art}</g>'
                     f'<path d="{p.d}" fill="none" stroke="#ff00ff" stroke-width="{0.35 / min(sx, sy):.3f}" '
                     f'data-role="CutContour"/></g>')
        lx = px + p.w * sx / 2
        labels.append((W - lx if mirror else lx, py + p.h * sy + bleed + 12,
                       f"{p.name.upper().replace('_', ' ')} / {fit_name.upper()} {size} / "
                       f"{p.w * sx:.0f} x {p.h * sy:.0f} mm"))
    ctx.grade = None
    body = "".join(items)
    if mirror:
        body = f'<g transform="translate({_f(W)},0) scale(-1,1)">{body}</g>'
    label_svg = "".join(f'<text x="{_f(lx)}" y="{_f(ly)}" text-anchor="middle" font-family="Arial, sans-serif" '
                        f'font-size="8" fill="#000">{escape(t)}</text>' for lx, ly, t in labels)
    m = sizing.measurements(spec.garment, spec.sleeves, r)
    options = [spec.garment] + ([f"sleeves {spec.sleeves}", f"collar {spec.collar}"] if spec.garment in TOP_GARMENTS else [])
    header = (f"{spec.style_name} | design {design_id or '-'} | {fit_name} {size} | "
              + (f"{label} | " if label else f"roll {roll_width:.0f} mm | ") +
              f"bleed {bleed:.0f} mm | cut line = magenta" + (" | MIRRORED FOR TRANSFER PAPER" if mirror else ""))
    spec_line = (" | ".join(options) + " | finished garment (cm, flat): "
                 + ", ".join(f"{k} {v:g}" for k, v in m.items()))
    # A single-piece file is narrow, so its ruler goes under the header instead of beside it.
    rx, ry = (W - margin - 100, margin) if only is None else (margin, margin + 22)
    head_size = 9 if only is None else 5
    ruler = (f'<g><rect x="{_f(rx)}" y="{_f(ry)}" width="100" height="4" fill="#000"/>'
             + "".join(f'<rect x="{_f(rx + i * 10)}" y="{_f(ry + 4)}" width="0.5" height="{3 if i % 5 else 6}" fill="#000"/>'
                       for i in range(11))
             + f'<text x="{_f(rx + 50)}" y="{_f(ry + 18)}" text-anchor="middle" font-family="Arial, sans-serif" '
               f'font-size="6">100 mm calibration</text></g>')
    svg = (f'<?xml version="1.0" encoding="UTF-8"?>\n'
           f'<svg xmlns="http://www.w3.org/2000/svg" width="{_f(W)}mm" height="{_f(H)}mm" viewBox="0 0 {_f(W)} {_f(H)}">'
           f'<title>{escape(header)}</title><defs>{"".join(ctx.defs)}</defs>'
           f'<rect width="{_f(W)}" height="{_f(H)}" fill="#fff"/>'
           f'<text x="{_f(margin)}" y="{_f(margin + 10)}" font-family="Arial, sans-serif" font-size="{head_size}">{escape(header)}</text>'
           f'<text x="{_f(margin)}" y="{_f(margin + 10 + head_size * 1.4)}" font-family="Arial, sans-serif" '
           f'font-size="{head_size * 0.8:g}">{escape(spec_line)}</text>'
           f'{ruler}{body}{label_svg}</svg>')
    return svg, ctx
