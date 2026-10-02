import type { Catalogue, Collar, Colourway, DesignSpec, Garment, Language, OptionPrice, Sleeves } from './api/types';
import { COLLARS, SLEEVES } from './api/types';
import { refitLayers } from './geometry';
import { formatMoney } from './price';

// Garment options: sleeves (short, long, sleeveless) and collar (crew, polo, mandarin),
// their price differences from the catalogue, and product colourways.

/** Sleeves can be chosen for jerseys and V-necks, never shorts. */
export const hasSleeves = (garment: Garment): boolean => garment !== 'shorts';
/** Only the round-neck jersey takes another collar (a V-neck keeps its V). */
export const hasCollarChoice = (garment: Garment): boolean => garment === 'jersey';

export function sleevesOf(spec: Pick<DesignSpec, 'sleeves'> | null | undefined): Sleeves {
  const v = spec?.sleeves;
  return v && (SLEEVES as readonly string[]).includes(v) ? v : 'short';
}

export function collarOf(spec: Pick<DesignSpec, 'collar'> | null | undefined): Collar {
  const v = spec?.collar;
  return v && (COLLARS as readonly string[]).includes(v) ? v : 'crew';
}

export type OptionGroup = 'sleeves' | 'collar' | 'fit';

/**
 * The choices of a group that the price book offers, in the server's order, with prices.
 * Without a catalogue (still loading, older server) every known choice is offered at no cost.
 */
export function optionChoices(catalogue: Pick<Catalogue, 'options'> | null | undefined, group: 'sleeves' | 'collar'): OptionPrice[] {
  const own = catalogue?.options?.[group];
  if (own?.length) return own;
  return (group === 'sleeves' ? SLEEVES : COLLARS).map((id) => ({ id, name: id, price: 0 }));
}

export function optionPrice(catalogue: Pick<Catalogue, 'options'> | null | undefined, group: OptionGroup, id: string): number {
  return catalogue?.options?.[group]?.find((o) => o.id === id)?.price ?? 0;
}

/** "+₹60", "−₹20", or "" when the choice costs the same. */
export function formatDelta(amount: number, currency = 'INR', lang: Language = 'en'): string {
  if (!amount || !Number.isFinite(amount) || Math.abs(amount) < 0.005) return '';
  return `${amount > 0 ? '+' : '−'}${formatMoney(Math.abs(amount), currency, lang)}`;
}

/** Options for a spec as the store sends them: sleeves only where they apply, collar only for jerseys. */
export function specOptions(spec: DesignSpec): { sleeves?: Sleeves; collar?: Collar } {
  return {
    ...(hasSleeves(spec.garment) ? { sleeves: sleevesOf(spec) } : {}),
    ...(hasCollarChoice(spec.garment) ? { collar: collarOf(spec) } : {}),
  };
}

/** Apply a choice to a spec, ignoring choices the garment can't take. */
/**
 * Sets sleeves or collar. Sleeveless and polo narrow the print area, so layers that
 * no longer fit are shrunk or moved back inside it (the server blocks ordering otherwise).
 */
export function withOption(spec: DesignSpec, group: 'sleeves' | 'collar', value: string): DesignSpec {
  if (group === 'sleeves' && hasSleeves(spec.garment) && (SLEEVES as readonly string[]).includes(value)) {
    return refitLayers({ ...spec, sleeves: value as Sleeves }, spec);
  }
  if (group === 'collar' && hasCollarChoice(spec.garment) && (COLLARS as readonly string[]).includes(value)) {
    return refitLayers({ ...spec, collar: value as Collar }, spec);
  }
  return spec;
}

// ----------------------------------------------------------------- colourways

/** Two colours for a small swatch: the list's swatch, else the detail palette's primary and secondary. */
export function swatchColours(c: Colourway): [string, string] | null {
  if (c.swatch && c.swatch.length >= 2) return [c.swatch[0], c.swatch[1]];
  const p = c.palette;
  if (p?.primary) return [p.primary, p.secondary ?? p.primary];
  return null;
}

export function colourwayName(colourways: Colourway[] | undefined, id: string | undefined | null): string {
  if (!id) return '';
  return colourways?.find((c) => c.id === id)?.name ?? id;
}

/** A product picture with choices: /api/unsattai/shop/products/<slug>/mockup.svg?colourway=&sleeves=&collar= */
export function productImageUrl(slug: string, choice: { colourway?: string; sleeves?: string; collar?: string } = {}): string {
  const q = new URLSearchParams();
  if (choice.colourway && choice.colourway !== 'original') q.set('colourway', choice.colourway);
  if (choice.sleeves) q.set('sleeves', choice.sleeves);
  if (choice.collar) q.set('collar', choice.collar);
  const s = q.toString();
  return `/api/unsattai/shop/products/${encodeURIComponent(slug)}/mockup.svg${s ? `?${s}` : ''}`;
}
