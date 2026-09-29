import {
  FIT_SIZES, FITS, SLEEVES, COLLARS,
  type Collar, type DesignSpec, type Fit, type Garment, type Meta, type OrderItem, type Size, type SizeGuide, type SizeGuideRow,
  type Sleeves,
} from '../api/types';

// Fits (Men / unisex, Women, Kids), their size lists, garment options and the size-guide table.
// Pure functions so the screens, the cart and the tests share one set of rules.

/** Lines saved before fits existed have none: they are men's. */
export function fitOf(x: { fit?: Fit | string | null } | null | undefined): Fit {
  const f = x?.fit;
  return f === 'women' || f === 'kids' ? f : 'men';
}

/** The fits the server offers, in order (all three when the server is older). */
export function fitsFrom(meta: Meta | null | undefined): Fit[] {
  const listed = meta?.options?.fits?.filter((f): f is Fit => (FITS as readonly string[]).includes(f));
  return listed?.length ? listed : [...FITS];
}

/** Sizes for a fit, from meta `fit_sizes` when the server sent them. */
export function sizesForFit(fit: Fit, meta?: Meta | null): Size[] {
  const fromServer = meta?.fit_sizes?.[fit];
  return fromServer?.length ? [...fromServer] : [...FIT_SIZES[fit]];
}

export function sizeFitsFit(fit: Fit, size: Size, meta?: Meta | null): boolean {
  return sizesForFit(fit, meta).includes(size);
}

const DEFAULT_SIZE: Record<Fit, Size> = { men: 'M', women: 'M', kids: '8Y' };

/** A new fit keeps the size when that fit has it; otherwise the fit's middle size. */
export function sizeForNewFit(fit: Fit, size: Size, meta?: Meta | null): Size {
  const list = sizesForFit(fit, meta);
  if (list.includes(size)) return size;
  return list.includes(DEFAULT_SIZE[fit]) ? DEFAULT_SIZE[fit] : list[Math.floor(list.length / 2)] ?? DEFAULT_SIZE[fit];
}

/** Every line with its fit set (old lines become men's), as the server takes them. */
export function withFit<L extends OrderItem>(lines: L[]): (L & { fit: Fit })[] {
  return lines.map((l) => ({ ...l, fit: fitOf(l) }));
}

/** Size for render/print checks: "M" for men, "kids:8Y" for other fits. */
export function checkSize(line: { fit?: Fit; size: Size }): string {
  const fit = fitOf(line);
  return fit === 'men' ? line.size : `${fit}:${line.size}`;
}

export const FIT_KEY = { men: 'fit_men', women: 'fit_women', kids: 'fit_kids' } as const;
export const SLEEVES_KEY = { short: 'sleeves_short', long: 'sleeves_long', none: 'sleeves_none' } as const;
export const COLLAR_KEY = { crew: 'collar_crew', polo: 'collar_polo', mandarin: 'collar_mandarin' } as const;

/** Tops have sleeves; shorts do not. */
export function hasSleeves(garment: Garment | null | undefined): boolean {
  return garment !== 'shorts';
}

/** Only the round-neck jersey has a collar choice: a V-neck keeps its V. */
export function hasCollar(garment: Garment | null | undefined): boolean {
  return garment === 'jersey';
}

export function sleevesOf(spec: Pick<DesignSpec, 'sleeves'> | null | undefined): Sleeves {
  const s = spec?.sleeves;
  return s && (SLEEVES as readonly string[]).includes(s) ? s : 'short';
}

export function collarOf(spec: Pick<DesignSpec, 'collar'> | null | undefined): Collar {
  const c = spec?.collar;
  return c && (COLLARS as readonly string[]).includes(c) ? c : 'crew';
}

/** Options to send with a generate / from-image request: only what the customer picked, only where it applies. */
export function pickedOptions(garment: Garment, picked: { sleeves?: Sleeves | null; collar?: Collar | null } | null | undefined) {
  const out: { sleeves?: Sleeves; collar?: Collar } = {};
  if (picked?.sleeves && hasSleeves(garment)) out.sleeves = picked.sleeves;
  if (picked?.collar && hasCollar(garment)) out.collar = picked.collar;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- size guide table

export type GuideColumn =
  | 'chest' | 'length' | 'shoulder' | 'sleeve' | 'waist' | 'hip' | 'shorts_length' | 'body_chest' | 'height';

/** Columns for the garment: tops show the sleeve for the current sleeves; kids also show height. */
export function guideColumns(garment: Garment, sleeves: Sleeves, fit: Fit): GuideColumn[] {
  const garmentCols: GuideColumn[] = garment === 'shorts'
    ? ['waist', 'hip', 'shorts_length']
    : ['chest', 'length', 'shoulder', ...(sleeves === 'none' ? [] : ['sleeve' as const])];
  return [...garmentCols, 'body_chest', ...(fit === 'kids' ? ['height' as const] : [])];
}

const range = (r: [number, number] | null | undefined) => (r ? `${r[0]}–${r[1]}` : '—');

export function guideCell(row: SizeGuideRow, col: GuideColumn, sleeves: Sleeves): string {
  switch (col) {
    case 'chest': return String(row.top.chest);
    case 'length': return String(row.top.length);
    case 'shoulder': return String(row.top.shoulder);
    case 'sleeve': return String(sleeves === 'long' ? row.top.sleeve_long : row.top.sleeve_short);
    case 'waist': return String(row.shorts.waist);
    case 'hip': return String(row.shorts.hip);
    case 'shorts_length': return String(row.shorts.length);
    case 'body_chest': return range(row.body_chest);
    case 'height': return range(row.height);
  }
}

export interface GuideTable {
  fit: Fit;
  name: string;
  columns: GuideColumn[];
  rows: { size: Size; cells: string[] }[];
}

export function guideTable(guide: SizeGuide, fit: Fit, garment: Garment, sleeves: Sleeves): GuideTable | null {
  const chart = guide.fits.find((f) => f.id === fit);
  if (!chart) return null;
  const columns = guideColumns(garment, sleeves, fit);
  return {
    fit, name: chart.name, columns,
    rows: chart.sizes.map((r) => ({ size: r.size, cells: columns.map((c) => guideCell(r, c, sleeves)) })),
  };
}

/** How-to-measure notes that matter for the columns shown. */
export function guideHowTo(guide: SizeGuide, columns: GuideColumn[]): SizeGuide['how_to_measure'] {
  const wanted = new Set<string>(columns.map((c) => (c === 'shorts_length' ? 'length' : c)));
  return guide.how_to_measure.filter((m) => wanted.has(m.id));
}

/** Price text for an option: "+₹60", "−₹20" or "" when it costs nothing extra. */
export function priceDelta(price: number | undefined, format: (n: number) => string): string {
  if (!price) return '';
  return price > 0 ? `+${format(price)}` : `−${format(Math.abs(price))}`;
}
