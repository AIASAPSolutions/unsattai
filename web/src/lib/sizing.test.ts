import { describe, expect, it } from 'vitest';
import type { SizeGuide } from './api/types';
import {
  checkSize, fitSizeBreakdown, fitSizeSummary, fitsFrom, guideColumns, guideHowTo, guideTable, isFitSize, normaliseFit, sizeForFit,
  sizesFor,
} from './sizing';

const label = (f: string) => ({ men: 'Men / unisex', women: 'Women', kids: 'Kids' }[f] ?? f);

const GUIDE: SizeGuide = {
  unit: 'cm', tolerance_cm: 1, note: 'Laid flat.',
  how_to_measure: [
    { id: 'chest', name: 'Chest', text: 'Across, 2 cm below the armholes.' },
    { id: 'length', name: 'Length', text: 'Shoulder to hem.' },
    { id: 'shoulder', name: 'Shoulder', text: 'Seam to seam.' },
    { id: 'sleeve', name: 'Sleeve', text: 'Seam to cuff.' },
    { id: 'body_chest', name: 'Your chest', text: 'All round.' },
    { id: 'height', name: 'Height (kids)', text: 'Without shoes.' },
  ],
  fits: [
    { id: 'men', name: 'Men / unisex', sizes: [
      { size: 'M', body_chest: [96, 101], height: null, top: { chest: 52, length: 72, shoulder: 46, sleeve_short: 20, sleeve_long: 62 }, shorts: { waist: 38, hip: 54, length: 45 } },
    ] },
    { id: 'kids', name: 'Kids', sizes: [
      { size: '8Y', body_chest: [64, 68], height: [122, 134], top: { chest: 36, length: 52, shoulder: 32, sleeve_short: 14, sleeve_long: 44 }, shorts: { waist: 27, hip: 38, length: 32 } },
    ] },
  ],
};

describe('fits and sizes', () => {
  it('treats a missing or unknown fit as men / unisex', () => {
    expect(normaliseFit(undefined)).toBe('men');
    expect(normaliseFit('ladies')).toBe('men');
    expect(normaliseFit('kids')).toBe('kids');
  });
  it('maps each fit to its sizes, preferring the server lists', () => {
    expect(sizesFor('men')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(sizesFor('women')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(sizesFor('kids')).toEqual(['4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    expect(sizesFor('men', { men: ['S', 'M', 'nonsense'] })).toEqual(['S', 'M']);
    expect(isFitSize('women', '3XL')).toBe(false);
    expect(isFitSize('kids', '8Y')).toBe(true);
  });
  it('offers only the fits the server lists (all three when it lists none)', () => {
    expect(fitsFrom({ men: ['M'], kids: ['8Y'] })).toEqual(['men', 'kids']);
    expect(fitsFrom(null)).toEqual(['men', 'women', 'kids']);
  });
  it('keeps the size when the new fit has it, else the middle size', () => {
    expect(sizeForFit('women', 'L')).toBe('L');
    expect(sizeForFit('women', '3XL')).toBe('M');
    expect(sizeForFit('kids', 'M')).toBe('8Y');
    expect(sizeForFit('men', '10Y')).toBe('M');
  });
  it('names print-check sizes the way the server reads them', () => {
    expect(checkSize('men', 'M')).toBe('M');
    expect(checkSize(undefined, 'XL')).toBe('XL');
    expect(checkSize('kids', '8Y')).toBe('kids:8Y');
  });
  it('summarises pieces by fit and size, naming fits only when they are mixed', () => {
    expect(fitSizeSummary([{ size: 'L', quantity: 1 }, { size: 'M', quantity: 2 }], label)).toBe('M × 2, L × 1');
    const rows = [
      { fit: 'kids' as const, size: '8Y' as const, quantity: 2 }, { fit: 'women' as const, size: 'S' as const, quantity: 1 },
      { size: 'M' as const, quantity: 1 }, { fit: 'women' as const, size: 'S' as const, quantity: 1 },
    ];
    expect(fitSizeSummary(rows, label)).toBe('Men / unisex M × 1, Women S × 2, Kids 8Y × 2');
    expect(fitSizeBreakdown(rows).map((r) => `${r.fit}:${r.size}`)).toEqual(['men:M', 'women:S', 'kids:8Y']);
  });
});

describe('size guide table', () => {
  it('shows jersey columns with the sleeve for the chosen sleeves', () => {
    expect(guideColumns('jersey', 'men', 'short')).toEqual(['chest', 'length', 'shoulder', 'sleeve', 'body_chest']);
    expect(guideColumns('vneck', 'men', 'none')).toEqual(['chest', 'length', 'shoulder', 'body_chest']);
    expect(guideColumns('shorts', 'kids')).toEqual(['waist', 'hip', 'length', 'body_chest', 'height']);
  });
  it('fills cells from the guide: short or long sleeve, shorts length, ranges', () => {
    expect(guideTable(GUIDE, 'men', 'jersey', 'short')?.rows).toEqual([{ size: 'M', cells: ['52', '72', '46', '20', '96–101'] }]);
    expect(guideTable(GUIDE, 'men', 'jersey', 'long')?.rows[0].cells[3]).toBe('62');
    expect(guideTable(GUIDE, 'kids', 'shorts')?.rows).toEqual([{ size: '8Y', cells: ['27', '38', '32', '64–68', '122–134'] }]);
    expect(guideTable(GUIDE, 'women', 'jersey')).toBeNull();
  });
  it('lists how to measure what the table shows', () => {
    expect(guideHowTo(GUIDE, guideColumns('jersey', 'kids', 'long')).map((m) => m.id))
      .toEqual(['chest', 'length', 'shoulder', 'sleeve', 'body_chest', 'height']);
    expect(guideHowTo(GUIDE, guideColumns('shorts', 'men')).map((m) => m.id)).toEqual(['length', 'body_chest']);
  });
});
