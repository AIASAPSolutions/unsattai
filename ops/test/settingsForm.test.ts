import { describe, expect, it } from 'vitest';
import defaults from './fixtures/defaults.json';
import {
  Collector, companyToForm, crmToForm, deliveryToForm, formToCompany, formToCrm, formToDelivery, formToPriceBook,
  formToProduction, isCatchAll, numText, pctText, priceBookToForm, productionToForm, setIn, splitList, stableJson, toCode,
  type CrmConfig, type Delivery, type PriceBook, type Production, type Company,
} from '../src/lib/settingsForm';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const pb = () => clone(defaults.price_book) as unknown as PriceBook;
const prod = () => clone(defaults.production) as Production;
const dl = () => clone(defaults.delivery) as Delivery;

describe('primitives', () => {
  it('numText / pctText avoid float noise', () => {
    expect(numText(0.1 + 0.2)).toBe('0.3');
    expect(numText(null)).toBe('');
    expect(pctText(0.05)).toBe('5');
    expect(pctText(0.125)).toBe('12.5');
    expect(pctText(0.07)).toBe('7');
  });
  it('splitList trims, drops blanks and duplicates, optionally upper-cases', () => {
    expect(splitList(' tn, kl,, TN\nka ', true)).toEqual(['TN', 'KL', 'KA']);
    expect(splitList('60, 61, 60')).toEqual(['60', '61']);
    expect(splitList('')).toEqual([]);
  });
  it('Collector parses numbers and records errors by path', () => {
    const c = new Collector();
    expect(c.num('a', ' 1,200 ')).toBe(1200);
    expect(c.num('b', 'abc')).toBe(0);
    expect(c.num('c', '')).toBe(0);
    expect(c.num('d', '2.5', { int: true })).toBe(2.5);
    expect(c.num('e', '-1', { min: 0 })).toBe(-1);
    expect(c.optNum('f', '')).toBeNull();
    expect(c.pct('g', '12.5')).toBe(0.125);
    expect(c.date('h', '2026-02-30x')).toBe('2026-02-30x');
    expect(c.errors.map((e) => e.path)).toEqual(['b', 'c', 'd', 'e', 'h']);
  });
  it('toCode makes lower_snake codes', () => {
    expect(toCode('  Design Shared! ')).toBe('design_shared');
    expect(toCode('Walk-in')).toBe('walk_in');
  });
  it('setIn updates immutably', () => {
    const a = { x: [{ y: 1 }, { y: 2 }], z: { w: 'a' } };
    const b = setIn(a, ['x', 1, 'y'], 5);
    expect(b.x[1].y).toBe(5);
    expect(a.x[1].y).toBe(2);
    expect(b.x[0]).toBe(a.x[0]);
    expect(b.z).toBe(a.z);
  });
  it('stableJson ignores key order', () => {
    expect(stableJson({ a: 1, b: { d: 1, c: 2 } })).toBe(stableJson({ b: { c: 2, d: 1 }, a: 1 }));
  });
});

describe('price book', () => {
  it('round-trips the server defaults exactly', () => {
    const r = formToPriceBook(priceBookToForm(pb()), pb());
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(pb()));
  });
  it('shows rates as percent and converts back to fractions', () => {
    const f = priceBookToForm(pb());
    expect(f.tax.rate).toBe('5');
    expect(f.quantity_tiers[1].discount).toBe('5');
    expect(f.rush.fee_rate).toBe('25');
    f.tax.rate_above = '18';
    f.quantity_tiers[4].discount = '22.5';
    const v = formToPriceBook(f).value;
    expect(v.tax.rate_above).toBe(0.18);
    expect(v.quantity_tiers[4].discount).toBe(0.225);
  });
  it('empty cap and expiry become null; codes are upper-cased', () => {
    const f = priceBookToForm(pb());
    f.coupons.push({ code: 'team25', kind: 'amount', value: '250', max_discount: '', min_subtotal: '', active: true, expires: '', note: ' x ', public: false, title: '' });
    const c = formToPriceBook(f).value.coupons[1];
    expect(c).toEqual({ code: 'TEAM25', kind: 'amount', value: 250, max_discount: null, min_subtotal: 0, active: true, expires: null, note: 'x', public: false, title: '' });
  });
  it('reports errors at the same paths the server uses', () => {
    const f = priceBookToForm(pb());
    f.garments.jersey.base = 'abc';
    f.fabrics[2].garments = [];
    f.quantity_tiers[0].min = '2';
    f.quantity_tiers[2].min = '5';
    f.coupons.push({ ...f.coupons[0] });
    f.coupons[0].value = '95';
    const paths = formToPriceBook(f).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['garments.jersey.base', 'fabrics.2.garments', 'quantity_tiers.0.min', 'quantity_tiers.2.min', 'coupons.1.code', 'coupons.0.value']));
  });
  it('keeps fields the form does not know about', () => {
    const base = { ...pb(), future_field: 1 } as unknown as PriceBook;
    expect((formToPriceBook(priceBookToForm(base), base).value as unknown as { future_field: number }).future_field).toBe(1);
  });
});

describe('production', () => {
  it('round-trips the defaults', () => {
    const r = formToProduction(productionToForm(prod()), prod());
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(prod()));
  });
  it('adds a holiday, sorted and de-duplicated, and validates dates', () => {
    const f = productionToForm(prod());
    f.holidays = ['2026-11-01', '2026-10-20', '2026-11-01'];
    const r = formToProduction(f);
    expect(r.value.holidays).toEqual(['2026-10-20', '2026-11-01']);
    f.holidays = ['20-10-2026'];
    expect(formToProduction(f).errors[0].path).toBe('holidays.0');
  });
  it('validates capacity, cut-off and working days', () => {
    const f = productionToForm(prod());
    f.stages[1].capacity_per_day = '0';
    f.daily_cutoff_hour = '24';
    f.working_days = [];
    expect(formToProduction(f).errors.map((e) => e.path)).toEqual(['working_days', 'daily_cutoff_hour', 'stages.1.capacity_per_day']);
  });
});

describe('delivery', () => {
  it('round-trips the defaults', () => {
    const r = formToDelivery(deliveryToForm(dl()), dl());
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(dl()));
  });
  it('edits lists as comma text', () => {
    const f = deliveryToForm(dl());
    expect(f.zones[0].states).toBe('TN');
    expect(f.zones[0].pincode_prefixes).toBe('60, 61, 62, 63, 64');
    f.zones[0].states = 'tn, py';
    f.zones[0].free_above = '';
    const z = formToDelivery(f).value.zones[0];
    expect(z.states).toEqual(['TN', 'PY']);
    expect(z.free_above).toBeNull();
  });
  it('requires one catch-all zone', () => {
    const f = deliveryToForm(dl());
    expect(isCatchAll(f.zones[3])).toBe(true);
    f.zones[3].states = 'GJ';
    expect(formToDelivery(f).errors.map((e) => e.path)).toContain('zones');
  });
  it('checks pincode prefixes and tracking links', () => {
    const f = deliveryToForm(dl());
    f.zones[1].pincode_prefixes = '50, 5a';
    f.carriers[0].tracking_url = 'https://x.example/track';
    expect(formToDelivery(f).errors.map((e) => e.path)).toEqual(['zones.1.pincode_prefixes', 'carriers.0.tracking_url']);
  });
});

describe('company and CRM', () => {
  it('round-trips company and upper-cases the prefix', () => {
    const co = clone(defaults.company) as Company;
    expect(stableJson(formToCompany(companyToForm(co), co).value)).toBe(stableJson(co));
    const f = companyToForm(co);
    f.invoice_prefix = 'uj-in';
    f.quote_valid_days = '0';
    f.email = 'nope';
    const r = formToCompany(f);
    expect(r.value.invoice_prefix).toBe('UJ-IN');
    expect(r.errors.map((e) => e.path)).toEqual(['quote_valid_days', 'email']);
  });
  it('round-trips CRM lists and enforces won/lost', () => {
    const x = clone(defaults.crm) as CrmConfig;
    expect(stableJson(formToCrm(crmToForm(x), x).value)).toBe(stableJson(x));
    const f = crmToForm(x);
    f.lead_stages = ['new', 'Sample Sent', 'won'];
    const r = formToCrm(f);
    expect(r.value.lead_stages).toEqual(['new', 'sample_sent', 'won']);
    expect(r.errors.map((e) => e.path)).toEqual(['lead_stages']);
  });
});

describe('marketplace settings', () => {
  it('edits cash on delivery: fee, empty limit means none, 0 is refused', () => {
    const f = priceBookToForm(pb());
    expect(f.cod).toEqual({ enabled: true, fee: '49', max_order_value: '20000' });
    f.cod = { enabled: false, fee: '', max_order_value: '' };
    let r = formToPriceBook(f, pb());
    expect(r.errors).toEqual([]);
    expect(r.value.cod).toEqual({ enabled: false, fee: 0, max_order_value: null });
    f.cod = { enabled: true, fee: '20000', max_order_value: '0' };
    r = formToPriceBook(f, pb());
    expect(r.errors.map((e) => e.path)).toEqual(['cod.fee', 'cod.max_order_value']);
  });
  it('keeps coupon public and title, and a public coupon needs a title', () => {
    const f = priceBookToForm(pb());
    expect(f.coupons[0]).toMatchObject({ public: true, title: '10% off orders above 1000 (up to 500)' });
    f.coupons[0].title = '  ';
    expect(formToPriceBook(f, pb()).errors).toEqual([{ path: 'coupons.0.title', message: 'A public coupon needs a title customers can read.' }]);
    f.coupons[0].public = false;
    expect(formToPriceBook(f, pb()).value.coupons[0]).toMatchObject({ public: false, title: '' });
  });
  it('reads an older price book without cod as switched off', () => {
    const old = pb();
    delete (old as Partial<PriceBook>).cod;
    expect(priceBookToForm(old).cod).toEqual({ enabled: false, fee: '0', max_order_value: '' });
  });
  it('edits the return window and reasons', () => {
    const x = clone(defaults.crm) as CrmConfig;
    const f = crmToForm(x);
    expect(f.return_window_days).toBe('7');
    expect(f.returnable_reasons).toEqual(['damaged', 'wrong_item', 'print_quality']);
    f.returnable_reasons = ['Damaged', 'Wrong size', 'x'];
    f.return_window_days = '61';
    const r = formToCrm(f, x);
    expect(r.value.returnable_reasons).toEqual(['damaged', 'wrong_size', 'x']);
    expect(r.errors.map((e) => e.path)).toEqual(['return_window_days', 'returnable_reasons']);
    f.returnable_reasons = [];
    f.return_window_days = '0';
    expect(formToCrm(f, x).errors).toEqual([]);
  });
});
