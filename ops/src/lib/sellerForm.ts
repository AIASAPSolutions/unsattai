/**
 * Seller record <-> editable form, the service-area editor's rules, and mapping the server's
 * 422 answers onto the right fields. Pure: unit tested.
 *
 * Same conventions as settingsForm.ts: numbers stay strings while typing, the price adjustment
 * is a percentage ("5" for 0.05), and errors use the paths the server uses ("service_areas.2.match").
 */
import type { ApiError, FieldError } from './errors';
import { Collector, numText, pctText, type Converted } from './settingsForm';
import { GARMENTS, type Garment, type Seller, type SellerIn, type ServiceArea } from './types';

/** State codes used by the server's PIN code table (server/app/platform/pincodes.py). */
export const STATES: Record<string, string> = {
  AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CH: 'Chandigarh',
  CG: 'Chhattisgarh', DH: 'Dadra and Nagar Haveli and Daman and Diu', DL: 'Delhi', GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana',
  HP: 'Himachal Pradesh', JK: 'Jammu and Kashmir', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep',
  MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha',
  PY: 'Puducherry', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TS: 'Telangana', TR: 'Tripura',
  UP: 'Uttar Pradesh', UK: 'Uttarakhand', WB: 'West Bengal',
};

// ------------------------------------------------------------------ service areas

export type MatchKind = 'prefix' | 'state' | 'all' | 'invalid';

export function normaliseMatch(m: string): string {
  return m.trim().toUpperCase();
}

/** "641" -> prefix, "TN" -> state, "*" -> all. Same rule as the server's ServiceArea validator. */
export function matchKind(m: string, states: Record<string, string> = STATES): MatchKind {
  const v = normaliseMatch(m);
  if (v === '*') return 'all';
  if (/^[1-9]\d{0,5}$/.test(v)) return 'prefix';
  if (v in states) return 'state';
  return 'invalid';
}

/** Human description of one match, for the editor and the coverage summary. */
export function describeMatch(m: string): string {
  const v = normaliseMatch(m);
  switch (matchKind(v)) {
    case 'all': return 'Everywhere else';
    case 'state': return STATES[v];
    case 'prefix': return v.length === 6 ? `PIN code ${v}` : `PIN codes ${v}…`;
    default: return 'Not a PIN prefix, state code or *';
  }
}

/** Specificity used by the server: longest prefix first, then states, then "*". */
export function specificity(m: string): number {
  const v = normaliseMatch(m);
  const k = matchKind(v);
  return k === 'prefix' ? 100 + v.length : k === 'state' ? 50 : k === 'all' ? 0 : -1;
}

export function sortAreas<T extends { match: string }>(areas: T[]): T[] {
  return [...areas].sort((a, b) => specificity(b.match) - specificity(a.match) || normaliseMatch(a.match).localeCompare(normaliseMatch(b.match)));
}

/**
 * Which area the server would use for a PIN code (and its state, when known): the longest matching
 * prefix, then the state, then "*". Mirrors sellers.match_area, for highlighting a row in the editor.
 */
export function matchingArea<T extends { match: string }>(areas: T[], pincode: string, state?: string | null): T | null {
  let best: T | null = null;
  for (const a of areas) {
    const m = normaliseMatch(a.match);
    if (matchKind(m) === 'prefix' && pincode.startsWith(m) && (!best || m.length > normaliseMatch(best.match).length)) best = a;
  }
  if (best) return best;
  if (state) {
    const s = areas.find((a) => normaliseMatch(a.match) === state.toUpperCase());
    if (s) return s;
  }
  return areas.find((a) => normaliseMatch(a.match) === '*') ?? null;
}

export interface AreaRow { match: string; transit_days: string; cod: boolean }

/** A new row for the editor. Returns null when that match is already there. */
export function newArea(rows: AreaRow[], match: string, transitDays = '3', cod = true): AreaRow[] | null {
  const m = normaliseMatch(match);
  if (rows.some((r) => normaliseMatch(r.match) === m && m !== '')) return null;
  return [...rows, { match: m, transit_days: transitDays, cod }];
}

/** Errors for the rows, at the server's paths. */
export function checkAreas(rows: AreaRow[], c: Collector): ServiceArea[] {
  if (!rows.length) c.add('service_areas', 'Add at least one area this seller delivers to.');
  if (rows.length > 500) c.add('service_areas', 'At most 500 areas.');
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const m = normaliseMatch(r.match);
    if (!m) c.add(`service_areas.${i}.match`, 'Enter a PIN code prefix, a state code or *.');
    else if (matchKind(m) === 'invalid') c.add(`service_areas.${i}.match`, `"${m}" is not a PIN code prefix (1 to 6 digits, not starting with 0), a state code like TN, or *.`);
    if (m && seen.has(m)) c.add(`service_areas.${i}.match`, `"${m}" is already in row ${seen.get(m)! + 1}.`);
    if (m) seen.set(m, seen.has(m) ? seen.get(m)! : i);
    return { match: m, transit_days: c.num(`service_areas.${i}.transit_days`, r.transit_days, { int: true, min: 0, max: 60 }), cod: r.cod };
  });
}

/** Short text for the sellers list: "TN 2d · 641… 1d · everywhere else 6d · COD in 2 of 3". */
export function coverageSummary(areas: ServiceArea[], blocked = 0, max = 3): string {
  if (!areas.length) return 'No coverage';
  const sorted = sortAreas(areas);
  const part = (a: ServiceArea) => {
    const k = matchKind(a.match);
    const name = k === 'all' ? 'everywhere else' : k === 'prefix' ? (a.match.length === 6 ? a.match : `${a.match}…`) : a.match;
    return `${name} ${a.transit_days}d`;
  };
  let shown: string[];
  if (sorted.length <= max) {
    shown = sorted.map(part);
  } else {
    // Too many to list: count PIN prefixes, name a few states, and always
    // show the catch-all so "everywhere" is never hidden behind "+N more".
    const prefixes = sorted.filter((a) => matchKind(a.match) === 'prefix').length;
    const states = sorted.filter((a) => matchKind(a.match) === 'state').map((a) => a.match);
    const all = sorted.find((a) => matchKind(a.match) === 'all');
    shown = [];
    if (prefixes) shown.push(`${prefixes} PIN prefix${prefixes === 1 ? '' : 'es'}`);
    if (states.length) shown.push(states.length <= 3 ? states.join(', ') : `${states.length} states`);
    if (all) shown.push(part(all));
  }
  const cod = areas.filter((a) => a.cod).length;
  const codText = cod === areas.length ? 'COD everywhere' : cod === 0 ? 'no COD' : `COD in ${cod} of ${areas.length}`;
  return [shown.join(' · '), codText, blocked ? `${blocked} blocked` : ''].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ form

export interface SellerForm {
  name: string; legal_name: string; gstin: string; email: string; phone: string;
  address: { line1: string; city: string; state: string; pincode: string };
  active: boolean;
  garments: Garment[];
  /** Empty means every fabric. */
  fabrics: string[];
  service_areas: AreaRow[];
  /** Comma, space or newline separated, so a list can be pasted. */
  blocked_pincodes: string;
  capacity_factor: string; holidays: string[]; handling_days: string; min_pieces: string; max_pieces: string;
  /** Percent: "5" is 5% above the price book. */
  price_adjust: string;
}

export function emptySeller(): SellerIn {
  return {
    name: '', legal_name: '', gstin: '', email: '', phone: '', address: { line1: '', city: '', state: '', pincode: '' }, active: true,
    garments: [...GARMENTS], fabrics: [], service_areas: [{ match: '*', transit_days: 5, cod: true }], blocked_pincodes: [],
    capacity_factor: 1, holidays: [], handling_days: 0, min_pieces: 1, max_pieces: 5000, price_adjust: 0,
  };
}

export function sellerToForm(s: SellerIn | Seller): SellerForm {
  return {
    name: s.name ?? '', legal_name: s.legal_name ?? '', gstin: s.gstin ?? '', email: s.email ?? '', phone: s.phone ?? '',
    address: { line1: s.address?.line1 ?? '', city: s.address?.city ?? '', state: s.address?.state ?? '', pincode: s.address?.pincode ?? '' },
    active: s.active ?? true,
    garments: GARMENTS.filter((g) => (s.garments ?? GARMENTS).includes(g)),
    fabrics: [...(s.fabrics ?? [])],
    service_areas: (s.service_areas ?? []).map((a) => ({ match: a.match, transit_days: numText(a.transit_days), cod: a.cod })),
    blocked_pincodes: (s.blocked_pincodes ?? []).join(', '),
    capacity_factor: numText(s.capacity_factor ?? 1),
    holidays: [...(s.holidays ?? [])].sort(),
    handling_days: numText(s.handling_days ?? 0),
    min_pieces: numText(s.min_pieces ?? 1),
    max_pieces: numText(s.max_pieces ?? 5000),
    price_adjust: pctText(s.price_adjust ?? 0),
  };
}

/** "600119, 600120\n641001" -> ["600119", "600120", "641001"]: splits on commas, spaces and new lines. */
export function splitPincodes(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}

export function formToSeller(f: SellerForm, knownFabrics?: string[]): Converted<SellerIn> {
  const c = new Collector();
  const name = f.name.trim();
  if (name.length < 2) c.add('name', name ? 'At least 2 characters.' : 'Required.');
  const gstin = f.gstin.trim().toUpperCase();
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) c.add('gstin', 'A GSTIN has 15 letters and digits, or leave it empty.');
  const email = f.email.trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) c.add('email', 'Enter a valid email address, or leave it empty.');
  const pincode = f.address.pincode.trim();
  if (pincode && !/^\d{6}$/.test(pincode)) c.add('address.pincode', 'Six digits.');
  const state = f.address.state.trim().toUpperCase();
  if (state.length > 4) c.add('address.state', 'Use the state code, for example TN.');
  if (!f.garments.length) c.add('garments', 'Choose at least one garment this seller makes.');
  if (knownFabrics) f.fabrics.forEach((x) => { if (!knownFabrics.includes(x)) c.add('fabrics', `Unknown fabric "${x}".`); });

  const service_areas = checkAreas(f.service_areas, c);
  const blocked = splitPincodes(f.blocked_pincodes);
  const badPin = blocked.filter((p) => !/^\d{6}$/.test(p));
  if (badPin.length) c.add('blocked_pincodes', `Blocked PIN codes have 6 digits: ${badPin.slice(0, 3).map((p) => `"${p}"`).join(', ')}${badPin.length > 3 ? '…' : ''}.`);

  const holidays = [...new Set(f.holidays.map((h) => h.trim()).filter(Boolean))].sort();
  holidays.forEach((h, i) => c.date(`holidays.${i}`, h, false));

  const capacity_factor = c.num('capacity_factor', f.capacity_factor, { min: 0, max: 20 });
  if (capacity_factor <= 0 && f.capacity_factor.trim() !== '' && Number.isFinite(Number(f.capacity_factor))) c.add('capacity_factor', 'Must be above 0.');
  const min_pieces = c.num('min_pieces', f.min_pieces, { int: true, min: 1, max: 100000 });
  const max_pieces = c.num('max_pieces', f.max_pieces, { int: true, min: 1, max: 100000 });
  if (Number.isFinite(min_pieces) && Number.isFinite(max_pieces) && min_pieces > max_pieces) c.add('min_pieces', 'Minimum pieces can\'t be more than the maximum.');
  const adjPct = f.price_adjust.trim() === '' ? 0 : c.num('price_adjust', f.price_adjust, { min: -50, max: 200 });

  const value: SellerIn = {
    name, legal_name: f.legal_name.trim(), gstin, email, phone: f.phone.trim(),
    address: { line1: f.address.line1.trim(), city: f.address.city.trim(), state, pincode },
    active: f.active,
    garments: GARMENTS.filter((g) => f.garments.includes(g)),
    fabrics: [...new Set(f.fabrics)],
    service_areas,
    blocked_pincodes: blocked.filter((p) => /^\d{6}$/.test(p)).sort(),
    capacity_factor,
    holidays,
    handling_days: f.handling_days.trim() === '' ? 0 : c.num('handling_days', f.handling_days, { int: true, min: 0, max: 30 }),
    min_pieces, max_pieces,
    price_adjust: Math.round(adjPct * 1e4) / 1e6,
  };
  return { value, errors: c.errors };
}

// ------------------------------------------------------------------ server errors -> fields

/** Model-level messages (loc ["body"]) and plain-string 422/409 details, by what they talk about. */
const MESSAGE_FIELDS: [RegExp, string][] = [
  [/switched off/i, 'active'],
  [/min_pieces|max_pieces/i, 'min_pieces'],
  [/service area|each match|match can appear/i, 'service_areas'],
  [/blocked pin/i, 'blocked_pincodes'],
  [/holiday/i, 'holidays'],
  [/fabric/i, 'fabrics'],
  [/garment/i, 'garments'],
  [/gstin/i, 'gstin'],
  [/capacity/i, 'capacity_factor'],
  [/price adjust|price_adjust/i, 'price_adjust'],
];

/** Friendlier wording for the pydantic messages the seller form can get. */
function reword(path: string, msg: string): string {
  if (path === 'gstin' && /pattern/i.test(msg)) return 'A GSTIN has 15 letters and digits, or leave it empty.';
  if (path === 'email' && /pattern/i.test(msg)) return 'Enter a valid email address, or leave it empty.';
  if (path === 'address.pincode' && /pattern/i.test(msg)) return 'Six digits.';
  if (path === 'capacity_factor' && /greater than 0/i.test(msg)) return 'Must be above 0.';
  if (path === 'min_pieces' && /max_pieces/i.test(msg)) return "Minimum pieces can't be more than the maximum.";
  if (path === 'service_areas' && /at least 1/i.test(msg)) return 'Add at least one area this seller delivers to.';
  if (path === 'garments' && /at least 1/i.test(msg)) return 'Choose at least one garment this seller makes.';
  return msg;
}

/**
 * The server's answer to a seller save, as field errors the form can show next to each input.
 * Field-level validation already carries a path; model-level checks and plain messages are matched
 * by what they mention. Anything unrecognised stays at "" (shown at the top of the form).
 */
export function sellerServerErrors(e: ApiError): FieldError[] {
  if (e.fields.length) {
    return e.fields.map((f) => {
      let path = f.path.replace(/^body\.?/, '');
      if (!path) path = MESSAGE_FIELDS.find(([re]) => re.test(f.message))?.[1] ?? '';
      // ["body","service_areas",0,"transit_days"] and ["body","address","pincode"] already map; list items of
      // blocked_pincodes and holidays are reported on the list as a whole.
      path = path.replace(/^(blocked_pincodes)\.\d+$/, '$1');
      return { path, message: reword(path, f.message) };
    });
  }
  if (e.status === 422 || e.status === 409) {
    const path = MESSAGE_FIELDS.find(([re]) => re.test(e.message))?.[1] ?? '';
    return [{ path, message: e.message }];
  }
  return [];
}
