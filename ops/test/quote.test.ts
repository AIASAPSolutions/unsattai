import { describe, expect, it } from 'vitest';
import { blankLine, logoCount, parseRoster, toQuoteLines, totalPieces, withSalesDiscount } from '../src/lib/quote';
import type { Pricing } from '../src/lib/types';

describe('parseRoster', () => {
  it('reads name, number, size and quantity in common shapes', () => {
    const { lines, bad } = parseRoster('Arul, 7, M, 2\nPriya 9 s\nL x 10\n\nno size here\nKarthik Raja\t23\tXXL');
    expect(bad).toEqual([5]);
    expect(lines).toEqual([
      { player_name: 'Arul', number: '7', size: 'M', quantity: '2' },
      { player_name: 'Priya', number: '9', size: 'S', quantity: '1' },
      { player_name: '', number: '', size: 'L', quantity: '10' },
      { player_name: 'Karthik Raja', number: '23', size: 'XXL', quantity: '1' },
    ]);
  });
});

describe('toQuoteLines', () => {
  it('converts and validates', () => {
    const r = toQuoteLines([{ ...blankLine('M'), quantity: '12', player_name: ' ARUL ' }, { size: 'L', quantity: '0', player_name: '', number: '1234' }]);
    expect(r.lines[0]).toEqual({ size: 'M', quantity: 12, player_name: 'ARUL', number: '' });
    expect(r.errors).toEqual({ 'lines.1.quantity': '1 to 5000', 'lines.1.number': 'Up to 3 digits' });
    expect(toQuoteLines([]).errors.lines).toBeDefined();
  });
  it('totals pieces', () => {
    expect(totalPieces([{ ...blankLine(), quantity: '3' }, { ...blankLine(), quantity: 'x' }])).toBe(3);
  });
});

describe('pricing helpers', () => {
  const p = { total: 1000, currency: 'INR' } as Pricing;
  it('applies the sales discount like the server (never below zero)', () => {
    expect(withSalesDiscount(p, 150)).toMatchObject({ total: 850, sales_discount: 150 });
    expect(withSalesDiscount(p, 5000)).toMatchObject({ total: 0, sales_discount: 1000 });
    expect(withSalesDiscount(p, 0)).toBe(p);
  });
  it('counts logos, at most 4', () => {
    expect(logoCount({ garment: 'jersey', elements: [{ type: 'logo' }, { type: 'text' }, { type: 'logo' }] })).toBe(2);
    expect(logoCount({ garment: 'jersey', elements: Array(6).fill({ type: 'logo' }) })).toBe(4);
    expect(logoCount(null)).toBe(0);
  });
});
