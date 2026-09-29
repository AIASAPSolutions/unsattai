/** Quote-building helpers. Pure: unit tested. */
import type { Collar, Fit, Garment, Pricing, QuoteLine, Size, Sleeves, Spec } from './types';
import { FIT_DEFAULT_SIZE, FIT_LABEL, FIT_SIZES, SIZES } from './types';

export interface EditLine { fit: Fit; size: Size; quantity: string; player_name: string; number: string }

export const blankLine = (size: Size = 'M', fit: Fit = 'men'): EditLine => ({ fit, size, quantity: '1', player_name: '', number: '' });

/** Change a line's fit, keeping the size when the new fit has it (else the fit's usual size). */
export function withFit(l: EditLine, fit: Fit, sizes: Record<Fit, readonly Size[]> = FIT_SIZES): EditLine {
  return { ...l, fit, size: sizes[fit].includes(l.size) ? l.size : (sizes[fit].includes(FIT_DEFAULT_SIZE[fit]) ? FIT_DEFAULT_SIZE[fit] : sizes[fit][0]) };
}

const FIT_WORDS: Record<string, Fit> = { women: 'women', womens: 'women', ladies: 'women', kids: 'kids', kid: 'kids', youth: 'kids', men: 'men', mens: 'men', unisex: 'men' };

/** Sleeves and collar of a design; they only apply to some garments (sleeves: not shorts; collar: crew-neck jersey). */
export function specOptions(spec: Spec | null | undefined): { sleeves: Sleeves; collar: Collar } {
  const g: Garment = spec?.garment ?? 'jersey';
  return {
    sleeves: g === 'shorts' ? 'short' : ((spec?.sleeves as Sleeves | undefined) ?? 'short'),
    collar: g === 'jersey' ? ((spec?.collar as Collar | undefined) ?? 'crew') : 'crew',
  };
}

/**
 * "Arul, 7, M, 2" / "Arul 7 M" / "M x 10" / "Kavin, 5, 8Y" / "Divya, women, S" -> lines. Name and number are optional;
 * size is required; quantity defaults to 1. A kids size (4Y..14Y) makes a kids line; the words women / ladies / kids
 * set the fit. Returns the lines and the (1-based) line numbers it could not read.
 */
export function parseRoster(text: string): { lines: EditLine[]; bad: number[] } {
  const lines: EditLine[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const row = raw.trim();
    if (!row) return;
    const all = row.split(/[,\t;]+|\s+x\s+|\s+/i).map((s) => s.trim()).filter(Boolean);
    let fit: Fit | null = null;
    const parts = all.filter((p) => {
      const f = FIT_WORDS[p.toLowerCase()];
      if (f) { fit = f; return false; }
      return true;
    });
    const sizeIdx = parts.findIndex((p) => (SIZES as readonly string[]).includes(p.toUpperCase()));
    if (sizeIdx < 0) { bad.push(i + 1); return; }
    const size = parts[sizeIdx].toUpperCase() as Size;
    const before = parts.slice(0, sizeIdx);
    const after = parts.slice(sizeIdx + 1);
    let number = '';
    const numIdx = before.findIndex((p) => /^\d{1,3}$/.test(p));
    if (numIdx >= 0) number = before.splice(numIdx, 1)[0];
    const qty = after.find((p) => /^\d{1,4}$/.test(p));
    const lineFit: Fit = FIT_SIZES.kids.includes(size) ? 'kids' : ((fit as Fit | null) ?? 'men');
    if (!FIT_SIZES[lineFit].includes(size)) { bad.push(i + 1); return; }
    lines.push({ fit: lineFit, size, number, player_name: before.join(' ').slice(0, 16), quantity: qty ?? '1' });
  });
  return { lines, bad };
}

/** Editable lines -> API lines; errors keyed "lines.<i>.<field>". */
export function toQuoteLines(lines: EditLine[], sizes: Record<Fit, readonly Size[]> = FIT_SIZES): { lines: QuoteLine[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out = lines.map((l, i) => {
    const fit = l.fit ?? 'men';
    if (!sizes[fit].includes(l.size)) errors[`lines.${i}.size`] = `${l.size} is not a ${FIT_LABEL[fit]} size`;
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 5000) errors[`lines.${i}.quantity`] = '1 to 5000';
    if (l.number && !/^\d{1,3}$/.test(l.number)) errors[`lines.${i}.number`] = 'Up to 3 digits';
    if (l.player_name.length > 16) errors[`lines.${i}.player_name`] = 'Up to 16 characters';
    return { fit, size: l.size, quantity: Number.isFinite(q) ? q : 0, player_name: l.player_name.trim(), number: l.number.trim() };
  });
  if (!lines.length) errors.lines = 'Add at least one line.';
  return { lines: out, errors };
}

export function logoCount(spec: Spec | null | undefined): number {
  return Math.min(4, (spec?.elements ?? []).filter((e) => e.type === 'logo').length);
}

/** Same as crm._quote_pricing: the sales discount comes off the final total, never below zero. */
export function withSalesDiscount(p: Pricing, extra: number): Pricing {
  if (!extra || extra <= 0) return p;
  const d = Math.min(extra, p.total);
  return { ...p, sales_discount: Math.round(d * 100) / 100, total: Math.round((p.total - d) * 100) / 100 };
}

export function totalPieces(lines: EditLine[]): number {
  return lines.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
}
