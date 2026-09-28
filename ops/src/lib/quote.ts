/** Quote-building helpers. Pure: unit tested. */
import type { Pricing, QuoteLine, Size, Spec } from './types';
import { SIZES } from './types';

export interface EditLine { size: Size; quantity: string; player_name: string; number: string }

export const blankLine = (size: Size = 'M'): EditLine => ({ size, quantity: '1', player_name: '', number: '' });

/**
 * "Arul, 7, M, 2" / "Arul 7 M" / "M x 10" -> lines. Name and number are optional; size is required;
 * quantity defaults to 1. Returns the lines and the (1-based) line numbers it could not read.
 */
export function parseRoster(text: string): { lines: EditLine[]; bad: number[] } {
  const lines: EditLine[] = [];
  const bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const row = raw.trim();
    if (!row) return;
    const parts = row.split(/[,\t;]+|\s+x\s+|\s+/i).map((s) => s.trim()).filter(Boolean);
    const sizeIdx = parts.findIndex((p) => (SIZES as readonly string[]).includes(p.toUpperCase()));
    if (sizeIdx < 0) { bad.push(i + 1); return; }
    const size = parts[sizeIdx].toUpperCase() as Size;
    const before = parts.slice(0, sizeIdx);
    const after = parts.slice(sizeIdx + 1);
    let number = '';
    const numIdx = before.findIndex((p) => /^\d{1,3}$/.test(p));
    if (numIdx >= 0) number = before.splice(numIdx, 1)[0];
    const qty = after.find((p) => /^\d{1,4}$/.test(p));
    lines.push({ size, number, player_name: before.join(' ').slice(0, 16), quantity: qty ?? '1' });
  });
  return { lines, bad };
}

/** Editable lines -> API lines; errors keyed "lines.<i>.<field>". */
export function toQuoteLines(lines: EditLine[]): { lines: QuoteLine[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out = lines.map((l, i) => {
    const q = Number(l.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 5000) errors[`lines.${i}.quantity`] = '1 to 5000';
    if (l.number && !/^\d{1,3}$/.test(l.number)) errors[`lines.${i}.number`] = 'Up to 3 digits';
    if (l.player_name.length > 16) errors[`lines.${i}.player_name`] = 'Up to 16 characters';
    return { size: l.size, quantity: Number.isFinite(q) ? q : 0, player_name: l.player_name.trim(), number: l.number.trim() };
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
