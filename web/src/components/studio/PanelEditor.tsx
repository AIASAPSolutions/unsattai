'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SvgImg } from '@/components/ui';
import type { DesignSpec, Element, Panel } from '@/lib/api/types';
import { contrastRatio } from '@/lib/color';
import { elementSize, isSafe, safeZone, TEXT_ASCENT, textValue, type Pt } from '@/lib/geometry';
import { updateElement } from '@/lib/spec';
import { clampPos, hitTest, resized, rotatePt, rotatedTo } from './editorMath';
import s from './studio.module.css';

const FONT: Record<string, { family: string; weight: number }> = {
  block: { family: '"Arial Black", "Helvetica Neue", Arial, sans-serif', weight: 900 },
  athletic: { family: 'Rockwell, "Roboto Slab", Georgia, serif', weight: 800 },
  modern: { family: 'Bahnschrift, "Arial Narrow", "Roboto Condensed", sans-serif', weight: 700 },
};

/** Where the resize and rotate handles sit for a layer, at `k` screen pixels per millimetre. */
function handlesFor(spec: DesignSpec, el: Element, k: number): { resize: Pt; rotate: Pt } {
  const { w, h } = elementSize(spec, el);
  const pad = 6 / k;
  return { resize: rotatePt(el, [w / 2 + pad, h / 2 + pad]), rotate: rotatePt(el, [0, -h / 2 - 34 / k]) };
}

type Mode = { kind: 'move' | 'resize' | 'rotate'; id: string; start: Element; startPt: Pt; moved: boolean } | null;

export interface EditorLabels {
  canvas: string;
  layerName: (el: Element) => string;
  resize: string;
  rotate: string;
}

/**
 * The 2D editor: the server's panel art as an image, with the customer's text and logo
 * layers drawn on top so they can be dragged, resized and rotated with a pointer, and
 * nudged with the keyboard. One drag (or one run of key presses) is one undo step.
 */
export function PanelEditor({ spec, panel, selectedId, onSelect, onBegin, onLive, onCommit, onDelete, labels, testId }: {
  spec: DesignSpec;
  panel: Panel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBegin: () => void;
  onLive: (spec: DesignSpec) => void;
  onCommit: () => void;
  onDelete: (id: string) => void;
  labels: EditorLabels;
  testId?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mode = useRef<Mode>(null);
  const keyGesture = useRef(false);
  const specRef = useRef(spec);
  useLayoutEffect(() => {
    specRef.current = spec;
  }, [spec]);
  const side = panel.side;
  const editable = panel.editable && side !== null;
  const zone = useMemo(() => (side ? safeZone(spec.garment, side, { sleeves: spec.sleeves, collar: spec.collar }) : null), [spec.garment, spec.sleeves, spec.collar, side]);
  const layers = side ? spec.elements.filter((e) => e.panel === side) : [];
  const selected = layers.find((e) => e.id === selectedId) ?? null;

  const toMm = (clientX: number, clientY: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * panel.width, ((clientY - r.top) / r.height) * panel.height];
  };
  const pxPerMm = () => (svgRef.current ? svgRef.current.getBoundingClientRect().width / panel.width || 1 : 1);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setScale(el.getBoundingClientRect().width / panel.width || 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel.width]);


  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!editable || !side || e.button !== 0) return;
    const p = toMm(e.clientX, e.clientY);
    const cur = specRef.current;
    const k = pxPerMm();
    const sel = cur.elements.find((x) => x.id === selectedId && x.panel === side);
    mode.current = null;
    if (sel) {
      const hd = handlesFor(cur, sel, k);
      const near = (q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]) * k < 18;
      if (near(hd.resize)) mode.current = { kind: 'resize', id: sel.id, start: sel, startPt: p, moved: false };
      else if (near(hd.rotate)) mode.current = { kind: 'rotate', id: sel.id, start: sel, startPt: p, moved: false };
    }
    if (!mode.current) {
      const hit = hitTest(cur, side, p);
      if (!hit) {
        onSelect(null);
        return;
      }
      if (hit.id !== selectedId) onSelect(hit.id);
      mode.current = { kind: 'move', id: hit.id, start: hit, startPt: p, moved: false };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    onBegin();
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const m = mode.current;
    if (!m) return;
    const p = toMm(e.clientX, e.clientY);
    if (!m.moved && Math.hypot(p[0] - m.startPt[0], p[1] - m.startPt[1]) * pxPerMm() < 3) return;
    m.moved = true;
    let next: Element = m.start;
    if (m.kind === 'move') {
      next = { ...m.start, x: clampPos(m.start.x + p[0] - m.startPt[0]), y: clampPos(m.start.y + p[1] - m.startPt[1]) };
    } else if (m.kind === 'resize') {
      const d0 = Math.hypot(m.startPt[0] - m.start.x, m.startPt[1] - m.start.y) || 1;
      const d1 = Math.hypot(p[0] - m.start.x, p[1] - m.start.y);
      next = resized(m.start, d1 / d0);
    } else {
      next = rotatedTo(m.start, m.startPt, p);
    }
    onLive(updateElement(specRef.current, m.id, next));
  };

  const endPointer = (e: PointerEvent<SVGSVGElement>) => {
    if (!mode.current) return;
    mode.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit();
  };

  // Keyboard: arrows move (Shift = 10 mm), + / - resize, [ / ] rotate, Delete removes, Esc deselects, Tab cycles layers.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || !side) return;
    if (e.key === 'Tab' && layers.length && !e.ctrlKey && !e.metaKey) {
      const i = layers.findIndex((l) => l.id === selectedId);
      const n = i + (e.shiftKey ? -1 : 1);
      if (n >= 0 && n < layers.length) {
        e.preventDefault();
        onSelect(layers[n].id);
      }
      return;
    }
    if (!selected) return;
    if (e.key === 'Escape') {
      onSelect(null);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete(selected.id);
      return;
    }
    const step = e.shiftKey ? 10 : 2;
    let next: Element | null = null;
    if (e.key === 'ArrowLeft') next = { ...selected, x: clampPos(selected.x - step) };
    else if (e.key === 'ArrowRight') next = { ...selected, x: clampPos(selected.x + step) };
    else if (e.key === 'ArrowUp') next = { ...selected, y: clampPos(selected.y - step) };
    else if (e.key === 'ArrowDown') next = { ...selected, y: clampPos(selected.y + step) };
    else if (e.key === '+' || e.key === '=') next = resized(selected, e.shiftKey ? 1.1 : 1.03);
    else if (e.key === '-' || e.key === '_') next = resized(selected, e.shiftKey ? 1 / 1.1 : 1 / 1.03);
    else if (e.key === ']') next = { ...selected, rotation: Math.min(180, selected.rotation + (e.shiftKey ? 15 : 1)) };
    else if (e.key === '[') next = { ...selected, rotation: Math.max(-180, selected.rotation - (e.shiftKey ? 15 : 1)) };
    if (!next) return;
    e.preventDefault();
    if (!keyGesture.current) {
      keyGesture.current = true;
      onBegin();
    }
    onLive(updateElement(specRef.current, selected.id, next));
  };
  const onKeyUp = () => {
    if (keyGesture.current) {
      keyGesture.current = false;
      onCommit();
    }
  };

  return (
    <div className={s.stage} style={{ aspectRatio: `${panel.width} / ${panel.height}` }} data-testid={testId}
      tabIndex={editable ? 0 : -1} role="application" aria-label={labels.canvas} aria-roledescription="editor"
      onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={onKeyUp}>
      <SvgImg svg={panel.svg} alt={panel.name} className={s.stageImg} testId="panel-art" />
      <svg ref={svgRef} className={s.overlay} viewBox={`0 0 ${panel.width} ${panel.height}`} data-testid="panel-overlay"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer}>
        {zone ? (
          <g pointerEvents="none" data-testid="safe-zone">
            <path d={`${panel.outline} M${zone.map((p) => p.join(',')).join(' L')} Z`} fill="#c0262d" fillOpacity={0.07} fillRule="evenodd" />
            <polygon points={zone.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={3} strokeOpacity={0.9} />
            <polygon points={zone.map((p) => p.join(',')).join(' ')} fill="none" stroke="#13225a" strokeWidth={2} strokeDasharray="10 8" />
          </g>
        ) : null}
        {layers.map((el) => (
          <Layer key={el.id} spec={spec} el={el} selected={el.id === selectedId} label={labels.layerName(el)}
            onFocus={() => el.id !== selectedId && onSelect(el.id)} />
        ))}
        {selected ? <Selection spec={spec} el={selected} k={scale} handles={handlesFor(spec, selected, scale)} labels={labels} /> : null}
      </svg>
    </div>
  );
}

function Layer({ spec, el, selected, label, onFocus }: { spec: DesignSpec; el: Element; selected: boolean; label: string; onFocus: () => void }) {
  const rot = el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined;
  const common = {
    className: s.layer, 'data-testid': `layer-${el.id}`, 'data-layer-type': el.type, 'aria-label': label,
    'aria-pressed': selected, role: 'button' as const, tabIndex: -1, onFocus,
  };
  if (el.type === 'logo') {
    const w = el.width;
    const h = el.width * el.aspect;
    return (
      <g transform={rot} {...common}>
        <image href={el.src} x={el.x - w / 2} y={el.y - h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
      </g>
    );
  }
  const value = textValue(spec, el);
  if (!value) return null;
  const fill = el.color || spec.palette[el.color_role ?? 'text'];
  const stroke = contrastRatio(spec.palette.trim, fill) > 2 ? spec.palette.trim : '#000000';
  const font = FONT[el.font ?? spec.typography.font] ?? FONT.block;
  const natural = [...value].length * el.size * 0.62;
  const squeeze = el.max_width && natural > el.max_width ? { textLength: el.max_width, lengthAdjust: 'spacingAndGlyphs' as const } : {};
  const t = { x: el.x, y: el.y + el.size * TEXT_ASCENT, fontSize: el.size, fontWeight: font.weight, fontFamily: font.family, textAnchor: 'middle' as const };
  return (
    <g transform={rot} {...common}>
      <text {...t} stroke={stroke} strokeWidth={Math.max(1, el.size * 0.08)} strokeLinejoin="round" fill={stroke} {...squeeze}>{value}</text>
      <text {...t} fill={fill} {...squeeze}>{value}</text>
    </g>
  );
}

function Selection({ spec, el, k, handles, labels }: { spec: DesignSpec; el: Element; k: number; handles: { resize: Pt; rotate: Pt }; labels: EditorLabels }) {
  const { w, h } = elementSize(spec, el);
  const safe = isSafe(spec, el);
  const pad = 6 / k;
  const c = safe ? '#2159d9' : '#c0262d';
  const top = rotatePt(el, [0, -h / 2 - pad]);
  return (
    <g data-testid="selection" data-safe={safe ? 'true' : 'false'}>
      <g transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined} pointerEvents="none">
        <rect x={el.x - w / 2 - pad} y={el.y - h / 2 - pad} width={w + 2 * pad} height={h + 2 * pad} fill="none" stroke={c}
          strokeWidth={2 / k} strokeDasharray={safe ? undefined : `${8 / k} ${5 / k}`} />
      </g>
      <line x1={top[0]} y1={top[1]} x2={handles.rotate[0]} y2={handles.rotate[1]} stroke={c} strokeWidth={1.5 / k} pointerEvents="none" />
      <circle className={s.rotHandle} cx={handles.rotate[0]} cy={handles.rotate[1]} r={10 / k} fill="#fff" stroke={c} strokeWidth={2 / k}
        data-testid="handle-rotate" aria-label={labels.rotate} />
      <circle className={s.handle} cx={handles.resize[0]} cy={handles.resize[1]} r={11 / k} fill={c} stroke="#fff" strokeWidth={2 / k}
        data-testid="handle-resize" aria-label={labels.resize} />
    </g>
  );
}
