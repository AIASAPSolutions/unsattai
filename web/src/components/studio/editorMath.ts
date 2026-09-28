import type { DesignSpec, Element, LayerPanel } from '@/lib/api/types';
import { elementSize, type Pt } from '@/lib/geometry';

// Pure geometry for the panel editor (ported from app/src/features/studio/PanelEditor.tsx).

export function toLocal(el: Element, p: Pt): Pt {
  const a = (-el.rotation * Math.PI) / 180;
  const dx = p[0] - el.x;
  const dy = p[1] - el.y;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

export function rotatePt(el: Element, local: Pt): Pt {
  const a = (el.rotation * Math.PI) / 180;
  return [el.x + local[0] * Math.cos(a) - local[1] * Math.sin(a), el.y + local[0] * Math.sin(a) + local[1] * Math.cos(a)];
}

export function hitTest(spec: DesignSpec, side: LayerPanel, p: Pt, slopMm = 8): Element | null {
  const layers = spec.elements.filter((e) => e.panel === side);
  for (let i = layers.length - 1; i >= 0; i--) {
    const el = layers[i];
    const { w, h } = elementSize(spec, el);
    if (w <= 0) continue;
    const [lx, ly] = toLocal(el, p);
    if (Math.abs(lx) <= w / 2 + slopMm && Math.abs(ly) <= h / 2 + slopMm) return el;
  }
  return null;
}

/** Resize keeps the layer's proportions; text scales its font size, logos their width. */
export function resized(el: Element, k: number): Element {
  const f = Math.max(0.1, k);
  if (el.type === 'logo') return { ...el, width: Math.max(10, Math.min(400, el.width * f)) };
  const size = Math.max(8, Math.min(320, el.size * f));
  const ratio = size / el.size;
  return { ...el, size, max_width: el.max_width ? Math.min(520, Math.max(10, el.max_width * ratio)) : el.max_width };
}

export function rotatedTo(el: Element, startPt: Pt, p: Pt): Element {
  const a0 = Math.atan2(startPt[1] - el.y, startPt[0] - el.x);
  const a1 = Math.atan2(p[1] - el.y, p[0] - el.x);
  let deg = el.rotation + ((a1 - a0) * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(deg) < 4) deg = 0; // snap upright
  return { ...el, rotation: Math.round(deg) };
}

/** Positions are limited to what the server accepts (-200..900 mm). */
export function clampPos(v: number): number {
  return Math.max(-200, Math.min(900, v));
}
