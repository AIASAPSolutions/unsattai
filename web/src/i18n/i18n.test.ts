import { describe, expect, it } from 'vitest';
import { DICTS, translate } from './index';
import webEn from './web/en';

const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('every language has every key, with the same {placeholders} as English', () => {
    for (const lang of ['hi', 'te', 'ta'] as const) {
      for (const [key, en] of Object.entries(DICTS.en)) {
        const other = (DICTS[lang] as Record<string, string>)[key];
        expect(other, `${lang}.${key}`).toBeTypeOf('string');
        expect(params(other), `${lang}.${key} placeholders`).toEqual(params(en));
      }
    }
  });
  it('web strings are really translated (not English copies)', () => {
    for (const lang of ['hi', 'te', 'ta'] as const) {
      const same = Object.keys(webEn).filter((k) => {
        const v = (webEn as Record<string, string>)[k];
        return /[a-z]{4}/i.test(v.replace(/\{\w+\}|UrJersey|CSV|PNG|JPEG|WebP|SVG|WhatsApp|Ctrl|Shift|Delete|Tab|ord_|GSM|KB|ID|3D|SMS|mm/g, ''))
          && (DICTS[lang] as Record<string, string>)[k] === v;
      });
      expect(same, lang).toEqual([]);
    }
  });
  it('fills parameters', () => {
    expect(translate('en', 'piecesN', { n: 3 })).toBe('3 pieces');
    expect(translate('hi', 'placeOrderFor', { total: '₹10' })).toContain('₹10');
  });
});
