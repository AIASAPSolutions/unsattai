import { describe, expect, it } from 'vitest';
import type { Quote } from './api/types';
import { breakdownRows, formatDate, formatMoney, freeDeliveryGap, fromPrice, quoteKey, quoteLines, tierNudge } from './price';

function quote(p: Partial<Quote> = {}): Quote {
  return {
    currency: 'INR', price_book_version: 1, garment: 'jersey', fabric: { id: 'standard', name: 'Std' }, lines: [], pieces: 7,
    subtotal: 4823, quantity_discount: { min: 1, rate: 0, amount: 0, next: { min: 10, rate: 0.05, pieces_needed: 3 } },
    rush: { selected: false, amount: 0, rate: 0.25, label: 'Express' }, coupon: null,
    shipping: { method: 'ship', zone: 'home', zone_name: 'TN', amount: 99, free: false, free_above: 6000, transit_days: 2 },
    tax: { name: 'GST', rate: 0.05, amount: 245, inclusive: false }, total: 5167, average_per_piece: 738.14, problems: [], ...p,
  };
}

describe('formatting', () => {
  it('formats rupees with Indian grouping and no needless decimals', () => {
    expect(formatMoney(123456)).toBe('₹1,23,456');
    expect(formatMoney(831.97)).toBe('₹831.97');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(1000, 'INR', 'ta')).toMatch(/1,000/);
  });
  it('reads YYYY-MM-DD as a calendar date', () => {
    expect(formatDate('2026-10-04')).toBe('Sun, 4 Oct');
    expect(formatDate('2026-10-04', 'en', true)).toBe('Sun, 4 Oct, 2026');
    expect(formatDate(null)).toBe('—');
  });
});

describe('fromPrice', () => {
  it('adds the cheapest fabric that fits the garment', () => {
    const fabrics = [{ surcharge: 120, garments: ['jersey'] }, { surcharge: 0, garments: ['shorts'] }, { surcharge: 60, garments: ['jersey'] }];
    expect(fromPrice(499, fabrics, 'jersey')).toBe(559);
    expect(fromPrice(299, fabrics, 'shorts')).toBe(299);
    expect(fromPrice(299, fabrics, 'vneck')).toBe(299);
  });
});

describe('nudges', () => {
  it('suggests the next quantity tier', () => {
    expect(tierNudge(quote())).toEqual({ piecesNeeded: 3, rate: 0.05, min: 10 });
    expect(tierNudge(quote({ quantity_discount: { min: 50, rate: 0.15, amount: 1, next: null } }))).toBeNull();
  });
  it('works out how much more unlocks free delivery', () => {
    expect(freeDeliveryGap(quote())).toBe(1177);
    const withRushAndCoupon = quote({
      rush: { selected: true, amount: 1200, rate: 0.25, label: 'x' }, coupon: { code: 'C', amount: 500 },
      quantity_discount: { min: 1, rate: 0, amount: 23, next: null },
    });
    expect(freeDeliveryGap(withRushAndCoupon)).toBe(500);
    expect(freeDeliveryGap(quote({ shipping: { method: 'ship', amount: 0, free: true, free_above: 6000, transit_days: 2 } }))).toBeNull();
    expect(freeDeliveryGap(quote({ shipping: { method: 'pickup', amount: 0, free: true, transit_days: 0 } }))).toBeNull();
    expect(freeDeliveryGap(quote({ shipping: { method: 'ship', amount: 99, free: false, free_above: null, transit_days: 2 } }))).toBeNull();
  });
});

describe('breakdownRows', () => {
  it('lists only the parts that apply, in the server order', () => {
    expect(breakdownRows(quote()).map((r) => r.key)).toEqual(['subtotal', 'shipping', 'tax', 'total']);
    const full = quote({
      quantity_discount: { min: 10, rate: 0.05, amount: 240, next: null }, rush: { selected: true, amount: 1200, rate: 0.25, label: 'x' },
      coupon: { code: 'C', amount: 480 }, sales_discount: 500,
      shipping: { method: 'ship', amount: 0, free: true, transit_days: 2 },
    });
    const rows = breakdownRows(full);
    expect(rows.map((r) => r.key)).toEqual(['subtotal', 'quantity_discount', 'rush', 'coupon', 'shipping', 'tax', 'sales_discount', 'total']);
    expect(rows.filter((r) => r.negative).map((r) => r.key)).toEqual(['quantity_discount', 'coupon', 'sales_discount']);
    expect(rows.find((r) => r.key === 'shipping')?.free).toBe(true);
  });
  it('ignores a coupon that saved nothing', () => {
    expect(breakdownRows(quote({ coupon: { code: 'BAD', amount: 0, error: 'expired' } })).map((r) => r.key)).not.toContain('coupon');
  });
});

describe('quote requests', () => {
  it('merges identical rows and drops empty ones', () => {
    expect(quoteLines([
      { size: 'M', quantity: 1, player_name: 'A', number: '7' }, { size: 'M', quantity: 2, player_name: 'A', number: '7' },
      { size: 'L', quantity: 0, player_name: 'B', number: '8' }, { size: 'L', quantity: 1, player_name: '', number: '' },
    ])).toEqual([{ size: 'M', quantity: 3, player_name: 'A', number: '7' }, { size: 'L', quantity: 1, player_name: '', number: '' }]);
  });
  it('builds the same key for the same request (coupon case-insensitive)', () => {
    const base = { garment: 'jersey' as const, fabric: 'standard', logos: 0, lines: [{ size: 'M' as const, quantity: 1, player_name: '', number: '' }],
      delivery: { method: 'ship' as const, pincode: '', state: '' }, rush: false, coupon: 'welcome10' };
    expect(quoteKey(base)).toBe(quoteKey({ ...base, coupon: 'WELCOME10 ' }));
    expect(quoteKey(base)).not.toBe(quoteKey({ ...base, rush: true }));
  });
});
