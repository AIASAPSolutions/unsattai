import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, G, Image as SvgImg, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { SvgImage } from '../../components/SvgImage';
import type { DesignSpec, Element, LayerPanel, Panel } from '../../api/types';
import { contrastRatio } from '../../lib/color';
import { elementSize, isSafe, safeZone, TEXT_ASCENT, textValue, type Pt } from '../../lib/geometry';
import { updateElement } from '../../lib/spec';
import { colors } from '../../ui/theme';
import { VectorLogo } from './VectorLogo';

const FONT: Record<string, { family: string; weight: '700' | '800' | '900' }> = {
  block: { family: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' })!, weight: '900' },
  athletic: { family: Platform.select({ ios: 'Rockwell', android: 'serif', default: 'Rockwell, Georgia, serif' })!, weight: '800' },
  modern: { family: Platform.select({ ios: 'Avenir Next Condensed', android: 'sans-serif-condensed', default: 'Bahnschrift, "Arial Narrow", sans-serif' })!, weight: '700' },
};

const HANDLE_PX = 26;

type Mode = { kind: 'move' | 'resize' | 'rotate'; id: string; start: Element; startPt: Pt } | { kind: 'swipe' } | null;

function toLocal(el: Element, p: Pt): Pt {
  const a = (-el.rotation * Math.PI) / 180;
  const dx = p[0] - el.x;
  const dy = p[1] - el.y;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

function rotatePt(el: Element, local: Pt): Pt {
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

export function PanelEditor({ spec, panel, selectedId, onSelect, onBegin, onLive, onCommit, onSwipe, showSafe = true, testID }: {
  spec: DesignSpec;
  panel: Panel;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBegin: () => void;
  onLive: (spec: DesignSpec) => void;
  onCommit: () => void;
  onSwipe?: (dir: 1 | -1) => void;
  showSafe?: boolean;
  testID?: string;
}) {
  const [viewW, setViewW] = useState(1);
  const scale = Math.max(viewW, 1) / panel.width; // px per mm (layout can report 0 before first paint)
  const side = panel.side;
  const editable = panel.editable && side !== null;
  const mode = useRef<Mode>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const pinchStart = useRef<Element | null>(null);
  const rotStart = useRef<Element | null>(null);

  const zone = useMemo(() => (side ? safeZone(spec.garment, side) : null), [spec.garment, side]);
  const layers = side ? spec.elements.filter((e) => e.panel === side) : [];
  const selected = layers.find((e) => e.id === selectedId) ?? null;
  const toMm = (x: number, y: number): Pt => [x / scale, y / scale];

  const handles = (el: Element) => {
    const { w, h } = elementSize(spec, el);
    const pad = 6 / scale;
    return {
      resize: rotatePt(el, [w / 2 + pad, h / 2 + pad]),
      rotate: rotatePt(el, [0, -h / 2 - 34 / scale]),
    };
  };

  const tap = Gesture.Tap().runOnJS(true).maxDuration(350).onEnd((e) => {
    if (!editable || !side) return;
    const hit = hitTest(specRef.current, side, toMm(e.x, e.y));
    onSelect(hit ? hit.id : null);
  });

  const pan = Gesture.Pan().runOnJS(true).minDistance(4).maxPointers(1)
    .onStart((e) => {
      mode.current = null;
      if (!editable || !side) {
        mode.current = { kind: 'swipe' };
        return;
      }
      const p = toMm(e.x - e.translationX, e.y - e.translationY);
      const s = specRef.current;
      const sel = s.elements.find((x) => x.id === selectedId && x.panel === side);
      if (sel) {
        const hd = handles(sel);
        const near = (q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]) * scale < HANDLE_PX;
        if (near(hd.resize)) mode.current = { kind: 'resize', id: sel.id, start: sel, startPt: p };
        else if (near(hd.rotate)) mode.current = { kind: 'rotate', id: sel.id, start: sel, startPt: p };
      }
      if (!mode.current) {
        const hit = hitTest(s, side, p);
        if (hit) {
          if (hit.id !== selectedId) onSelect(hit.id);
          mode.current = { kind: 'move', id: hit.id, start: hit, startPt: p };
        } else {
          mode.current = { kind: 'swipe' };
        }
      }
      if (mode.current.kind !== 'swipe') onBegin();
    })
    .onUpdate((e) => {
      const m = mode.current;
      if (!m || m.kind === 'swipe') return;
      const p = toMm(e.x, e.y);
      const s = specRef.current;
      let next: Element = m.start;
      if (m.kind === 'move') {
        next = { ...m.start, x: m.start.x + e.translationX / scale, y: m.start.y + e.translationY / scale };
      } else if (m.kind === 'resize') {
        const d0 = Math.hypot(m.startPt[0] - m.start.x, m.startPt[1] - m.start.y) || 1;
        const d1 = Math.hypot(p[0] - m.start.x, p[1] - m.start.y);
        next = resized(m.start, d1 / d0);
      } else {
        const a0 = Math.atan2(m.startPt[1] - m.start.y, m.startPt[0] - m.start.x);
        const a1 = Math.atan2(p[1] - m.start.y, p[0] - m.start.x);
        let deg = m.start.rotation + ((a1 - a0) * 180) / Math.PI;
        deg = ((((deg + 180) % 360) + 360) % 360) - 180;
        if (Math.abs(deg) < 4) deg = 0; // snap upright
        next = { ...m.start, rotation: Math.round(deg) };
      }
      onLive(updateElement(s, m.id, next));
    })
    .onEnd((e) => {
      const m = mode.current;
      mode.current = null;
      if (m?.kind === 'swipe') {
        if (Math.abs(e.translationX) > 60 && Math.abs(e.translationX) > Math.abs(e.translationY) * 1.5) onSwipe?.(e.translationX < 0 ? 1 : -1);
        return;
      }
      if (m) onCommit();
    });

  const pinch = Gesture.Pinch().runOnJS(true)
    .onStart(() => {
      const sel = specRef.current.elements.find((x) => x.id === selectedId);
      pinchStart.current = sel ?? null;
      if (sel) onBegin();
    })
    .onUpdate((e) => {
      if (pinchStart.current) onLive(updateElement(specRef.current, pinchStart.current.id, resized(pinchStart.current, e.scale)));
    })
    .onEnd(() => {
      if (pinchStart.current) onCommit();
      pinchStart.current = null;
    });

  const twist = Gesture.Rotation().runOnJS(true)
    .onStart(() => {
      rotStart.current = specRef.current.elements.find((x) => x.id === selectedId) ?? null;
    })
    .onUpdate((e) => {
      const el = rotStart.current;
      if (!el) return;
      const cur = specRef.current.elements.find((x) => x.id === el.id);
      if (!cur) return;
      const deg = Math.round(((el.rotation + (e.rotation * 180) / Math.PI + 540) % 360) - 180);
      onLive(updateElement(specRef.current, el.id, { rotation: deg }));
    })
    .onEnd(() => {
      rotStart.current = null;
    });

  const gesture = Gesture.Simultaneous(Gesture.Exclusive(pan, tap), pinch, twist);

  return (
    <View testID={testID} onLayout={(e: LayoutChangeEvent) => setViewW(e.nativeEvent.layout.width)}
      style={[styles.wrap, { aspectRatio: panel.width / panel.height }]}>
      <SvgImage xml={panel.svg} aspect={panel.height / panel.width} style={StyleSheet.absoluteFill} label={panel.name} />
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Svg width="100%" height="100%" viewBox={`0 0 ${panel.width} ${panel.height}`} pointerEvents="none">
            {showSafe && zone ? (
              <>
                <Path d={`${panel.outline} M${zone.map((p) => p.join(',')).join(' L')} Z`} fill={colors.fail} fillOpacity={0.08} fillRule="evenodd" />
                <Polygon points={zone.map((p) => p.join(',')).join(' ')} fill="none" stroke="#ffffff" strokeWidth={3} strokeOpacity={0.9} />
                <Polygon points={zone.map((p) => p.join(',')).join(' ')} fill="none" stroke={colors.navy} strokeWidth={2} strokeDasharray="10 8" />
              </>
            ) : null}
            {layers.map((el) => <Layer key={el.id} spec={spec} el={el} />)}
            {selected ? <Selection spec={spec} el={selected} scale={scale} handles={handles(selected)} /> : null}
          </Svg>
        </View>
      </GestureDetector>
    </View>
  );
}

function Layer({ spec, el }: { spec: DesignSpec; el: Element }) {
  const rot = el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined;
  if (el.type === 'logo') {
    const w = el.width;
    const h = el.width * el.aspect;
    return (
      <G transform={rot}>
        {el.kind === 'vector'
          ? <VectorLogo src={el.src} x={el.x - w / 2} y={el.y - h / 2} width={w} height={h} />
          : <SvgImg href={el.src} x={el.x - w / 2} y={el.y - h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />}
      </G>
    );
  }
  const value = textValue(spec, el);
  if (!value) return null;
  const fill = el.color || spec.palette[el.color_role ?? 'text'];
  const stroke = contrastRatio(spec.palette.trim, fill) > 2 ? spec.palette.trim : '#000000';
  const font = FONT[el.font ?? spec.typography.font] ?? FONT.block;
  const natural = [...value].length * el.size * 0.62;
  const squeeze = el.max_width && natural > el.max_width ? { textLength: el.max_width, lengthAdjust: 'spacingAndGlyphs' as const } : {};
  return (
    <G transform={rot}>
      <SvgText x={el.x} y={el.y + el.size * TEXT_ASCENT} fontSize={el.size} fontWeight={font.weight} fontFamily={font.family}
        textAnchor="middle" stroke={stroke} strokeWidth={Math.max(1, el.size * 0.08)} strokeLinejoin="round" fill={stroke} {...squeeze}>
        {value}
      </SvgText>
      <SvgText x={el.x} y={el.y + el.size * TEXT_ASCENT} fontSize={el.size} fontWeight={font.weight} fontFamily={font.family}
        textAnchor="middle" fill={fill} {...squeeze}>
        {value}
      </SvgText>
    </G>
  );
}

function Selection({ spec, el, scale, handles }: { spec: DesignSpec; el: Element; scale: number; handles: { resize: Pt; rotate: Pt } }) {
  const { w, h } = elementSize(spec, el);
  const safe = isSafe(spec, el);
  const pad = 6 / scale;
  const c = safe ? colors.blue : colors.fail;
  const top = rotatePt(el, [0, -h / 2 - pad]);
  return (
    <G>
      <G transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}>
        <Rect x={el.x - w / 2 - pad} y={el.y - h / 2 - pad} width={w + 2 * pad} height={h + 2 * pad} fill="none" stroke={c}
          strokeWidth={2 / scale} strokeDasharray={safe ? undefined : `${8 / scale} ${5 / scale}`} />
      </G>
      <Line x1={top[0]} y1={top[1]} x2={handles.rotate[0]} y2={handles.rotate[1]} stroke={c} strokeWidth={1.5 / scale} />
      <Circle cx={handles.rotate[0]} cy={handles.rotate[1]} r={10 / scale} fill="#fff" stroke={c} strokeWidth={2 / scale} />
      <Circle cx={handles.resize[0]} cy={handles.resize[1]} r={12 / scale} fill={c} stroke="#fff" strokeWidth={2 / scale} />
    </G>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: '#e9ecf2', borderRadius: 12, overflow: 'hidden' },
});
