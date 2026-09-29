import type { Collar, DesignSpec, Element, Garment, LayerPanel, Sleeves, TextElement } from './api/types';

// Mirrors server/app/engine/layout.py so the editor can show safe/unsafe while
// a finger is still dragging. The server's checks remain the authority.

export const TEXT_ASCENT = 0.35;
export const TEXT_HEIGHT = 0.75;
export const CHAR_WIDTH = 0.6;

export type Pt = [number, number];

const NECK_DEPTH: Record<LayerPanel, Record<'jersey' | 'vneck', number>> = {
  front: { jersey: 90, vneck: 150 },
  back: { jersey: 28, vneck: 28 },
};

/** Where the polo's button placket ends on the front (mm); print stays 12 mm below it. */
export const POLO_PLACKET_END = 150;

/** Sleeves and collar change the zone; a spec can be passed as-is. */
export type ZoneOptions = { sleeves?: Sleeves | null; collar?: Collar | null };

export function safeZone(garment: Garment, panel: LayerPanel, opts: ZoneOptions = {}): Pt[] {
  if (garment === 'shorts') return [[70, 60], [570, 60], [595, 330], [45, 330]];
  let top = NECK_DEPTH[panel][garment] + 20;
  if (garment === 'jersey' && opts.collar === 'polo' && panel === 'front') top = Math.max(top, POLO_PLACKET_END + 12);
  if (opts.sleeves === 'none') {
    // The deeper sleeveless armhole and narrower shoulders.
    top = Math.max(top, 62);
    return [[165, top], [375, top], [500, 400], [500, 690], [40, 690], [40, 400]];
  }
  return [[100, top], [440, top], [500, 270], [500, 690], [40, 690], [40, 270]];
}

export function panelSize(garment: Garment): { w: number; h: number } {
  return garment === 'shorts' ? { w: 640, h: 480 } : { w: 540, h: 720 };
}

export function textValue(spec: DesignSpec, el: TextElement): string {
  const t = spec.typography;
  if (el.bind === 'team_name') return t.team_name.toUpperCase();
  if (el.bind === 'player_name') return t.player_name.toUpperCase();
  if (el.bind === 'number') return t.number;
  return el.text;
}

export function elementSize(spec: DesignSpec, el: Element): { w: number; h: number } {
  if (el.type === 'logo') return { w: el.width, h: el.width * el.aspect };
  const natural = [...textValue(spec, el)].length * el.size * CHAR_WIDTH;
  const w = el.max_width && el.max_width > 0 ? Math.min(natural, el.max_width) : natural;
  return { w, h: el.size * TEXT_HEIGHT };
}

export function corners(spec: DesignSpec, el: Element): Pt[] {
  const { w, h } = elementSize(spec, el);
  const a = (el.rotation * Math.PI) / 180;
  const [ca, sa] = [Math.cos(a), Math.sin(a)];
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(
    ([dx, dy]) => [el.x + dx * ca - dy * sa, el.y + dx * sa + dy * ca] as Pt,
  );
}

export function insideConvex(poly: Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = (x2 - x1) * (p[1] - y1) - (y2 - y1) * (p[0] - x1);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function isSafe(spec: DesignSpec, el: Element): boolean {
  if (el.type === 'text' && !textValue(spec, el)) return true;
  const zone = safeZone(spec.garment, el.panel, spec);
  return corners(spec, el).every((c) => insideConvex(zone, c));
}

/** Largest scale factor (<= 1) that keeps an element inside the safe zone at its position. */
export function fitScale(spec: DesignSpec, el: Element): number {
  let lo = 0.1;
  let hi = 1;
  const scaled = (k: number): Element =>
    el.type === 'logo' ? { ...el, width: el.width * k } : { ...el, size: el.size * k, max_width: el.max_width ? el.max_width * k : el.max_width };
  if (isSafe(spec, el)) return 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (isSafe(spec, scaled(mid))) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function zoneCenter(garment: Garment, panel: LayerPanel, opts: ZoneOptions = {}): Pt {
  const z = safeZone(garment, panel, opts);
  const xs = z.map((p) => p[0]);
  const ys = z.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function scaledBy(el: Element, k: number): Element {
  if (k >= 1) return el;
  if (el.type === 'logo') return { ...el, width: el.width * k };
  return { ...el, size: Math.max(8, el.size * k), max_width: el.max_width ? el.max_width * k : el.max_width };
}

/** True when the panel's zone under `after` lies inside, and differs from, its zone under `before`. */
function narrowed(garment: Garment, panel: LayerPanel, before: ZoneOptions, after: ZoneOptions): boolean {
  const was = safeZone(garment, panel, before);
  const now = safeZone(garment, panel, after);
  if (JSON.stringify(was) === JSON.stringify(now)) return false;
  return now.every((p) => insideConvex(was, p));
}

/**
 * Brings layers back inside the safe zone after sleeves or collar change it (sleeveless
 * armholes and the polo placket narrow it). A layer that no longer fits is shrunk where
 * it is, or moved to the middle of the zone's width just below its top and shrunk there,
 * whichever keeps it larger. Layers that still fit are left alone.
 *
 * Team and player names differ per line of an order and the server checks each one, so
 * on a panel whose zone just narrowed (from `before`), a bound name with a width cap is
 * fitted at that cap, as the longest name would be drawn.
 */
export function refitLayers(spec: DesignSpec, before?: ZoneOptions): DesignSpec {
  if (!spec.elements?.length) return spec;
  const longest = {
    ...spec,
    typography: {
      ...spec.typography,
      team_name: 'W'.repeat(40), player_name: 'W'.repeat(40),
      number: (spec.typography?.number ?? '').length > 2 ? spec.typography.number : '88',
    },
  };
  const tighter: Partial<Record<LayerPanel, boolean>> = {};
  const isTighter = (panel: LayerPanel) =>
    (tighter[panel] ??= !!before && narrowed(spec.garment, panel, before, spec));
  const elements = spec.elements.map((el) => {
    const capped = el.type === 'text' && !!el.bind && !!el.max_width && el.max_width > 0;
    return refitOne(capped && isTighter(el.panel) ? longest : spec, el);
  });
  return elements.some((e, i) => e !== spec.elements[i]) ? { ...spec, elements } : spec;
}

function refitOne(spec: DesignSpec, el: Element): Element {
  {
    if (isSafe(spec, el)) return el;
    const inPlace = scaledBy(el, fitScale(spec, el));
    const zone = safeZone(spec.garment, el.panel, spec);
    const xs = zone.map((p) => p[0]);
    const top = Math.min(...zone.map((p) => p[1]));
    const { h } = elementSize(spec, el);
    const moved0 = { ...el, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(el.y, top + h / 2 + 6) } as Element;
    const moved = scaledBy(moved0, fitScale(spec, moved0));
    const safeIn = isSafe(spec, inPlace);
    const safeMoved = isSafe(spec, moved);
    const size = (e: Element) => (e.type === 'logo' ? e.width : e.size);
    return safeIn && (!safeMoved || size(inPlace) >= size(moved) * 0.95) ? inPlace : safeMoved ? moved : inPlace;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
