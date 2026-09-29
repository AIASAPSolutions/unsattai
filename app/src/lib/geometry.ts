import type { Collar, DesignSpec, Element, Garment, LayerPanel, Sleeves, TextElement } from '../api/types';

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

const POLO_PLACKET_END = 150; // the polo's button placket runs down the front to here (mm)

/** Same zones as the server: a polo placket pushes the front zone down, sleeveless armholes narrow it. */
export function safeZone(garment: Garment, panel: LayerPanel, sleeves: Sleeves | null = 'short', collar: Collar | null = 'crew'): Pt[] {
  if (garment === 'shorts') return [[70, 60], [570, 60], [595, 330], [45, 330]];
  let top = NECK_DEPTH[panel][garment] + 20;
  if (garment === 'jersey' && collar === 'polo' && panel === 'front') top = Math.max(top, POLO_PLACKET_END + 12);
  if (sleeves === 'none') {
    top = Math.max(top, 62);
    return [[165, top], [375, top], [500, 400], [500, 690], [40, 690], [40, 400]];
  }
  return [[100, top], [440, top], [500, 270], [500, 690], [40, 690], [40, 270]];
}

/** The safe zone for a layer panel of this spec (its sleeves and collar). */
export function specZone(spec: Pick<DesignSpec, 'garment' | 'sleeves' | 'collar'>, panel: LayerPanel): Pt[] {
  return safeZone(spec.garment, panel, spec.sleeves ?? 'short', spec.collar ?? 'crew');
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
  const zone = specZone(spec, el.panel);
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

export function zoneCenter(garment: Garment, panel: LayerPanel, sleeves: Sleeves | null = 'short', collar: Collar | null = 'crew'): Pt {
  const z = safeZone(garment, panel, sleeves, collar);
  const xs = z.map((p) => p[0]);
  const ys = z.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
