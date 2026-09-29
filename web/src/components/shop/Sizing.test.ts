import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translate } from '@/i18n';
import { I18nProvider } from '@/i18n/provider';
import type { SizeGuide } from '@/lib/api/types';
import { ChoiceCards, optionsText, SizeGuideTable } from './Sizing';

const html = (el: ReactElement, lang: 'en' | 'hi' = 'en') => renderToStaticMarkup(h(I18nProvider, { initial: lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const t = (k: Parameters<typeof translate>[1]) => translate('en', k);

const guide: SizeGuide = {
  unit: 'cm', tolerance_cm: 1, note: 'Garment measurements, laid flat.',
  how_to_measure: [
    { id: 'chest', name: 'Chest', text: 'Measure straight across.' },
    { id: 'sleeve', name: 'Sleeve', text: 'From the shoulder seam.' },
    { id: 'height', name: 'Height (kids)', text: 'Without shoes.' },
  ],
  fits: [
    { id: 'men', name: 'Men / unisex', sizes: [
      { size: 'M', body_chest: [96, 101], height: null, top: { chest: 52, length: 72, shoulder: 46, sleeve_short: 20, sleeve_long: 62 }, shorts: { waist: 38, hip: 54, length: 45 } },
      { size: 'L', body_chest: [102, 107], height: null, top: { chest: 55, length: 74, shoulder: 48, sleeve_short: 21, sleeve_long: 64 }, shorts: { waist: 40, hip: 56, length: 46 } },
    ] },
    { id: 'kids', name: 'Kids', sizes: [
      { size: '8Y', body_chest: [64, 68], height: [122, 134], top: { chest: 36, length: 52, shoulder: 32, sleeve_short: 14, sleeve_long: 44 }, shorts: { waist: 27, hip: 38, length: 32 } },
    ] },
  ],
};

describe('size guide table', () => {
  it('shows the jersey measurements with the long sleeve, fits chest, the note and tolerance', () => {
    const out = html(h(SizeGuideTable, { guide, fit: 'men', garment: 'jersey', sleeves: 'long', highlight: 'L' }));
    const head = text(out.slice(out.indexOf('<thead'), out.indexOf('</thead>')));
    expect(head).toBe('Size Chest Length Shoulder Sleeve (long) Fits chest');
    expect(text(out)).toContain('M 52 72 46 62 96–101');
    expect(out).toMatch(/<tr[^>]*aria-current="true"[^>]*><th scope="row">L<\/th>/);
    expect(text(out)).toContain('Men / unisex sizes, measurements in cm');
    expect(text(out)).toContain('Garment measurements, laid flat.');
    expect(text(out)).toContain('Finished garments can differ by up to 1 cm.');
    expect(text(out)).toContain('Sleeve: From the shoulder seam.');
  });
  it('shows kids their height and shorts their waist and hip, without sleeves when sleeveless', () => {
    const kids = text(html(h(SizeGuideTable, { guide, fit: 'kids', garment: 'shorts' })));
    expect(kids).toContain('Size Waist Hip Length Fits chest Height');
    expect(kids).toContain('8Y 27 38 32 64–68 122–134');
    const vest = text(html(h(SizeGuideTable, { guide, fit: 'men', garment: 'jersey', sleeves: 'none' })));
    expect(vest).not.toContain('Sleeve (short)');
    expect(vest).toContain(t('sgSleeveless'));
  });
  it('is translated', () => {
    expect(text(html(h(SizeGuideTable, { guide, fit: 'men', garment: 'jersey' }), 'hi'))).toContain('छाती');
  });
});

describe('option choices', () => {
  it('shows each choice with its price difference and nothing when it costs the same', () => {
    const out = html(h(ChoiceCards, {
      legend: 'Sleeves', name: 'sl', value: 'short', onChange: () => undefined, testId: 'opt',
      choices: [{ value: 'short', label: 'Short sleeves', delta: 0 }, { value: 'long', label: 'Long sleeves', delta: 60 },
        { value: 'none', label: 'Sleeveless', delta: -20 }],
    }));
    expect(out).toContain('<fieldset');
    expect(out).toContain('<legend');
    expect((out.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(text(out)).toBe('Sleeves Short sleeves Long sleeves +₹60 Sleeveless −₹20');
    expect(out).toMatch(/<input type="radio" name="sl" checked="" value="short"\/>/);
  });
  it('describes what a garment is made with', () => {
    const en = (k: string) => translate('en', k as never);
    expect(optionsText(en, { garment: 'jersey', sleeves: 'none', collar: 'polo', colourway: 'Neon Arcade' })).toBe('Neon Arcade · Sleeveless · Polo');
    expect(optionsText(en, { garment: 'vneck', sleeves: 'long', collar: 'polo' })).toBe('Long sleeves');
    expect(optionsText(en, { garment: 'jersey' })).toBe('Short sleeves · Crew neck');
    expect(optionsText(en, { garment: 'shorts', sleeves: 'long' })).toBe('');
  });
});
