/**
 * Settings section "sizing" (the Men / Women / Kids size charts) <-> editable form. Pure and unit tested.
 *
 * Measurements are of the finished garment laid flat, in cm. The size list of each fit is fixed by the
 * server; only the numbers change. Errors use the server's 422 paths ("fits.kids.sizes.2.top.chest").
 */
import { Collector, numText, type Converted } from './settingsForm';
import { FIT_SIZES, FITS, type Fit, type Size } from './types';

export interface SizeRow {
  size: Size;
  /** The wearer's chest, all round, that the size fits: [from, to] cm. */
  body_chest: [number, number];
  /** Kids: the child's height [from, to] cm. null for adults. */
  height: [number, number] | null;
  top: { chest: number; length: number; shoulder: number; sleeve_short: number; sleeve_long: number };
  shorts: { waist: number; hip: number; length: number };
}
export interface Sizing {
  unit: 'cm';
  tolerance_cm: number;
  note: string;
  fits: Record<Fit, { name: string; sizes: SizeRow[] }>;
}

export type TopKey = keyof SizeRow['top'];
export type ShortsKey = keyof SizeRow['shorts'];

/** Columns of the editor, with the server's limits (exclusive, as in config.py TopMeasure / ShortsMeasure). */
export const TOP_FIELDS: { key: TopKey; label: string; gt: number; lt: number }[] = [
  { key: 'chest', label: 'Chest', gt: 10, lt: 120 },
  { key: 'length', label: 'Length', gt: 20, lt: 130 },
  { key: 'shoulder', label: 'Shoulder', gt: 10, lt: 90 },
  { key: 'sleeve_short', label: 'Sleeve, short', gt: 3, lt: 60 },
  { key: 'sleeve_long', label: 'Sleeve, long', gt: 15, lt: 100 },
];
export const SHORTS_FIELDS: { key: ShortsKey; label: string; gt: number; lt: number }[] = [
  { key: 'waist', label: 'Waist', gt: 10, lt: 100 },
  { key: 'hip', label: 'Hip', gt: 15, lt: 110 },
  { key: 'length', label: 'Length', gt: 10, lt: 100 },
];

export interface SizeRowForm {
  size: Size;
  body_chest: [string, string];
  height: [string, string];
  top: Record<TopKey, string>;
  shorts: Record<ShortsKey, string>;
}
export interface SizingForm {
  tolerance_cm: string;
  note: string;
  fits: Record<Fit, { name: string; sizes: SizeRowForm[] }>;
}

const pair = (v: [number, number] | null | undefined): [string, string] => (v ? [numText(v[0]), numText(v[1])] : ['', '']);

export function sizingToForm(v: Sizing): SizingForm {
  const fits = {} as SizingForm['fits'];
  for (const fit of FITS) {
    const chart = v.fits[fit];
    // The rows always follow the fixed size list, whatever order (or gaps) the value has.
    const sizes = FIT_SIZES[fit].map((size): SizeRowForm => {
      const r = chart?.sizes.find((x) => x.size === size);
      const top = {} as SizeRowForm['top'];
      for (const f of TOP_FIELDS) top[f.key] = numText(r?.top[f.key]);
      const shorts = {} as SizeRowForm['shorts'];
      for (const f of SHORTS_FIELDS) shorts[f.key] = numText(r?.shorts[f.key]);
      return { size, body_chest: pair(r?.body_chest), height: pair(r?.height), top, shorts };
    });
    fits[fit] = { name: chart?.name ?? fit, sizes };
  }
  return { tolerance_cm: numText(v.tolerance_cm), note: v.note ?? '', fits };
}

/** A measurement strictly between gt and lt (the server's rule). */
function measure(c: Collector, path: string, text: string, gt: number, lt: number): number {
  const before = c.errors.length;
  const n = c.num(path, text);
  if (c.errors.length === before && (n <= gt || n >= lt)) c.add(path, `Between ${gt} and ${lt} cm.`);
  return n;
}

function range(c: Collector, path: string, v: [string, string], optional: boolean): [number, number] | null {
  if (optional && !v[0].trim() && !v[1].trim()) return null;
  const before = c.errors.length;
  const a = c.num(path, v[0], { min: 1, max: 250 });
  const b = c.num(path, v[1], { min: 1, max: 250 });
  if (c.errors.length === before && a > b) c.add(path, 'From must not be more than to.');
  return [a, b];
}

export function formToSizing(f: SizingForm, base: Partial<Sizing> = {}): Converted<Sizing> {
  const c = new Collector();
  const fits = {} as Sizing['fits'];
  for (const fit of FITS) {
    const chart = f.fits[fit];
    const name = c.required(`fits.${fit}.name`, chart.name);
    if (name.length > 40) c.add(`fits.${fit}.name`, 'At most 40 characters.');
    const sizes = chart.sizes.map((r, i): SizeRow => {
      const p = `fits.${fit}.sizes.${i}`;
      const top = {} as SizeRow['top'];
      for (const x of TOP_FIELDS) top[x.key] = measure(c, `${p}.top.${x.key}`, r.top[x.key], x.gt, x.lt);
      const shorts = {} as SizeRow['shorts'];
      for (const x of SHORTS_FIELDS) shorts[x.key] = measure(c, `${p}.shorts.${x.key}`, r.shorts[x.key], x.gt, x.lt);
      return {
        size: r.size,
        body_chest: range(c, `${p}.body_chest`, r.body_chest, false)!,
        // Kids charts give the child's height; adult charts have none.
        height: fit === 'kids' ? range(c, `${p}.height`, r.height, false) : null,
        top, shorts,
      };
    });
    const want = FIT_SIZES[fit];
    if (sizes.length !== want.length || sizes.some((r, i) => r.size !== want[i])) {
      c.add(`fits.${fit}`, `The sizes are fixed as ${want.join(', ')}.`);
    }
    // Same rule as the server: chest and length never shrink as sizes go up.
    sizes.forEach((r, i) => {
      if (!i) return;
      const prev = sizes[i - 1];
      if (r.top.chest < prev.top.chest) c.add(`fits.${fit}.sizes.${i}.top.chest`, `Must not be smaller than ${prev.size} (${prev.top.chest}).`);
      if (r.top.length < prev.top.length) c.add(`fits.${fit}.sizes.${i}.top.length`, `Must not be smaller than ${prev.size} (${prev.top.length}).`);
    });
    fits[fit] = { name, sizes };
  }
  const note = f.note.trim();
  if (note.length > 400) c.add('note', 'At most 400 characters.');
  const value: Sizing = {
    ...(base as Sizing),
    unit: 'cm',
    tolerance_cm: c.num('tolerance_cm', f.tolerance_cm, { min: 0, max: 5 }),
    note,
    fits,
  };
  return { value, errors: c.errors };
}

/** Errors for one fit's tab (for a count on the tab). */
export function fitErrorCount(errors: { path: string }[], fit: Fit): number {
  return errors.filter((e) => e.path === `fits.${fit}` || e.path.startsWith(`fits.${fit}.`)).length;
}
