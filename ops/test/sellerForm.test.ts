import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from '../src/lib/errors';
import {
  checkAreas, coverageSummary, describeMatch, emptySeller, formToSeller, matchingArea, matchKind, newArea, sellerServerErrors,
  sellerToForm, sortAreas, specificity, splitPincodes, type AreaRow,
} from '../src/lib/sellerForm';
import { Collector, stableJson } from '../src/lib/settingsForm';
import type { SellerIn } from '../src/lib/types';

const FAST: SellerIn = {
  name: 'Fast Prints', legal_name: 'Fast Prints Pvt Ltd', gstin: '33ABCDE1234F1Z5', email: 'hello@fastprints.example', phone: '+91 90000 12345',
  address: { line1: '4 Mill Road', city: 'Coimbatore', state: 'TN', pincode: '641001' }, active: true,
  garments: ['jersey', 'vneck', 'shorts'], fabrics: [],
  service_areas: [{ match: '641', transit_days: 1, cod: true }, { match: 'TN', transit_days: 2, cod: true }, { match: '*', transit_days: 6, cod: false }],
  blocked_pincodes: ['600119'], capacity_factor: 1.5, holidays: ['2026-10-20'], handling_days: 1, min_pieces: 5, max_pieces: 800, price_adjust: 0.05,
};

describe('seller form conversion', () => {
  it('round-trips a full seller exactly', () => {
    const r = formToSeller(sellerToForm(FAST));
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(FAST));
  });
  it('round-trips the empty seller used for "New seller" apart from the required name', () => {
    const r = formToSeller(sellerToForm(emptySeller()));
    expect(r.errors.map((e) => e.path)).toEqual(['name']);
    expect(r.value.service_areas).toEqual([{ match: '*', transit_days: 5, cod: true }]);
  });
  it('shows the price adjustment as a percentage and converts it back', () => {
    const f = sellerToForm(FAST);
    expect(f.price_adjust).toBe('5');
    f.price_adjust = '-12.5';
    expect(formToSeller(f).value.price_adjust).toBe(-0.125);
    f.price_adjust = '';
    expect(formToSeller(f).value.price_adjust).toBe(0);
  });
  it('normalises GSTIN, state, match codes and pasted blocked PIN codes', () => {
    const f = sellerToForm(FAST);
    f.gstin = '33abcde1234f1z5';
    f.address.state = 'tn';
    f.service_areas[1].match = ' ka ';
    f.blocked_pincodes = '600120\n600119, 600119  641002';
    const r = formToSeller(f);
    expect(r.errors).toEqual([]);
    expect(r.value.gstin).toBe('33ABCDE1234F1Z5');
    expect(r.value.address.state).toBe('TN');
    expect(r.value.service_areas[1].match).toBe('KA');
    expect(r.value.blocked_pincodes).toEqual(['600119', '600120', '641002']);
  });
  it('reports client errors at the same paths the server uses', () => {
    const f = sellerToForm(FAST);
    f.name = 'X';
    f.gstin = 'SHORT';
    f.email = 'nope';
    f.address.pincode = '12';
    f.garments = [];
    f.service_areas[0].match = '041';
    f.service_areas[2].transit_days = '61';
    f.blocked_pincodes = '600119, 12345';
    f.holidays = ['2026-13-45'];
    f.capacity_factor = '0';
    f.min_pieces = '900';
    f.price_adjust = '300';
    const paths = formToSeller(f).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining([
      'name', 'gstin', 'email', 'address.pincode', 'garments', 'service_areas.0.match', 'service_areas.2.transit_days',
      'blocked_pincodes', 'holidays.0', 'capacity_factor', 'min_pieces', 'price_adjust',
    ]));
  });
  it('flags unknown fabrics when the price book fabrics are known', () => {
    const f = sellerToForm({ ...FAST, fabrics: ['standard', 'silk'] });
    expect(formToSeller(f, ['standard', 'premium']).errors).toEqual([{ path: 'fabrics', message: 'Unknown fabric "silk".' }]);
    expect(formToSeller(f).errors).toEqual([]);
  });
  it('splits pasted PIN codes on commas, spaces, semicolons and new lines', () => {
    expect(splitPincodes(' 600001,600002;600003\n600001 ')).toEqual(['600001', '600002', '600003']);
    expect(splitPincodes('')).toEqual([]);
  });
});

describe('server errors on the seller form', () => {
  const err = (status: number, detail: unknown) => toApiError(status, { detail });
  it('keeps field paths from request validation', () => {
    const e = err(422, [
      { loc: ['body', 'service_areas', 1, 'match'], msg: 'Value error, "XX" is not a PIN code prefix (1 to 6 digits), a state code like TN, or "*"', type: 'value_error' },
      { loc: ['body', 'address', 'pincode'], msg: "String should match pattern '^$|^\\d{6}$'", type: 'string_pattern_mismatch' },
      { loc: ['body', 'gstin'], msg: "String should match pattern '^$|^[0-9A-Z]{15}$'", type: 'string_pattern_mismatch' },
      { loc: ['body', 'capacity_factor'], msg: 'Input should be greater than 0', type: 'greater_than' },
    ]);
    expect(sellerServerErrors(e)).toEqual([
      { path: 'service_areas.1.match', message: '"XX" is not a PIN code prefix (1 to 6 digits), a state code like TN, or "*"' },
      { path: 'address.pincode', message: 'Six digits.' },
      { path: 'gstin', message: 'A GSTIN has 15 letters and digits, or leave it empty.' },
      { path: 'capacity_factor', message: 'Must be above 0.' },
    ]);
  });
  it('places model-level checks by what they mention', () => {
    const e = err(422, [
      { loc: ['body'], msg: "Value error, min_pieces can't be more than max_pieces", type: 'value_error' },
      { loc: ['body'], msg: 'Value error, each service area match can appear only once', type: 'value_error' },
      { loc: ['body'], msg: 'Value error, something new', type: 'value_error' },
    ]);
    expect(sellerServerErrors(e)).toEqual([
      { path: 'min_pieces', message: "Minimum pieces can't be more than the maximum." },
      { path: 'service_areas', message: 'Each service area match can appear only once' },
      { path: '', message: 'Something new' },
    ]);
  });
  it('maps plain 422 and 409 messages to their field', () => {
    expect(sellerServerErrors(err(422, "Unknown fabric 'silk'. Use one of: premium, pro, standard."))).toEqual([
      { path: 'fabrics', message: "Unknown fabric 'silk'. Use one of: premium, pro, standard." }]);
    expect(sellerServerErrors(err(409, "The house seller can't be switched off; remove its service areas instead.")).map((x) => x.path)).toEqual(['active']);
  });
  it('leaves other failures to the toast', () => {
    expect(sellerServerErrors(new ApiError(403, 'Your role (sales) cannot do this.'))).toEqual([]);
    expect(sellerServerErrors(new ApiError(500, 'boom'))).toEqual([]);
  });
});

describe('service-area editor rules', () => {
  it('classifies matches like the server', () => {
    expect(matchKind('641')).toBe('prefix');
    expect(matchKind('600001')).toBe('prefix');
    expect(matchKind('0641')).toBe('invalid');
    expect(matchKind('1234567')).toBe('invalid');
    expect(matchKind('tn')).toBe('state');
    expect(matchKind('XX')).toBe('invalid');
    expect(matchKind(' * ')).toBe('all');
    expect(describeMatch('TN')).toBe('Tamil Nadu');
    expect(describeMatch('64')).toBe('PIN codes 64…');
    expect(describeMatch('641001')).toBe('PIN code 641001');
    expect(describeMatch('*')).toBe('Everywhere else');
  });
  it('sorts most specific first: longest prefix, then states, then *', () => {
    const rows = [{ match: '*' }, { match: 'TN' }, { match: '6' }, { match: '641' }, { match: 'KA' }];
    expect(sortAreas(rows).map((r) => r.match)).toEqual(['641', '6', 'KA', 'TN', '*']);
    expect(specificity('641')).toBeGreaterThan(specificity('64'));
  });
  it('finds the area the server would use for a PIN code', () => {
    const areas = FAST.service_areas;
    expect(matchingArea(areas, '641001', 'TN')?.match).toBe('641');
    expect(matchingArea(areas, '600028', 'TN')?.match).toBe('TN');
    expect(matchingArea(areas, '560001', 'KA')?.match).toBe('*');
    expect(matchingArea([{ match: 'TN' }], '560001', 'KA')).toBeNull();
  });
  it('adds rows once, normalised', () => {
    const rows: AreaRow[] = [{ match: 'TN', transit_days: '2', cod: true }];
    expect(newArea(rows, ' ka ')).toEqual([...rows, { match: 'KA', transit_days: '3', cod: true }]);
    expect(newArea(rows, 'tn')).toBeNull();
  });
  it('checks rows: empty list, bad and duplicate matches, transit range', () => {
    const c1 = new Collector();
    checkAreas([], c1);
    expect(c1.errors).toEqual([{ path: 'service_areas', message: 'Add at least one area this seller delivers to.' }]);
    const c2 = new Collector();
    const out = checkAreas([
      { match: 'tn', transit_days: '2', cod: true }, { match: 'TN', transit_days: '3', cod: false },
      { match: '', transit_days: '1', cod: true }, { match: '600', transit_days: '99', cod: true },
    ], c2);
    expect(out[0]).toEqual({ match: 'TN', transit_days: 2, cod: true });
    expect(c2.errors.map((e) => e.path)).toEqual(['service_areas.1.match', 'service_areas.2.match', 'service_areas.3.transit_days']);
    expect(c2.errors[0].message).toContain('row 1');
  });
  it('summarises coverage for the sellers list', () => {
    expect(coverageSummary(FAST.service_areas, 1)).toBe('641… 1d · TN 2d · everywhere else 6d · COD in 2 of 3 · 1 blocked');
    expect(coverageSummary([{ match: 'TN', transit_days: 2, cod: true }])).toBe('TN 2d · COD everywhere');
    expect(coverageSummary([{ match: 'KA', transit_days: 3, cod: false }, { match: 'TN', transit_days: 2, cod: false }, { match: 'KL', transit_days: 2, cod: false }, { match: '*', transit_days: 7, cod: false }], 0, 2))
      .toBe('KA, KL, TN · everywhere else 7d · no COD');
    const many = [...Array.from({ length: 24 }, (_, i) => ({ match: String(11 + i), transit_days: 4, cod: true })), { match: 'TN', transit_days: 2, cod: true }, { match: '*', transit_days: 6, cod: true }];
    expect(coverageSummary(many, 2)).toBe('24 PIN prefixes · TN · everywhere else 6d · COD everywhere · 2 blocked');
    expect(coverageSummary([])).toBe('No coverage');
  });
});
