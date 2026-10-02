import type {
  ColorRole, DesignSpec, Element, LayerPanel, LogoElement, TextElement,
} from '../api/types';
import { MAX_LOGOS } from '../api/types';
import { fitScale, isSafe, panelSize, zoneCenter } from './geometry';
import { newId } from './ids';

// Immutable spec edits. Only the touched branch is copied, so fields this app
// does not know about (added by a newer server) are carried along untouched.

export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const current = (obj as Record<string, unknown>)[head];
  const next = rest.length ? setPath((current ?? {}) as object, rest.join('.'), value) : value;
  if (Object.is(current, next)) return obj;
  return { ...obj, [head]: next } as T;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function hasBoundLayers(spec: DesignSpec): boolean {
  return (spec.elements ?? []).some((e) => e.type === 'text' && !!e.bind);
}

/** True once names and numbers are editable layers (even if the customer later deleted them all). */
export function usesLayers(spec: DesignSpec): boolean {
  return spec.text_layers === true || hasBoundLayers(spec);
}

/** Switch a spec to editable layers, using the server's default team/player/number placement. */
export function materializeLayers(spec: DesignSpec, defaults: TextElement[]): DesignSpec {
  if (usesLayers(spec)) return { ...spec, elements: spec.elements ?? [], text_layers: true };
  const filled = defaults.map((d) => ({ ...d, rotation: d.rotation ?? 0, text: d.text ?? '', color_role: d.color_role ?? ('text' as ColorRole) }));
  return { ...spec, elements: [...filled, ...(spec.elements ?? [])], text_layers: true };
}

export function updateElement(spec: DesignSpec, id: string, patch: Partial<Element>): DesignSpec {
  return { ...spec, elements: spec.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as Element) : e)) };
}

export function removeElement(spec: DesignSpec, id: string): DesignSpec {
  return { ...spec, elements: spec.elements.filter((e) => e.id !== id) };
}

export function addElement(spec: DesignSpec, el: Element): DesignSpec {
  return { ...spec, elements: [...spec.elements, el] };
}

export function logoCount(spec: DesignSpec): number {
  return spec.elements.filter((e) => e.type === 'logo').length;
}

export function canAddLogo(spec: DesignSpec): boolean {
  return logoCount(spec) < MAX_LOGOS;
}

// Crest positions in order of preference: left chest, right chest, upper back, lower back.
const LOGO_SPOTS: { panel: LayerPanel; x: number; y: number }[] = [
  { panel: 'front', x: 385, y: 185 },
  { panel: 'front', x: 155, y: 185 },
  { panel: 'back', x: 270, y: 610 },
  { panel: 'front', x: 270, y: 600 },
];
const SHORTS_SPOTS: { panel: LayerPanel; x: number; y: number }[] = [
  { panel: 'front', x: 470, y: 250 },
  { panel: 'front', x: 170, y: 250 },
  { panel: 'back', x: 320, y: 120 },
  { panel: 'back', x: 470, y: 250 },
];

function overlaps(a: Element, b: Element): boolean {
  if (a.panel !== b.panel) return false;
  const size = (e: Element) => (e.type === 'logo' ? [e.width, e.width * e.aspect] : [[...e.text].length * e.size * 0.6, e.size]);
  const [aw, ah] = size(a);
  const [bw, bh] = size(b);
  return Math.abs(a.x - b.x) < (aw + bw) / 2 && Math.abs(a.y - b.y) < (ah + bh) / 2;
}

export function placeLogo(
  spec: DesignSpec,
  logo: Omit<LogoElement, 'id' | 'panel' | 'x' | 'y' | 'rotation'>,
  preferredPanel?: LayerPanel,
): LogoElement {
  const spots = (spec.garment === 'shorts' ? SHORTS_SPOTS : LOGO_SPOTS)
    .slice()
    .sort((a, b) => (preferredPanel ? Number(b.panel === preferredPanel) - Number(a.panel === preferredPanel) : 0));
  const base = { ...logo, id: newId('logo'), rotation: 0 } as LogoElement;
  for (const s of spots) {
    const candidate: LogoElement = { ...base, panel: s.panel, x: s.x, y: s.y };
    const k = fitScale(spec, candidate);
    const fitted = { ...candidate, width: candidate.width * k };
    if (isSafe(spec, fitted) && !spec.elements.some((e) => overlaps(e, fitted))) return fitted;
  }
  const [x, y] = zoneCenter(spec.garment, preferredPanel ?? 'front', spec.sleeves, spec.collar);
  const centered: LogoElement = { ...base, panel: preferredPanel ?? 'front', x, y };
  return { ...centered, width: centered.width * fitScale(spec, centered) };
}

export function newTextLayer(spec: DesignSpec, panel: LayerPanel, text: string): TextElement {
  const [x, y] = zoneCenter(spec.garment, panel, spec.sleeves, spec.collar);
  const el: TextElement = {
    id: newId('text'), type: 'text', panel, x, y: y + 120, rotation: 0, text, size: 40,
    font: null, color_role: 'text', color: null, bind: null,
  };
  const k = fitScale(spec, el);
  return { ...el, size: Math.max(8, el.size * k) };
}

/**
 * After a change of sleeves or collar the safe print area can be smaller (sleeveless armholes,
 * a polo placket): layers that no longer fit are shrunk where they are, or centred and shrunk.
 */
export function fitLayersToZone(spec: DesignSpec): DesignSpec {
  let changed = false;
  const scale = (el: Element, k: number): Element =>
    el.type === 'logo' ? { ...el, width: el.width * k } : { ...el, size: el.size * k, max_width: el.max_width ? el.max_width * k : el.max_width };
  const elements = (spec.elements ?? []).map((el) => {
    if (isSafe(spec, el)) return el;
    changed = true;
    const inPlace = scale(el, fitScale(spec, el));
    if (isSafe(spec, inPlace) && fitScale(spec, el) > 0.5) return inPlace;
    const [cx] = zoneCenter(spec.garment, el.panel, spec.sleeves, spec.collar);
    const centred = { ...el, x: cx } as Element;
    return scale(centred, fitScale(spec, centred));
  });
  return changed ? { ...spec, elements } : spec;
}

export function personalise(spec: DesignSpec, playerName: string, number: string): DesignSpec {
  return { ...spec, typography: { ...spec.typography, player_name: playerName, number } };
}

export function panelDims(spec: DesignSpec) {
  return panelSize(spec.garment);
}

/** Plain-text summary used by the share sheet. */
export function describeSpec(spec: DesignSpec, labels: {
  garment: string; sport: string; pattern: string; coverage: string; font: string;
}): string {
  const t = spec.typography;
  const lines = [
    `${spec.style_name}`,
    `${labels.garment} · ${labels.sport}`,
    `Colours: primary ${spec.palette.primary}, secondary ${spec.palette.secondary}, accent ${spec.palette.accent}, ` +
      `trim ${spec.palette.trim}, text ${spec.palette.text}`,
    `Pattern: ${labels.pattern} (${labels.coverage}), scale ${spec.pattern.scale}`,
    `Font: ${labels.font}`,
  ];
  if (t.team_name) lines.push(`Team: ${t.team_name}`);
  if (t.player_name) lines.push(`Player: ${t.player_name}`);
  if (t.number) lines.push(`Number: ${t.number}`);
  const logos = spec.elements.filter((e) => e.type === 'logo').length;
  const texts = spec.elements.filter((e) => e.type === 'text' && !e.bind).length;
  if (logos) lines.push(`Logos: ${logos}`);
  if (texts) lines.push(`Extra text layers: ${texts}`);
  if (spec.rationale) lines.push('', spec.rationale);
  lines.push('', 'Designed with Unsattai');
  return lines.join('\n');
}
