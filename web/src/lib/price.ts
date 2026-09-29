import type { Fit, Language, Quote, QuoteRequest, Size } from './api/types';

// Display helpers for prices and dates. Amounts come from the server's quote; the
// store never computes a price itself, it only formats and explains the breakdown.

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN' };

export function locale(lang: Language): string {
  return LOCALE[lang] ?? 'en-IN';
}

export function formatMoney(amount: number | null | undefined, currency = 'INR', lang: Language = 'en'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  try {
    return new Intl.NumberFormat(locale(lang), {
      style: 'currency', currency, numberingSystem: 'latn',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(whole ? 0 : 2)}`;
  }
}

export function formatPercent(rate: number, lang: Language = 'en'): string {
  return new Intl.NumberFormat(locale(lang), { style: 'percent', maximumFractionDigits: 1, numberingSystem: 'latn' }).format(rate);
}

/** "Thu, 8 Oct" style date for a YYYY-MM-DD (read as a calendar date, not a UTC instant). */
export function formatDate(iso: string | null | undefined, lang: Language = 'en', withYear = false): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), numberingSystem: 'latn',
  }).format(d);
}

export function formatDateTime(iso: string | null | undefined, lang: Language = 'en'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(d);
}

/** The cheapest "from" price for a garment: base price with the cheapest fabric, before discounts and tax. */
export function fromPrice(base: number, fabrics: { surcharge: number; garments: string[] }[], garment: string): number {
  const cheapest = fabrics.filter((f) => f.garments.includes(garment)).reduce((m, f) => Math.min(m, f.surcharge), Infinity);
  return base + (Number.isFinite(cheapest) ? cheapest : 0);
}

export interface Nudge {
  piecesNeeded: number;
  rate: number;
  min: number;
}

/** "Add N more pieces to save X%": the next quantity tier, when there is one. */
export function tierNudge(q: Pick<Quote, 'quantity_discount'>): Nudge | null {
  const next = q.quantity_discount.next;
  if (!next || next.pieces_needed <= 0) return null;
  return { piecesNeeded: next.pieces_needed, rate: next.rate, min: next.min };
}

/** How much more (goods value) unlocks free delivery; null when already free or not applicable. */
export function freeDeliveryGap(q: Pick<Quote, 'shipping' | 'subtotal' | 'quantity_discount' | 'rush' | 'coupon'>): number | null {
  const s = q.shipping;
  if (s.method !== 'ship' || s.free || s.free_above === null || s.free_above === undefined) return null;
  const goods = q.subtotal - q.quantity_discount.amount + q.rush.amount - (q.coupon?.amount ?? 0);
  const gap = s.free_above - goods;
  return gap > 0 ? Math.round(gap * 100) / 100 : null;
}

export interface BreakdownRow {
  key: 'subtotal' | 'quantity_discount' | 'rush' | 'coupon' | 'sales_discount' | 'shipping' | 'tax' | 'total';
  amount: number;
  /** Shown as a deduction (−). */
  negative?: boolean;
  free?: boolean;
}

/** Rows of the price summary in the order the server applies them. */
export function breakdownRows(q: Quote): BreakdownRow[] {
  const rows: BreakdownRow[] = [{ key: 'subtotal', amount: q.subtotal }];
  if (q.quantity_discount.amount > 0) rows.push({ key: 'quantity_discount', amount: q.quantity_discount.amount, negative: true });
  if (q.rush.selected && q.rush.amount > 0) rows.push({ key: 'rush', amount: q.rush.amount });
  if (q.coupon && q.coupon.amount > 0) rows.push({ key: 'coupon', amount: q.coupon.amount, negative: true });
  rows.push({ key: 'shipping', amount: q.shipping.amount, free: q.shipping.free || q.shipping.amount === 0 });
  rows.push({ key: 'tax', amount: q.tax.amount });
  if (q.sales_discount) rows.push({ key: 'sales_discount', amount: q.sales_discount, negative: true });
  rows.push({ key: 'total', amount: q.total });
  return rows;
}

/** Stable key for a quote request, so identical requests are not sent twice. */
export function quoteKey(req: QuoteRequest): string {
  return JSON.stringify([req.garment, req.fabric, req.logos, req.rush, req.coupon.trim().toUpperCase(), req.delivery,
    req.sleeves ?? '', req.collar ?? '', req.lines.map((l) => [l.fit ?? 'men', l.size, l.quantity, l.player_name, l.number])]);
}

type Row = { fit?: Fit; size: Size; quantity: number; player_name: string; number: string };

/** Quote lines can be at most 500; merge identical rows the way the server merges order lines. */
export function quoteLines(rows: Row[]) {
  const merged = new Map<string, Row & { fit: Fit }>();
  for (const r of rows) {
    if (!r.quantity || r.quantity < 1) continue;
    const fit = r.fit ?? 'men';
    const k = `${r.player_name}\u0000${r.number}\u0000${fit}\u0000${r.size}`;
    const cur = merged.get(k);
    if (cur) cur.quantity += r.quantity;
    else merged.set(k, { fit, size: r.size, quantity: r.quantity, player_name: r.player_name, number: r.number });
  }
  return [...merged.values()];
}

export type OptionPart = 'sleeves' | 'collar' | 'fit';

/** The parts of a line's unit price that come from garment options and fit (only those that are not zero). */
export function optionParts(parts: Record<string, number> | undefined): { key: OptionPart; amount: number }[] {
  return (['sleeves', 'collar', 'fit'] as const)
    .filter((k) => typeof parts?.[k] === 'number' && Math.abs(parts[k]) >= 0.005)
    .map((k) => ({ key: k, amount: parts![k] }));
}
