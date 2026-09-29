import { describe, expect, it } from 'vitest';
import { blankLine, logoCount, parseRoster, specOptions, toQuoteLines, totalPieces, withFit, withSalesDiscount } from '../src/lib/quote';
import type { Pricing } from '../src/lib/types';

describe('parseRoster', () => {
  it('reads name, number, size and quantity in common shapes', () => {
    const { lines, bad } = parseRoster('Arul, 7, M, 2\nPriya 9 s\nL x 10\n\nno size here\nKarthik Raja\t23\tXXL');
    expect(bad).toEqual([5]);
    expect(lines).toEqual([
      { fit: 'men', player_name: 'Arul', number: '7', size: 'M', quantity: '2' },
      { fit: 'men', player_name: 'Priya', number: '9', size: 'S', quantity: '1' },
      { fit: 'men', player_name: '', number: '', size: 'L', quantity: '10' },
      { fit: 'men', player_name: 'Karthik Raja', number: '23', size: 'XXL', quantity: '1' },
    ]);
  });
  it('reads fits: kids sizes, and the words women / kids', () => {
    const { lines, bad } = parseRoster('Kavin, 5, 8Y\nDivya, women, S, 2\n3xl x 4\nkids M\nwomen 3XL');
    expect(lines).toEqual([
      { fit: 'kids', player_name: 'Kavin', number: '5', size: '8Y', quantity: '1' },
      { fit: 'women', player_name: 'Divya', number: '', size: 'S', quantity: '2' },
      { fit: 'men', player_name: '', number: '', size: '3XL', quantity: '4' },
    ]);
    // M is not a kids size and women's sizes stop at XXL
    expect(bad).toEqual([4, 5]);
  });
});

describe('toQuoteLines', () => {
  it('converts and validates', () => {
    const r = toQuoteLines([{ ...blankLine('M'), quantity: '12', player_name: ' ARUL ' }, { fit: 'men', size: 'L', quantity: '0', player_name: '', number: '1234' }]);
    expect(r.lines[0]).toEqual({ fit: 'men', size: 'M', quantity: 12, player_name: 'ARUL', number: '' });
    expect(r.errors).toEqual({ 'lines.1.quantity': '1 to 5000', 'lines.1.number': 'Up to 3 digits' });
    expect(toQuoteLines([]).errors.lines).toBeDefined();
  });
  it('checks the size belongs to the fit', () => {
    const r = toQuoteLines([blankLine('8Y', 'kids'), { ...blankLine('M'), fit: 'kids' }, { ...blankLine('3XL'), fit: 'women' }]);
    expect(r.lines[0]).toMatchObject({ fit: 'kids', size: '8Y' });
    expect(Object.keys(r.errors)).toEqual(['lines.1.size', 'lines.2.size']);
    expect(r.errors['lines.1.size']).toBe('M is not a Kids size');
  });
  it('withFit keeps the size when the fit has it, else uses the usual size', () => {
    expect(withFit(blankLine('L'), 'women').size).toBe('L');
    expect(withFit(blankLine('3XL'), 'women').size).toBe('M');
    expect(withFit(blankLine('L'), 'kids')).toMatchObject({ fit: 'kids', size: '8Y' });
    expect(withFit(blankLine('8Y', 'kids'), 'men').size).toBe('M');
  });
  it('specOptions: sleeves not for shorts, collar only for the crew-neck jersey', () => {
    expect(specOptions({ garment: 'jersey', sleeves: 'long', collar: 'polo' })).toEqual({ sleeves: 'long', collar: 'polo' });
    expect(specOptions({ garment: 'vneck', sleeves: 'none', collar: 'polo' })).toEqual({ sleeves: 'none', collar: 'crew' });
    expect(specOptions({ garment: 'shorts', sleeves: 'long' })).toEqual({ sleeves: 'short', collar: 'crew' });
    expect(specOptions(null)).toEqual({ sleeves: 'short', collar: 'crew' });
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
