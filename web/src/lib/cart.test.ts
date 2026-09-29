import { describe, expect, it } from 'vitest';
import type { DesignSpec } from './api/types';
import {
  addToCart, cartPieces, designEntry, fromApiItems, linesSummary, MAX_CART_ITEMS, mergeCarts, mergeLines, productEntry,
  sameItem, setSingleQuantity, toApiItem, type CartEntry,
} from './cart';

const spec = { garment: 'jersey', style_name: 'Mine', typography: { team_name: 'Kings' } } as unknown as DesignSpec;
const line = (size: 'M' | 'L', quantity: number, player_name = '', number = '') => ({ size, quantity, player_name, number });

describe('cart items', () => {
  it('sends a product without a spec and a design without a product id', () => {
    expect(toApiItem(productEntry('prd_1', 'standard', [line('M', 2)], 'sel_2'))).toEqual({
      product_id: 'prd_1', fabric: 'standard', logos: 0, lines: [{ ...line('M', 2), fit: 'men' }], seller_id: 'sel_2',
    });
    const d = toApiItem(designEntry(spec, 'des_1', 'premium', [line('L', 1, 'Arul', '7')]));
    expect(d.product_id).toBeUndefined();
    expect(d.spec).toBe(spec);
    expect(d.design_id).toBe('des_1');
  });

  it('adds the same product again to its quantity, a different one as a new row', () => {
    let items: CartEntry[] = [];
    const a = addToCart(items, productEntry('prd_1', 'standard', [line('M', 2)]));
    expect(a.outcome).toBe('added');
    items = a.items;
    const b = addToCart(items, productEntry('prd_1', 'standard', [line('M', 1), line('L', 1)]));
    expect(b.outcome).toBe('combined');
    expect(b.items).toHaveLength(1);
    expect(b.items[0].lines).toEqual([line('M', 3), line('L', 1)]);
    const c = addToCart(b.items, productEntry('prd_1', 'premium', [line('M', 1)]));
    expect(c.items).toHaveLength(2);
    // Custom designs are never combined: each one is its own order.
    const d = addToCart(c.items, designEntry(spec, '', 'standard', [line('M', 1)]));
    const e = addToCart(d.items, designEntry(spec, '', 'standard', [line('M', 1)]));
    expect(e.items).toHaveLength(4);
    expect(cartPieces(e.items)).toBe(7);
  });

  it('refuses a 21st item', () => {
    let items: CartEntry[] = [];
    for (let i = 0; i < MAX_CART_ITEMS; i++) items = addToCart(items, productEntry(`prd_${i}`, 'standard', [line('M', 1)])).items;
    expect(addToCart(items, productEntry('prd_x', 'standard', [line('M', 1)])).outcome).toBe('full');
  });

  it('merges a device cart into the saved cart like the server does', () => {
    const saved = addToCart([], productEntry('prd_1', 'standard', [line('M', 2)])).items;
    const device = [
      ...addToCart([], productEntry('prd_1', 'standard', [line('M', 2)])).items, // identical: skipped
      ...addToCart([], designEntry(spec, '', 'standard', [line('L', 1)])).items,
    ];
    const { items, skipped } = mergeCarts(saved, device);
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(saved[0]);
    expect(skipped).toBe(0);
    expect(mergeCarts(saved, device, 1)).toMatchObject({ skipped: 1 });
  });

  it('rebuilds entries from the server and keeps keys of unchanged items', () => {
    const local = addToCart([], productEntry('prd_1', 'standard', [line('M', 2)])).items;
    const server = [toApiItem(local[0]), { product_id: 'prd_2', fabric: 'standard', lines: [line('L', 1)] }];
    const rebuilt = fromApiItems(server, local);
    expect(rebuilt[0].key).toBe(local[0].key);
    expect(rebuilt[1].key).not.toBe(local[0].key);
    expect(rebuilt[1]).toMatchObject({ product_id: 'prd_2', seller_id: '', spec: null, logos: 0 });
    expect(sameItem(rebuilt[0], local[0])).toBe(true);
  });

  it('summarises and edits lines', () => {
    expect(mergeLines([line('M', 499)], [line('M', 5)])[0].quantity).toBe(500);
    expect(linesSummary([line('L', 1), line('M', 2), line('M', 1, 'A')])).toBe('M × 3, L × 1');
    const e = { ...productEntry('prd_1', 'standard', [line('M', 2)]), key: 'k' };
    expect(setSingleQuantity(e, 0).lines[0].quantity).toBe(1);
    expect(setSingleQuantity(e, 9).lines[0].quantity).toBe(9);
  });
});

describe('options and fits on cart items', () => {
  it('sends a product colourway, sleeves and collar, and every line with its fit', () => {
    const e = productEntry('prd_1', 'standard', [{ ...line('M', 1), fit: 'women' }], '', { colourway: 'neon', sleeves: 'long', collar: 'polo' });
    expect(toApiItem(e)).toEqual({
      product_id: 'prd_1', fabric: 'standard', logos: 0, seller_id: '', colourway: 'neon', sleeves: 'long', collar: 'polo',
      lines: [{ player_name: '', number: '', fit: 'women', size: 'M', quantity: 1 }],
    });
    // The original colourway and no choices send nothing extra (older carts look the same).
    const plain = toApiItem(productEntry('prd_1', 'standard', [line('M', 1)], '', { colourway: 'original' }));
    expect(plain).not.toHaveProperty('colourway');
    expect(plain).not.toHaveProperty('sleeves');
  });
  it('reads choices back from the server cart and keeps a different colourway as its own row', () => {
    const [back] = fromApiItems([{ product_id: 'prd_1', fabric: 'standard', colourway: 'neon', sleeves: 'none',
      lines: [{ player_name: '', number: '', size: '8Y', fit: 'kids', quantity: 1 }] }]);
    expect(back).toMatchObject({ colourway: 'neon', sleeves: 'none', collar: '', lines: [{ fit: 'kids', size: '8Y' }] });
    let items: CartEntry[] = addToCart([], productEntry('prd_1', 'standard', [line('M', 1)])).items;
    items = addToCart(items, productEntry('prd_1', 'standard', [line('M', 1)], '', { colourway: 'neon' })).items;
    expect(items).toHaveLength(2);
  });
  it('merges lines only when the fit matches too', () => {
    const merged = mergeLines([line('M', 1)], [{ ...line('M', 2), fit: 'women' }, { ...line('M', 1), fit: 'men' }]);
    expect(merged.map((l) => `${l.fit ?? 'men'}:${l.quantity}`)).toEqual(['men:2', 'women:2']);
  });
  it('names fits in the summary when they are mixed', () => {
    const label = (f: string) => ({ men: 'Men', women: 'Women', kids: 'Kids' }[f] ?? f);
    expect(linesSummary([line('M', 1)], label)).toBe('M × 1');
    expect(linesSummary([line('M', 1), { ...line('M', 1), fit: 'kids', size: '10Y' as never }], label)).toBe('Men M × 1, Kids 10Y × 1');
  });
});
