/**
 * Settings sections <-> editable form state. Pure and unit tested.
 *
 * Forms keep numbers as strings (so half-typed values are not lost), rates as percentages
 * ("5" for 0.05), optional numbers as "" for null, and code lists as comma-separated text.
 * fromForm* returns the JSON the API expects plus client-side errors, keyed by the same
 * dotted paths the server uses in 422 responses ("fabrics.0.id"), so both show in one place.
 */
import type { FieldError } from './errors';
import type { Garment, Size } from './types';
import { GARMENTS, SIZES } from './types';

// ------------------------------------------------------------------ JSON shapes (defaults.py)

export interface PriceBook {
  currency: string;
  garments: Record<Garment, { name: string; base: number }>;
  fabrics: { id: string; name: string; surcharge: number; garments: Garment[] }[];
  size_surcharge: Record<Size, number>;
  personalisation: { name: number; number: number };
  logo_per_piece: number;
  quantity_tiers: { min: number; discount: number }[];
  minimum_pieces: number;
  rush: { enabled: boolean; fee_rate: number; label: string };
  tax: { name: string; rate: number; rate_above: number; threshold_per_piece: number; inclusive: boolean };
  coupons: { code: string; kind: 'percent' | 'amount'; value: number; max_discount: number | null; min_subtotal: number; active: boolean; expires: string | null; note: string }[];
}
export interface Production {
  timezone: string; working_days: number[]; holidays: string[]; daily_cutoff_hour: number;
  stages: { id: string; name: string; capacity_per_day: number; fixed_days: number }[]; rush_priority: boolean;
}
export interface Delivery {
  origin: Record<string, string>; dispatch_days: number[];
  pickup: { enabled: boolean; label: string; fee: number };
  zones: { id: string; name: string; states: string[]; pincode_prefixes: string[]; base: number; per_piece: number; free_above: number | null; transit_days: number }[];
  carriers: { id: string; name: string; tracking_url: string; active: boolean }[];
}
export interface Company {
  name: string; legal_name: string; tax_id: string; email: string; phone: string; address: string;
  invoice_prefix: string; quote_valid_days: number; support_hours: string;
}
export interface CrmConfig {
  lead_stages: string[]; lead_sources: string[]; organisation_kinds: string[]; ticket_categories: string[]; reorder_reminder_days: number;
}

// ------------------------------------------------------------------ primitive conversions

/** Number -> input text. null/undefined -> "". Avoids float noise (0.1 + 0.2). */
export function numText(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return String(Math.round(n * 1e6) / 1e6);
}
/** Fraction -> percent text: 0.05 -> "5", 0.125 -> "12.5". */
export function pctText(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '';
  return numText(fraction * 100);
}
/** "TN, KL  ka" -> ["TN", "KL", "KA"] (upper) or as typed (upper = false). Empty parts dropped, duplicates removed. */
export function splitList(text: string, upper = false): string[] {
  const parts = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => (upper ? s.toUpperCase() : s));
  return [...new Set(parts)];
}
export const joinList = (xs: string[] | undefined) => (xs ?? []).join(', ');

/** Collects parse errors while converting. */
export class Collector {
  errors: FieldError[] = [];
  add(path: string, message: string) { this.errors.push({ path, message }); }

  num(path: string, text: string, o: { int?: boolean; min?: number; max?: number } = {}): number {
    const t = text.trim().replace(/,/g, '');
    if (t === '') { this.add(path, 'Required.'); return 0; }
    const n = Number(t);
    if (!Number.isFinite(n)) { this.add(path, 'Enter a number.'); return 0; }
    if (o.int && !Number.isInteger(n)) { this.add(path, 'Enter a whole number.'); return n; }
    if (o.min !== undefined && n < o.min) this.add(path, `Must be at least ${o.min}.`);
    if (o.max !== undefined && n > o.max) this.add(path, `Must be at most ${o.max}.`);
    return n;
  }
  optNum(path: string, text: string, o: { int?: boolean; min?: number; max?: number } = {}): number | null {
    return text.trim() === '' ? null : this.num(path, text, o);
  }
  /** Percent text -> fraction, rounded to 6 places. */
  pct(path: string, text: string, maxPct?: number): number {
    const n = this.num(path, text, { min: 0, max: maxPct });
    return Math.round(n * 1e4) / 1e6;
  }
  date(path: string, text: string | null | undefined, optional = true): string | null {
    const t = (text ?? '').trim();
    if (!t) { if (!optional) this.add(path, 'Required.'); return null; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) this.add(path, 'Use a date (YYYY-MM-DD).');
    return t;
  }
  required(path: string, text: string): string {
    if (!text.trim()) this.add(path, 'Required.');
    return text.trim();
  }
}

export interface Converted<T> { value: T; errors: FieldError[] }

// ------------------------------------------------------------------ price book

export interface PriceBookForm {
  currency: string;
  garments: Record<Garment, { name: string; base: string }>;
  fabrics: { id: string; name: string; surcharge: string; garments: Garment[] }[];
  size_surcharge: Record<Size, string>;
  personalisation: { name: string; number: string };
  logo_per_piece: string;
  quantity_tiers: { min: string; discount: string }[];
  minimum_pieces: string;
  rush: { enabled: boolean; fee_rate: string; label: string };
  tax: { name: string; rate: string; rate_above: string; threshold_per_piece: string; inclusive: boolean };
  coupons: { code: string; kind: 'percent' | 'amount'; value: string; max_discount: string; min_subtotal: string; active: boolean; expires: string; note: string }[];
}

export function priceBookToForm(pb: PriceBook): PriceBookForm {
  const garments = {} as PriceBookForm['garments'];
  for (const g of GARMENTS) garments[g] = { name: pb.garments[g]?.name ?? g, base: numText(pb.garments[g]?.base) };
  const sizes = {} as PriceBookForm['size_surcharge'];
  for (const s of SIZES) sizes[s] = numText(pb.size_surcharge[s] ?? 0);
  return {
    currency: pb.currency,
    garments,
    fabrics: pb.fabrics.map((f) => ({ id: f.id, name: f.name, surcharge: numText(f.surcharge), garments: [...f.garments] })),
    size_surcharge: sizes,
    personalisation: { name: numText(pb.personalisation.name), number: numText(pb.personalisation.number) },
    logo_per_piece: numText(pb.logo_per_piece),
    quantity_tiers: pb.quantity_tiers.map((t) => ({ min: numText(t.min), discount: pctText(t.discount) })),
    minimum_pieces: numText(pb.minimum_pieces),
    rush: { enabled: pb.rush.enabled, fee_rate: pctText(pb.rush.fee_rate), label: pb.rush.label },
    tax: { name: pb.tax.name, rate: pctText(pb.tax.rate), rate_above: pctText(pb.tax.rate_above),
      threshold_per_piece: numText(pb.tax.threshold_per_piece), inclusive: pb.tax.inclusive },
    coupons: pb.coupons.map((c) => ({ code: c.code, kind: c.kind, value: numText(c.value), max_discount: numText(c.max_discount),
      min_subtotal: numText(c.min_subtotal), active: c.active, expires: c.expires ?? '', note: c.note ?? '' })),
  };
}

export function formToPriceBook(f: PriceBookForm, base: Partial<PriceBook> = {}): Converted<PriceBook> {
  const c = new Collector();
  const garments = {} as PriceBook['garments'];
  for (const g of GARMENTS) {
    garments[g] = { name: c.required(`garments.${g}.name`, f.garments[g].name), base: c.num(`garments.${g}.base`, f.garments[g].base, { min: 0 }) };
  }
  const size_surcharge = {} as PriceBook['size_surcharge'];
  for (const s of SIZES) size_surcharge[s] = c.num(`size_surcharge.${s}`, f.size_surcharge[s], { min: 0 });
  f.fabrics.forEach((x, i) => { if (!x.garments.length) c.add(`fabrics.${i}.garments`, 'Choose at least one garment.'); });
  if (!f.fabrics.length) c.add('fabrics', 'Keep at least one fabric.');
  const tiers = f.quantity_tiers.map((t, i) => ({ min: c.num(`quantity_tiers.${i}.min`, t.min, { int: true, min: 1 }), discount: c.pct(`quantity_tiers.${i}.discount`, t.discount, 90) }));
  if (tiers.length && tiers[0].min !== 1) c.add('quantity_tiers.0.min', 'The first tier must start at 1 piece.');
  tiers.forEach((t, i) => { if (i && t.min <= tiers[i - 1].min) c.add(`quantity_tiers.${i}.min`, 'Tiers must go up.'); });
  const value: PriceBook = {
    ...(base as PriceBook),
    currency: f.currency.trim().toUpperCase(),
    garments,
    fabrics: f.fabrics.map((x, i) => ({ id: c.required(`fabrics.${i}.id`, x.id), name: c.required(`fabrics.${i}.name`, x.name),
      surcharge: c.num(`fabrics.${i}.surcharge`, x.surcharge, { min: 0 }), garments: GARMENTS.filter((g) => x.garments.includes(g)) })),
    size_surcharge,
    personalisation: { name: c.num('personalisation.name', f.personalisation.name, { min: 0 }), number: c.num('personalisation.number', f.personalisation.number, { min: 0 }) },
    logo_per_piece: c.num('logo_per_piece', f.logo_per_piece, { min: 0 }),
    quantity_tiers: tiers,
    minimum_pieces: c.num('minimum_pieces', f.minimum_pieces, { int: true, min: 1 }),
    rush: { enabled: f.rush.enabled, fee_rate: c.pct('rush.fee_rate', f.rush.fee_rate, 300), label: f.rush.label.trim() },
    tax: { name: f.tax.name.trim(), rate: c.pct('tax.rate', f.tax.rate, 50), rate_above: c.pct('tax.rate_above', f.tax.rate_above, 50),
      threshold_per_piece: c.num('tax.threshold_per_piece', f.tax.threshold_per_piece, { min: 0 }), inclusive: f.tax.inclusive },
    coupons: f.coupons.map((x, i) => ({ code: x.code.trim().toUpperCase(), kind: x.kind,
      value: c.num(`coupons.${i}.value`, x.value, { min: 0 }), max_discount: c.optNum(`coupons.${i}.max_discount`, x.max_discount, { min: 0 }),
      min_subtotal: x.min_subtotal.trim() === '' ? 0 : c.num(`coupons.${i}.min_subtotal`, x.min_subtotal, { min: 0 }),
      active: x.active, expires: c.date(`coupons.${i}.expires`, x.expires), note: x.note.trim() })),
  };
  const codes = value.coupons.map((x) => x.code);
  codes.forEach((code, i) => { if (codes.indexOf(code) !== i) c.add(`coupons.${i}.code`, 'This code is used twice.'); });
  value.coupons.forEach((x, i) => { if (x.kind === 'percent' && x.value > 90) c.add(`coupons.${i}.value`, 'A percent coupon can be at most 90.'); });
  return { value, errors: c.errors };
}

// ------------------------------------------------------------------ production

export interface ProductionForm {
  timezone: string; working_days: number[]; holidays: string[]; daily_cutoff_hour: string;
  stages: { id: string; name: string; capacity_per_day: string; fixed_days: string }[]; rush_priority: boolean;
}
export function productionToForm(p: Production): ProductionForm {
  return { timezone: p.timezone, working_days: [...p.working_days].sort(), holidays: [...p.holidays].sort(),
    daily_cutoff_hour: numText(p.daily_cutoff_hour), rush_priority: p.rush_priority,
    stages: p.stages.map((s) => ({ id: s.id, name: s.name, capacity_per_day: numText(s.capacity_per_day), fixed_days: numText(s.fixed_days) })) };
}
export function formToProduction(f: ProductionForm, base: Partial<Production> = {}): Converted<Production> {
  const c = new Collector();
  if (!f.working_days.length) c.add('working_days', 'Choose at least one working day.');
  if (!f.stages.length) c.add('stages', 'Keep at least one stage.');
  const holidays = [...new Set(f.holidays.map((h) => h.trim()).filter(Boolean))].sort();
  holidays.forEach((h, i) => c.date(`holidays.${i}`, h, false));
  return { errors: c.errors, value: {
    ...(base as Production),
    timezone: f.timezone.trim() || 'Asia/Kolkata',
    working_days: [...new Set(f.working_days)].sort((a, b) => a - b),
    holidays,
    daily_cutoff_hour: c.num('daily_cutoff_hour', f.daily_cutoff_hour, { int: true, min: 0, max: 23 }),
    stages: f.stages.map((s, i) => ({ id: c.required(`stages.${i}.id`, s.id), name: c.required(`stages.${i}.name`, s.name),
      capacity_per_day: c.num(`stages.${i}.capacity_per_day`, s.capacity_per_day, { int: true, min: 1 }),
      fixed_days: s.fixed_days.trim() === '' ? 0 : c.num(`stages.${i}.fixed_days`, s.fixed_days, { int: true, min: 0, max: 30 }) })),
    rush_priority: f.rush_priority,
  } };
}

// ------------------------------------------------------------------ delivery

export interface DeliveryForm {
  origin: Record<string, string>; dispatch_days: number[];
  pickup: { enabled: boolean; label: string; fee: string };
  zones: { id: string; name: string; states: string; pincode_prefixes: string; base: string; per_piece: string; free_above: string; transit_days: string }[];
  carriers: { id: string; name: string; tracking_url: string; active: boolean }[];
}
export function deliveryToForm(d: Delivery): DeliveryForm {
  return { origin: { city: '', state: '', pincode: '', ...d.origin }, dispatch_days: [...d.dispatch_days].sort(),
    pickup: { enabled: d.pickup.enabled, label: d.pickup.label, fee: numText(d.pickup.fee) },
    zones: d.zones.map((z) => ({ id: z.id, name: z.name, states: joinList(z.states), pincode_prefixes: joinList(z.pincode_prefixes),
      base: numText(z.base), per_piece: numText(z.per_piece), free_above: numText(z.free_above), transit_days: numText(z.transit_days) })),
    carriers: d.carriers.map((x) => ({ ...x })) };
}
export function isCatchAll(z: { states: string | string[]; pincode_prefixes: string | string[] }): boolean {
  const s = typeof z.states === 'string' ? splitList(z.states) : z.states;
  const p = typeof z.pincode_prefixes === 'string' ? splitList(z.pincode_prefixes) : z.pincode_prefixes;
  return !s.length && !p.length;
}
export function formToDelivery(f: DeliveryForm, base: Partial<Delivery> = {}): Converted<Delivery> {
  const c = new Collector();
  if (!f.dispatch_days.length) c.add('dispatch_days', 'Choose at least one dispatch day.');
  const zones = f.zones.map((z, i) => {
    const prefixes = splitList(z.pincode_prefixes);
    prefixes.forEach((p) => { if (!/^\d{1,6}$/.test(p)) c.add(`zones.${i}.pincode_prefixes`, `"${p}" is not a pincode prefix (digits only).`); });
    return { id: c.required(`zones.${i}.id`, z.id), name: c.required(`zones.${i}.name`, z.name), states: splitList(z.states, true),
      pincode_prefixes: prefixes, base: c.num(`zones.${i}.base`, z.base, { min: 0 }),
      per_piece: z.per_piece.trim() === '' ? 0 : c.num(`zones.${i}.per_piece`, z.per_piece, { min: 0 }),
      free_above: c.optNum(`zones.${i}.free_above`, z.free_above, { min: 0 }),
      transit_days: c.num(`zones.${i}.transit_days`, z.transit_days, { int: true, min: 0, max: 60 }) };
  });
  if (!zones.some((z) => isCatchAll(z))) c.add('zones', 'Keep one zone with no states and no pincode prefixes: it covers everywhere else.');
  f.carriers.forEach((x, i) => {
    if (x.tracking_url.trim() && !x.tracking_url.includes('{tracking}')) c.add(`carriers.${i}.tracking_url`, 'Put {tracking} where the tracking number goes.');
  });
  if (!f.carriers.length) c.add('carriers', 'Keep at least one carrier.');
  const origin: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.origin)) origin[k] = v.trim();
  return { errors: c.errors, value: {
    ...(base as Delivery), origin, dispatch_days: [...new Set(f.dispatch_days)].sort((a, b) => a - b),
    pickup: { enabled: f.pickup.enabled, label: f.pickup.label.trim(), fee: f.pickup.fee.trim() === '' ? 0 : c.num('pickup.fee', f.pickup.fee, { min: 0 }) },
    zones,
    carriers: f.carriers.map((x, i) => ({ id: c.required(`carriers.${i}.id`, x.id), name: c.required(`carriers.${i}.name`, x.name),
      tracking_url: x.tracking_url.trim(), active: x.active })),
  } };
}

// ------------------------------------------------------------------ company and CRM

export type CompanyForm = Omit<Company, 'quote_valid_days'> & { quote_valid_days: string };
export function companyToForm(co: Company): CompanyForm {
  return { ...co, quote_valid_days: numText(co.quote_valid_days) };
}
export function formToCompany(f: CompanyForm, base: Partial<Company> = {}): Converted<Company> {
  const c = new Collector();
  const out: Company = { ...(base as Company), name: c.required('name', f.name), legal_name: f.legal_name.trim(), tax_id: f.tax_id.trim(),
    email: f.email.trim(), phone: f.phone.trim(), address: f.address.trim(), invoice_prefix: f.invoice_prefix.trim().toUpperCase(),
    quote_valid_days: c.num('quote_valid_days', f.quote_valid_days, { int: true, min: 1, max: 365 }), support_hours: f.support_hours.trim() };
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) c.add('email', 'Enter a valid email address.');
  return { value: out, errors: c.errors };
}

export type CrmForm = Omit<CrmConfig, 'reorder_reminder_days'> & { reorder_reminder_days: string };
export function crmToForm(x: CrmConfig): CrmForm {
  return { lead_stages: [...x.lead_stages], lead_sources: [...x.lead_sources], organisation_kinds: [...x.organisation_kinds],
    ticket_categories: [...x.ticket_categories], reorder_reminder_days: numText(x.reorder_reminder_days) };
}
/** CRM codes are lower_snake: "Design shared" -> "design_shared". */
export function toCode(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
export function formToCrm(f: CrmForm, base: Partial<CrmConfig> = {}): Converted<CrmConfig> {
  const c = new Collector();
  const list = (xs: string[]) => [...new Set(xs.map(toCode).filter(Boolean))];
  const out: CrmConfig = { ...(base as CrmConfig), lead_stages: list(f.lead_stages), lead_sources: list(f.lead_sources),
    organisation_kinds: list(f.organisation_kinds), ticket_categories: list(f.ticket_categories),
    reorder_reminder_days: c.num('reorder_reminder_days', f.reorder_reminder_days, { int: true, min: 0, max: 2000 }) };
  if (out.lead_stages.length < 3) c.add('lead_stages', 'Keep at least three stages.');
  if (!out.lead_stages.includes('won') || !out.lead_stages.includes('lost')) c.add('lead_stages', 'Lead stages must include "won" and "lost".');
  for (const k of ['lead_sources', 'organisation_kinds', 'ticket_categories'] as const) if (!out[k].length) c.add(k, 'Keep at least one.');
  return { value: out, errors: c.errors };
}

// ------------------------------------------------------------------ registry

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const SECTION_TITLES = {
  price_book: 'Price book', production: 'Production', delivery: 'Delivery', company: 'Company', crm: 'CRM lists',
} as const;

/** Stable JSON for "has anything changed?" comparisons (key order independent). */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}

/** Immutable update helper: set(form, ['fabrics', 0, 'name'], 'x'). */
export function setIn<T>(obj: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[k as number] = setIn(copy[k as number], rest, value);
    return copy as T;
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  return { ...o, [k]: setIn(o[k as string], rest, value) } as T;
}
