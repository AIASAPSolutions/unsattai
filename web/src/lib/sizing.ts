import {
  ALL_SIZES, FIT_SIZES, FITS, type Fit, type Garment, type OrderItem, type Size, type SizeGuide, type SizeGuideRow, type Sleeves,
} from './api/types';

// Fits (Men / unisex, Women, Kids) and their size lists, and the size guide table.
// Pure helpers: the server's lists (meta `fit_sizes`, a collection's `fit_sizes`) win when
// they are known; the built-in lists match the server's fixed charts for everything else.

export type FitSizes = Partial<Record<Fit, readonly string[]>>;

/** A fit from any value (older data has none): unknown means men / unisex. */
export function normaliseFit(v: unknown): Fit {
  return typeof v === 'string' && (FITS as readonly string[]).includes(v) ? (v as Fit) : 'men';
}

/** The fits to offer: the server's active ones (in chart order), else all three. */
export function fitsFrom(source?: FitSizes | null): Fit[] {
  const active = FITS.filter((f) => (source?.[f]?.length ?? 0) > 0);
  return active.length ? active : [...FITS];
}

/** Sizes of a fit, from the server's list when there is one. */
export function sizesFor(fit: Fit, source?: FitSizes | null): Size[] {
  const own = source?.[fit];
  const list = own && own.length ? own : FIT_SIZES[fit];
  return list.filter((s): s is Size => (ALL_SIZES as readonly string[]).includes(s));
}

export function isFitSize(fit: Fit, size: string, source?: FitSizes | null): boolean {
  return (sizesFor(fit, source) as string[]).includes(size);
}

const DEFAULT_SIZE: Record<Fit, Size> = { men: 'M', women: 'M', kids: '8Y' };

/** Keep the size when the new fit has it; otherwise the fit's middle size (M, or 8Y for kids). */
export function sizeForFit(fit: Fit, current: string | null | undefined, source?: FitSizes | null): Size {
  const sizes = sizesFor(fit, source);
  if (current && (sizes as string[]).includes(current)) return current as Size;
  return sizes.includes(DEFAULT_SIZE[fit]) ? DEFAULT_SIZE[fit] : sizes[Math.floor(sizes.length / 2)] ?? DEFAULT_SIZE[fit];
}

/** Sort key: fits in chart order (men, women, kids), then sizes small to large. */
export function sizeRank(fit: Fit | undefined, size: string): number {
  return FITS.indexOf(normaliseFit(fit)) * 100 + Math.max(0, (ALL_SIZES as readonly string[]).indexOf(size));
}

/** The server's print checks take "M" for men and "fit:size" for the others ("kids:8Y"). */
export function checkSize(fit: Fit | undefined, size: string): string {
  const f = normaliseFit(fit);
  return f === 'men' ? size : `${f}:${size}`;
}

/** Pieces per fit and size, in chart order. */
export function fitSizeBreakdown(rows: Pick<OrderItem, 'fit' | 'size' | 'quantity'>[]): { fit: Fit; size: Size; quantity: number }[] {
  const by = new Map<string, { fit: Fit; size: Size; quantity: number }>();
  for (const r of rows) {
    const fit = normaliseFit(r.fit);
    const k = `${fit}|${r.size}`;
    const cur = by.get(k);
    if (cur) cur.quantity += r.quantity || 0;
    else by.set(k, { fit, size: r.size, quantity: r.quantity || 0 });
  }
  return [...by.values()].filter((x) => x.quantity > 0).sort((a, b) => sizeRank(a.fit, a.size) - sizeRank(b.fit, b.size));
}

/**
 * "M × 2, L × 1" when everything is men / unisex; otherwise each size says its fit
 * ("Women S × 1, Kids 8Y × 2"), using the label function for the fit's name.
 */
export function fitSizeSummary(rows: Pick<OrderItem, 'fit' | 'size' | 'quantity'>[], fitLabel: (f: Fit) => string, joiner = ', ', times = ' × '): string {
  const parts = fitSizeBreakdown(rows);
  const mixed = parts.some((p) => p.fit !== 'men');
  return parts.map((p) => `${mixed ? `${fitLabel(p.fit)} ` : ''}${p.size}${times}${p.quantity}`).join(joiner);
}

// ----------------------------------------------------------------- size guide table

export type GuideColumn = 'chest' | 'length' | 'shoulder' | 'sleeve' | 'waist' | 'hip' | 'body_chest' | 'height';

/** Columns for a garment: tops show the sleeve for the chosen sleeves (none when sleeveless). */
export function guideColumns(garment: Garment, fit: Fit, sleeves: Sleeves = 'short'): GuideColumn[] {
  const own: GuideColumn[] = garment === 'shorts'
    ? ['waist', 'hip', 'length']
    : ['chest', 'length', 'shoulder', ...(sleeves === 'none' ? [] : ['sleeve' as const])];
  return [...own, 'body_chest', ...(fit === 'kids' ? ['height' as const] : [])];
}

const range = (r: [number, number] | null | undefined) => (r ? `${r[0]}–${r[1]}` : '—');

/** One cell of the table, as text (numbers in the guide's unit). */
export function guideCell(row: SizeGuideRow, col: GuideColumn, garment: Garment, sleeves: Sleeves = 'short'): string {
  const top = row.top;
  switch (col) {
    case 'chest': return String(top.chest);
    case 'length': return String(garment === 'shorts' ? row.shorts.length : top.length);
    case 'shoulder': return String(top.shoulder);
    case 'sleeve': return String(sleeves === 'long' ? top.sleeve_long : top.sleeve_short);
    case 'waist': return String(row.shorts.waist);
    case 'hip': return String(row.shorts.hip);
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

/** The table for one fit and garment, or null when the guide has no such fit. */
export function guideTable(guide: SizeGuide, fit: Fit, garment: Garment, sleeves: Sleeves = 'short'): GuideTable | null {
  const f = guide.fits.find((x) => x.id === fit);
  if (!f) return null;
  const columns = guideColumns(garment, fit, sleeves);
  return {
    fit, name: f.name, columns,
    rows: f.sizes.map((r) => ({ size: r.size, cells: columns.map((c) => guideCell(r, c, garment, sleeves)) })),
  };
}

/** The how-to-measure notes that go with the columns shown. */
export function guideHowTo(guide: SizeGuide, columns: GuideColumn[]): SizeGuide['how_to_measure'] {
  return guide.how_to_measure.filter((m) => (columns as string[]).includes(m.id));
}
