import { describe, expect, it } from 'vitest';
import defaults from './fixtures/defaults.json';
import { cleanColourways, fullPalette, MAX_COLOURWAYS, newColourway, toColourwayId, validateColourways } from '../src/lib/colourways';
import { fitSizesFrom, isLiveApi } from '../src/lib/meta';
import { filesByLine, fitSize, measureColumns, optionsText, piecesParts, piecesText, printFileRequest } from '../src/lib/production';
import { formToPriceBook, priceBookToForm, setIn, stableJson, type PriceBook } from '../src/lib/settingsForm';
import type { Colourway, Order } from '../src/lib/types';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const pb = () => clone(defaults.price_book) as unknown as PriceBook;

describe('garment options in the price book', () => {
  it('round-trips the defaults with options and every size surcharge (3XL, kids)', () => {
    const f = priceBookToForm(pb());
    expect(f.options?.sleeves.long).toEqual({ name: 'Long sleeves', price: '60', active: true });
    expect(f.options?.sleeves.none.price).toBe('-20');
    expect(Object.keys(f.size_surcharge)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    const r = formToPriceBook(f, pb());
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(pb()));
  });

  it('sets the long-sleeve price and allows negative prices', () => {
    let f = priceBookToForm(pb());
    f = setIn(f, ['options', 'sleeves', 'long', 'price'], '75');
    f = setIn(f, ['options', 'collar', 'mandarin', 'price'], '-15.5');
    f = setIn(f, ['size_surcharge', '14Y'], '20');
    const r = formToPriceBook(f, pb());
    expect(r.errors).toEqual([]);
    expect(r.value.options!.sleeves.long.price).toBe(75);
    expect(r.value.options!.collar.mandarin.price).toBe(-15.5);
    expect(r.value.size_surcharge['14Y']).toBe(20);
  });

  it('short sleeves and the crew neck cannot be switched off; each group keeps one choice on', () => {
    let f = priceBookToForm(pb());
    f = setIn(f, ['options', 'sleeves', 'short', 'active'], false);
    f = setIn(f, ['options', 'collar', 'crew', 'active'], false);
    for (const x of ['men', 'women', 'kids']) f = setIn(f, ['options', 'fit', x, 'active'], false);
    const paths = formToPriceBook(f, pb()).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['options.sleeves.short.active', 'options.collar.crew.active', 'options.fit']));
  });

  it('switching off long sleeves and kids is fine', () => {
    let f = priceBookToForm(pb());
    f = setIn(f, ['options', 'sleeves', 'long', 'active'], false);
    f = setIn(f, ['options', 'fit', 'kids', 'active'], false);
    const r = formToPriceBook(f, pb());
    expect(r.errors).toEqual([]);
    expect(r.value.options!.fit.kids.active).toBe(false);
  });

  it('checks names and price limits at the server paths', () => {
    let f = priceBookToForm(pb());
    f = setIn(f, ['options', 'fit', 'women', 'name'], '');
    f = setIn(f, ['options', 'sleeves', 'none', 'price'], '-200000');
    f = setIn(f, ['options', 'collar', 'polo', 'price'], 'ninety');
    const paths = formToPriceBook(f, pb()).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['options.fit.women.name', 'options.sleeves.none.price', 'options.collar.polo.price']));
  });

  it('an older price book without options stays without them', () => {
    const old = pb();
    delete old.options;
    const f = priceBookToForm(old);
    expect(f.options).toBeNull();
    expect(formToPriceBook(f, old).value.options).toBeUndefined();
  });
});

describe('colourways', () => {
  const base = { primary: '#0B1F4B', secondary: '#F5B700', accent: '#ffffff', trim: '#111111', text: '#FFFFFF' };
  it('adds a colourway with an unused id and a full palette', () => {
    const a = newColourway([], base);
    expect(a).toEqual({ id: 'colourway-1', name: 'Colourway 1', palette: { primary: '#f5b700', secondary: '#0b1f4b', accent: '#ffffff', trim: '#111111', text: '#ffffff' } });
    const b = newColourway([{ ...a, id: 'colourway-2' }], base);
    expect(b.id).toBe('colourway-3');
    expect(validateColourways([a, b])).toEqual([]);
  });
  it('makes ids from names', () => {
    expect(toColourwayId('  Navy & Gold! ')).toBe('navy-gold');
  });
  it('validates like the server: id pattern, not original, unique, name, hex, at most 8', () => {
    const ok: Colourway = { id: 'red', name: 'Red', palette: fullPalette(base) };
    const errs = validateColourways([ok, { ...ok }, { ...ok, id: 'original' }, { ...ok, id: 'Bad id', name: ' ' }, { ...ok, id: 'x2', palette: { ...ok.palette, trim: 'red' } }]);
    expect(errs.map((e) => e.path)).toEqual(['colourways.1.id', 'colourways.2.id', 'colourways.3.id', 'colourways.3.name', 'colourways.4.palette.trim']);
    const many = Array.from({ length: MAX_COLOURWAYS + 1 }, (_, i) => ({ ...ok, id: `c${i}x` }));
    expect(validateColourways(many).map((e) => e.path)).toEqual(['colourways']);
  });
  it('cleans for the API', () => {
    expect(cleanColourways([{ id: 'sky', name: ' Sky ', palette: { ...fullPalette(base), primary: '#AABBCC' } }])[0]).toMatchObject({ name: 'Sky', palette: { primary: '#aabbcc' } });
  });
});

describe('production details of an order', () => {
  const order = {
    garment: 'jersey', spec: { garment: 'jersey' }, options: { sleeves: 'long', collar: 'polo' },
    lines: [
      { line: 1, fit: 'men', size: 'M', quantity: 10, player_name: 'ARUL', number: '7', measurements: { chest: 52, length: 72, shoulder: 46, sleeve: 62 },
        pieces_mm: { front: [560, 740], back: [560, 740], sleeve_left: [511, 650], sleeve_right: [511, 650] } },
      { line: 2, fit: 'kids', size: '8Y', quantity: 4, player_name: '', number: '', measurements: { chest: 36, length: 52, shoulder: 32, sleeve: 44 } },
    ],
    files: [
      { name: 'L02_K8Y_front.svg', line: 2, fit: 'kids', size: '8Y', panel: 'front', player_name: '', number: '' },
      { name: 'L01_M_front.svg', line: 1, fit: 'men', size: 'M', panel: 'front', player_name: 'ARUL', number: '7' },
      { name: 'L01_M_back.svg', line: 1, fit: 'men', size: 'M', panel: 'back', player_name: 'ARUL', number: '7' },
    ],
  } as unknown as Order;

  it('builds the measurement sheet request for each role', () => {
    expect(printFileRequest('ord_1', 'measurements.svg', true)).toEqual({ path: '/ops/orders/ord_1/print-files/measurements.svg', method: 'GET' });
    expect(printFileRequest('ord_1', 'measurements.svg', false)).toEqual({ path: '/orders/ord_1/files/measurements.svg', method: 'POST' });
  });
  it('groups print files by line, in line order', () => {
    const g = filesByLine(order);
    expect(g.map((x) => [x.lineNo, x.files.length, x.line?.size])).toEqual([[1, 2, 'M'], [2, 1, '8Y']]);
  });
  it('describes fit, size, measurements, pieces and options', () => {
    expect(fitSize(order.lines[1])).toBe('Kids 8Y');
    expect(fitSize(order.lines[0])).toBe('M');
    expect(fitSize(order.lines[0], true)).toBe('Men M');
    expect(measureColumns(order.lines).map(([k]) => k)).toEqual(['chest', 'length', 'shoulder', 'sleeve']);
    expect(piecesText(order.lines[0].pieces_mm)).toEqual(['Front, back 560\u00a0×\u00a0740', 'Sleeves (2) 511\u00a0×\u00a0650']);
    expect(piecesParts(order.lines[0].pieces_mm)).toEqual([['Front, back', '560\u00a0×\u00a0740'], ['Sleeves (2)', '511\u00a0×\u00a0650']]);
    expect(piecesText(undefined)).toEqual([]);
    expect(optionsText(order)).toEqual(['Long sleeves', 'Polo collar']);
    expect(optionsText({ ...order, garment: 'vneck', options: { sleeves: 'none' } })).toEqual(['Sleeveless']);
    expect(optionsText({ ...order, garment: 'shorts', options: {} })).toEqual([]);
    expect(optionsText({ ...order, options: undefined, spec: { garment: 'jersey' } })).toEqual(['Short sleeves', 'Crew neck']);
  });
});

describe('meta and health', () => {
  it('reads fit sizes from meta with the built-in lists as fallback', () => {
    expect(fitSizesFrom(null).kids).toEqual(['4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    expect(fitSizesFrom({ fit_sizes: { men: ['S', 'M'] } }).men).toEqual(['S', 'M']);
    expect(fitSizesFrom({ fit_sizes: { men: ['S', 'M'] } }).women).toHaveLength(6);
  });
  it('treats anything but this machine as a live API', () => {
    expect(isLiveApi('http://127.0.0.1:8200')).toBe(false);
    expect(isLiveApi('http://localhost:8000/')).toBe(false);
    expect(isLiveApi('https://api.unsattai.in')).toBe(true);
  });
});
