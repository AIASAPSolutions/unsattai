import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '../api/client';
import type { CartItem, Meta, SizeGuide } from '../api/types';
import { GarmentOptionsPicker, activeChoices, optionsText } from '../components/GarmentOptionsPicker';
import { FitSizePicker } from '../components/OrderInputs';
import { SizeGuideBody } from '../components/SizeGuide';
import { addLine, linesSummary, toServerItems, type CartLine } from '../features/cart/cart';
import { DICTS, errorMessage, translate } from '../i18n';
import en from '../i18n/en';
import {
  checkSize, fitOf, fitsFrom, guideColumns, guideHowTo, guideTable, pickedOptions, priceDelta, sizeForNewFit, sizesForFit, withFit,
} from '../lib/sizing';
import { isSafe, safeZone } from '../lib/geometry';
import { fitLayersToZone } from '../lib/spec';
import { isDemoPaymentsOff, noteDemoPaymentsOff, resetShopInfo } from '../state/shopInfo';

// The pickers read the server's size lists from meta; tests use the built-in lists.
jest.mock('../state/meta', () => ({ useMeta: () => ({ meta: null, error: null, retry: () => {} }) }));

const row = (size: string, extra: object = {}) => ({
  size, body_chest: [86, 91] as [number, number], height: null,
  top: { chest: 50, length: 70, shoulder: 44, sleeve_short: 20, sleeve_long: 60 },
  shorts: { waist: 38, hip: 50, length: 45 }, ...extra,
});

const guide: SizeGuide = {
  unit: 'cm', tolerance_cm: 1, note: 'Garment measurements, laid flat.',
  how_to_measure: [
    { id: 'chest', name: 'Chest', text: 'Measure across below the armholes.' },
    { id: 'length', name: 'Length', text: 'Shoulder to hem.' },
    { id: 'shoulder', name: 'Shoulder', text: 'Seam to seam.' },
    { id: 'sleeve', name: 'Sleeve', text: 'Shoulder seam to cuff.' },
    { id: 'body_chest', name: 'Your chest', text: 'All round.' },
    { id: 'height', name: 'Height (kids)', text: 'Without shoes.' },
  ],
  fits: [
    { id: 'men', name: 'Men / unisex', sizes: [row('M'), row('L', { top: { chest: 53, length: 72, shoulder: 46, sleeve_short: 21, sleeve_long: 62 } })] },
    { id: 'women', name: 'Women', sizes: [row('S')] },
    { id: 'kids', name: 'Kids', sizes: [row('8Y', { height: [122, 134], top: { chest: 36, length: 52, shoulder: 32, sleeve_short: 13, sleeve_long: 44 } })] },
  ],
} as SizeGuide;

describe('fits and sizes', () => {
  it('lists each fit\'s sizes, from the server when it sent them', () => {
    expect(sizesForFit('men')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(sizesForFit('women')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(sizesForFit('kids')).toEqual(['4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    const meta = { fit_sizes: { kids: ['6Y', '8Y'] }, options: { sleeves: [], collars: [], fits: ['men', 'kids'] } } as unknown as Meta;
    expect(sizesForFit('kids', meta)).toEqual(['6Y', '8Y']);
    expect(sizesForFit('women', meta)).toContain('XXL');
    expect(fitsFrom(meta)).toEqual(['men', 'kids']);
    expect(fitsFrom(null)).toEqual(['men', 'women', 'kids']);
  });

  it('keeps the size when the new fit has it, else picks the middle size', () => {
    expect(sizeForNewFit('women', 'M')).toBe('M');
    expect(sizeForNewFit('women', '3XL')).toBe('M');
    expect(sizeForNewFit('kids', 'L')).toBe('8Y');
    expect(sizeForNewFit('men', '10Y')).toBe('M');
  });

  it('reads old lines without a fit as men\'s and sends a fit on every line', () => {
    expect(fitOf({})).toBe('men');
    expect(fitOf({ fit: 'kids' })).toBe('kids');
    expect(fitOf({ fit: 'bogus' })).toBe('men');
    expect(withFit([{ player_name: '', number: '', size: 'M', quantity: 1 }])[0].fit).toBe('men');
    expect(checkSize({ size: 'M' })).toBe('M');
    expect(checkSize({ fit: 'kids', size: '8Y' })).toBe('kids:8Y');
    expect(checkSize({ fit: 'women', size: 'S' })).toBe('women:S');
  });

  it('sends only the options the customer picked, and only where they apply', () => {
    expect(pickedOptions('jersey', {})).toBeUndefined();
    expect(pickedOptions('jersey', { sleeves: 'none', collar: 'polo' })).toEqual({ sleeves: 'none', collar: 'polo' });
    expect(pickedOptions('vneck', { sleeves: 'long', collar: 'polo' })).toEqual({ sleeves: 'long' });
    expect(pickedOptions('shorts', { sleeves: 'long', collar: 'polo' })).toBeUndefined();
  });

  it('shows prices as differences per piece', () => {
    const money = (n: number) => `₹${n}`;
    expect(priceDelta(60, money)).toBe('+₹60');
    expect(priceDelta(-20, money)).toBe('−₹20');
    expect(priceDelta(0, money)).toBe('');
  });
});

describe('size guide table', () => {
  it('shows jersey columns with the sleeve for the current sleeves, and height for kids', () => {
    expect(guideColumns('jersey', 'short', 'men')).toEqual(['chest', 'length', 'shoulder', 'sleeve', 'body_chest']);
    expect(guideColumns('jersey', 'none', 'men')).toEqual(['chest', 'length', 'shoulder', 'body_chest']);
    expect(guideColumns('shorts', 'short', 'kids')).toEqual(['waist', 'hip', 'shorts_length', 'body_chest', 'height']);
    const long = guideTable(guide, 'men', 'jersey', 'long')!;
    expect(long.rows[1]).toEqual({ size: 'L', cells: ['53', '72', '46', '62', '86–91'] });
    expect(guideTable(guide, 'men', 'jersey', 'short')!.rows[1].cells[3]).toBe('21');
    expect(guideTable(guide, 'kids', 'jersey', 'short')!.rows[0].cells).toEqual(['36', '52', '32', '13', '86–91', '122–134']);
    expect(guideTable(guide, 'kids', 'shorts', 'short')!.rows[0].cells.slice(0, 3)).toEqual(['38', '50', '45']);
    expect(guideHowTo(guide, long.columns).map((m) => m.id)).toEqual(['chest', 'length', 'shoulder', 'sleeve', 'body_chest']);
  });

  it('renders Men, Women and Kids tabs, highlights the chosen size and switches fit', async () => {
    const onFit = jest.fn();
    const { rerender } = await render(
      <SizeGuideBody guide={guide} fit="men" onFit={onFit} garment="jersey" sleeves="long" highlight="L" />,
    );
    expect(screen.getByText('Men / unisex')).toBeTruthy();
    expect(screen.getByText('Fits chest')).toBeTruthy();
    expect(screen.getByTestId('guide-row-L')).toBeTruthy();
    expect(screen.getByText('62')).toBeTruthy();                    // long sleeve for L
    expect(screen.queryByText('Height')).toBeNull();
    expect(screen.getByTestId('guide-note')).toBeTruthy();
    expect(screen.getByText(/Made to within ±1 cm/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('guide-fit-kids'));
    expect(onFit).toHaveBeenCalledWith('kids');
    await rerender(<SizeGuideBody guide={guide} fit="kids" onFit={onFit} garment="jersey" sleeves="long" />);
    expect(screen.getByText('Height')).toBeTruthy();
    expect(screen.getByText('122–134')).toBeTruthy();
    expect(screen.getByTestId('guide-how-height')).toBeTruthy();
  });

  it('shows shorts measurements for shorts', async () => {
    await render(<SizeGuideBody guide={guide} fit="men" onFit={() => {}} garment="shorts" sleeves="short" />);
    expect(screen.getByText('Waist')).toBeTruthy();
    expect(screen.getByText('Hip')).toBeTruthy();
    expect(screen.queryByText('Shoulder')).toBeNull();
  });
});

describe('pickers', () => {
  it('fit then size: kids shows kids sizes and moves the size to a kids one', async () => {
    const onChange = jest.fn();
    const { rerender } = await render(
      <FitSizePicker testID="s" fit="men" size="L" garment="jersey" sleeves="short" onChange={onChange} />,
    );
    expect(screen.getByTestId('s-3XL')).toBeTruthy();
    expect(screen.getByTestId('s-guide')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('s-fit-kids'));
    expect(onChange).toHaveBeenCalledWith({ fit: 'kids', size: '8Y' });
    await rerender(<FitSizePicker testID="s" fit="kids" size="8Y" garment="jersey" sleeves="short" onChange={onChange} />);
    expect(screen.queryByTestId('s-M')).toBeNull();
    await fireEvent.press(screen.getByTestId('s-12Y'));
    expect(onChange).toHaveBeenLastCalledWith({ fit: 'kids', size: '12Y' });
  });

  const prices = {
    sleeves: [{ id: 'short', name: 'Short', price: 0 }, { id: 'long', name: 'Long', price: 60 }, { id: 'none', name: 'Sleeveless', price: -20 }],
    collar: [{ id: 'crew', name: 'Crew', price: 0 }, { id: 'polo', name: 'Polo', price: 90 }],
    fit: [],
  };

  it('sleeves and collar with price differences; picks call back', async () => {
    const onSleeves = jest.fn();
    const onCollar = jest.fn();
    await render(<GarmentOptionsPicker garment="jersey" sleeves="short" collar="crew" onSleeves={onSleeves} onCollar={onCollar}
      prices={prices} testID="o" />);
    expect(screen.getByText('Long sleeves (+₹60)')).toBeTruthy();
    expect(screen.getByText('Sleeveless (−₹20)')).toBeTruthy();
    expect(screen.getByText('Polo collar (+₹90)')).toBeTruthy();
    expect(screen.queryByTestId('o-collar-mandarin')).toBeNull();     // switched off in the price book
    await fireEvent.press(screen.getByTestId('o-sleeves-none'));
    await fireEvent.press(screen.getByTestId('o-collar-polo'));
    expect(onSleeves).toHaveBeenCalledWith('none');
    expect(onCollar).toHaveBeenCalledWith('polo');
  });

  it('no collar for a V-neck and nothing for shorts', async () => {
    await render(<GarmentOptionsPicker garment="vneck" sleeves="short" collar="crew" onSleeves={() => {}} onCollar={() => {}} testID="v" />);
    expect(screen.getByTestId('v-sleeves-long')).toBeTruthy();
    expect(screen.queryByTestId('v-collar-polo')).toBeNull();
    await render(<GarmentOptionsPicker garment="shorts" sleeves="short" collar="crew" onSleeves={() => {}} onCollar={() => {}} testID="sh" />);
    expect(screen.queryByTestId('sh')).toBeNull();
  });

  it('describes the options and keeps the current choice listed', () => {
    const t = (k: keyof typeof en) => translate('en', k);
    expect(optionsText(t, 'jersey', 'none', 'mandarin')).toBe('Sleeveless · Mandarin collar');
    expect(optionsText(t, 'vneck', undefined, 'polo')).toBe('Short sleeves');
    expect(optionsText(t, 'shorts', 'long', 'polo')).toBe('');
    expect(activeChoices(['a', 'b', 'c'] as const, [{ id: 'a' }], 'c')).toEqual(['a', 'c']);
  });
});

describe('safe print area follows sleeves and collar', () => {
  const spec = {
    garment: 'jersey', sleeves: 'short', collar: 'crew',
    typography: { team_name: 'Chennai Strikers', player_name: '', number: '', font: 'block' },
    elements: [{ id: 't', type: 'text', bind: 'team_name', panel: 'front', x: 270, y: 200, rotation: 0, text: '', size: 36 }],
  } as unknown as import('../api/types').DesignSpec;

  it('mirrors the server: sleeveless is narrower, a polo placket starts lower', () => {
    expect(safeZone('jersey', 'front', 'none')[0]).toEqual([165, 110]);
    expect(safeZone('jersey', 'front', 'short', 'polo')[0][1]).toBe(162);
    expect(safeZone('vneck', 'front', 'short', 'polo')[0][1]).toBe(170);
  });

  it('shrinks layers that no longer fit after going sleeveless', () => {
    expect(isSafe(spec, spec.elements[0])).toBe(true);
    const bare = { ...spec, sleeves: 'none' as const };
    expect(isSafe(bare, bare.elements[0])).toBe(false);
    const fixed = fitLayersToZone(bare);
    expect(fixed.elements.every((e) => isSafe(fixed, e))).toBe(true);
    expect(fitLayersToZone(spec)).toBe(spec);                         // nothing to do: same object
  });
});

describe('cart lines with fits and options', () => {
  const product = (over: Partial<CartItem> = {}, fit?: 'kids'): CartLine => ({
    key: Math.random().toString(36), title: 'Kings',
    item: { product_id: 'p1', fabric: 'standard', lines: [{ player_name: '', number: '', size: fit ? '8Y' : 'M', quantity: 1, ...(fit ? { fit } : {}) }], ...over },
  });

  it('only merges the same fit, size, colourway, sleeves and collar', () => {
    let lines: CartLine[] = [product()];
    expect(addLine(lines, product()).outcome).toBe('merged');
    expect(addLine(lines, product({}, 'kids')).outcome).toBe('added');
    expect(addLine(lines, product({ sleeves: 'long' })).outcome).toBe('added');
    expect(addLine(lines, product({ colourway: 'night' })).outcome).toBe('added');
    // An old line without a fit is the same as a men's line.
    lines = [product()];
    const men = product();
    men.item.lines[0].fit = 'men';
    expect(addLine(lines, men).outcome).toBe('merged');
  });

  it('sends fit on every line and says the fit in the summary', () => {
    expect(toServerItems([product()])[0].lines[0].fit).toBe('men');
    const lines = [{ player_name: 'Kavin', number: '4', fit: 'kids' as const, size: '8Y' as const, quantity: 2 },
      { player_name: '', number: '', size: 'M' as const, quantity: 1 }];
    expect(linesSummary(lines)).toBe('Kavin 4 · 8Y × 2, M × 1');
    expect(linesSummary(lines, 3, (f) => translate('en', f === 'kids' ? 'fit_kids' : 'fit_men'))).toBe('Kavin 4 · Kids 8Y × 2, Men / unisex M × 1');
  });
});

describe('demo payments', () => {
  afterEach(resetShopInfo);

  it('explains a demo_payments_off answer and remembers it', () => {
    const off = new ApiError('forbidden', 'Online payment is not available yet.', 403, [], { code: 'demo_payments_off' });
    expect(isDemoPaymentsOff(off)).toBe(true);
    expect(errorMessage((k, p) => translate('en', k, p), off)).toBe('Online payment is coming soon. Choose cash on delivery.');
    expect(noteDemoPaymentsOff(new ApiError('network', 'x'))).toBe(false);
    expect(noteDemoPaymentsOff(off)).toBe(true);
    expect(noteDemoPaymentsOff(new ApiError('network', 'x'))).toBe(true);
  });
});

describe('translations', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it.each(['hi', 'te', 'ta'] as const)('%s has every string, none empty', (lang) => {
    const dict = DICTS[lang] as Record<string, string>;
    expect(Object.keys(dict).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(dict[k].trim().length).toBeGreaterThan(0);
  });

  it.each(['hi', 'te', 'ta'] as const)('%s translates the new sizing and option strings and keeps placeholders', (lang) => {
    const dict = DICTS[lang] as Record<string, string>;
    const fresh = ['sleeves_short', 'sleeves_long', 'sleeves_none', 'collar_crew', 'collar_polo', 'collar_mandarin', 'fit_men', 'fit_women',
      'fit_kids', 'sizeGuide', 'guide_chest', 'guide_body_chest', 'guide_height', 'howToMeasure', 'demoPaymentsOff', 'colourway'] as const;
    for (const k of fresh) expect(dict[k]).not.toBe(en[k]);
    for (const k of keys) {
      const want = (en[k].match(/\{\w+\}/g) ?? []).sort();
      expect([k, (dict[k].match(/\{\w+\}/g) ?? []).sort()]).toEqual([k, want]);
    }
  });
});
