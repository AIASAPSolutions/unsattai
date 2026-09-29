import { describe, expect, it } from 'vitest';
import type { DesignSpec } from './api/types';
import {
  collarOf, formatDelta, hasCollarChoice, hasSleeves, optionChoices, optionPrice, productImageUrl, sleevesOf, specOptions, swatchColours,
  withOption,
} from './options';

const jersey = { garment: 'jersey' } as unknown as DesignSpec;
const catalogue = {
  options: {
    sleeves: [{ id: 'short', name: 'Short sleeves', price: 0 }, { id: 'long', name: 'Long sleeves', price: 60 }, { id: 'none', name: 'Sleeveless', price: -20 }],
    collar: [{ id: 'crew', name: 'Crew neck', price: 0 }, { id: 'polo', name: 'Polo', price: 90 }],
    fit: [{ id: 'men', name: 'Men', price: 0 }, { id: 'kids', name: 'Kids', price: -60 }],
  },
};

describe('price differences', () => {
  it('formats a per-piece difference with its sign, and nothing when it costs the same', () => {
    expect(formatDelta(60)).toBe('+₹60');
    expect(formatDelta(-20)).toBe('−₹20');
    expect(formatDelta(0)).toBe('');
    expect(formatDelta(12.5)).toBe('+₹12.50');
  });
  it('reads choices and prices from the catalogue, or offers every choice at no cost without one', () => {
    expect(optionChoices(catalogue, 'sleeves').map((o) => o.id)).toEqual(['short', 'long', 'none']);
    expect(optionChoices(catalogue, 'collar').map((o) => o.id)).toEqual(['crew', 'polo']);   // mandarin switched off
    expect(optionChoices(null, 'collar')).toEqual([
      { id: 'crew', name: 'crew', price: 0 }, { id: 'polo', name: 'polo', price: 0 }, { id: 'mandarin', name: 'mandarin', price: 0 },
    ]);
    expect(optionPrice(catalogue, 'fit', 'kids')).toBe(-60);
    expect(optionPrice(catalogue, 'fit', 'women')).toBe(0);
  });
});

describe('garment options', () => {
  it('defaults older designs to short sleeves and a crew neck', () => {
    expect(sleevesOf(jersey)).toBe('short');
    expect(collarOf({ collar: 'weird' as never })).toBe('crew');
  });
  it('only lets garments take the options they can have', () => {
    expect([hasSleeves('jersey'), hasSleeves('vneck'), hasSleeves('shorts')]).toEqual([true, true, false]);
    expect([hasCollarChoice('jersey'), hasCollarChoice('vneck')]).toEqual([true, false]);
    expect(withOption(jersey, 'sleeves', 'none').sleeves).toBe('none');
    expect(withOption({ ...jersey, garment: 'vneck' }, 'collar', 'polo').collar).toBeUndefined();
    expect(withOption({ ...jersey, garment: 'shorts' }, 'sleeves', 'long').sleeves).toBeUndefined();
    expect(withOption(jersey, 'collar', 'bow-tie')).toBe(jersey);
    expect(specOptions({ ...jersey, sleeves: 'long', collar: 'polo' })).toEqual({ sleeves: 'long', collar: 'polo' });
    expect(specOptions({ ...jersey, garment: 'shorts' })).toEqual({});
  });
});

describe('colourways', () => {
  it('builds the product picture URL with the choices (the original colourway needs no parameter)', () => {
    expect(productImageUrl('royal strikers')).toBe('/api/uj/shop/products/royal%20strikers/mockup.svg');
    expect(productImageUrl('rs', { colourway: 'original', sleeves: 'long' })).toBe('/api/uj/shop/products/rs/mockup.svg?sleeves=long');
    expect(productImageUrl('rs', { colourway: 'neon', sleeves: 'none', collar: 'polo' }))
      .toBe('/api/uj/shop/products/rs/mockup.svg?colourway=neon&sleeves=none&collar=polo');
  });
  it('takes swatch colours from the list swatch or the detail palette', () => {
    expect(swatchColours({ id: 'a', name: 'A', swatch: ['#111111', '#222222'] })).toEqual(['#111111', '#222222']);
    expect(swatchColours({ id: 'b', name: 'B', palette: { primary: '#333333', secondary: '#444444' } })).toEqual(['#333333', '#444444']);
    expect(swatchColours({ id: 'c', name: 'C' })).toBeNull();
  });
});
