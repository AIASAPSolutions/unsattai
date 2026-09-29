import { describe, expect, it } from 'vitest';
import defaults from './fixtures/defaults.json';
import { setIn, stableJson } from '../src/lib/settingsForm';
import { fitErrorCount, formToSizing, sizingToForm, type Sizing, type SizingForm } from '../src/lib/sizingForm';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const sizing = () => clone(defaults.sizing) as unknown as Sizing;
const paths = (f: SizingForm) => formToSizing(f, sizing()).errors.map((e) => e.path);

describe('size chart editor', () => {
  it('round-trips the server defaults exactly', () => {
    const r = formToSizing(sizingToForm(sizing()), sizing());
    expect(r.errors).toEqual([]);
    expect(stableJson(r.value)).toBe(stableJson(sizing()));
  });

  it('has fixed rows per fit, in chart order, with kids heights', () => {
    const f = sizingToForm(sizing());
    expect(f.fits.men.sizes.map((r) => r.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(f.fits.women.sizes.map((r) => r.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(f.fits.kids.sizes.map((r) => r.size)).toEqual(['4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    expect(f.fits.kids.sizes[2].height).toEqual(['122', '134']);
    expect(f.fits.men.sizes[2].height).toEqual(['', '']);
    expect(f.fits.women.sizes[1].top.chest).toBe('44.5');
  });

  it('keeps the fixed size order even if the stored chart is shuffled or short', () => {
    const v = sizing();
    v.fits.kids.sizes.reverse();
    v.fits.women.sizes.pop();
    const f = sizingToForm(v);
    expect(f.fits.kids.sizes.map((r) => r.size)).toEqual(['4Y', '6Y', '8Y', '10Y', '12Y', '14Y']);
    expect(f.fits.women.sizes[5].size).toBe('XXL');
    // the missing row's numbers are required before saving
    expect(paths(f)).toContain('fits.women.sizes.5.top.chest');
  });

  it('edits a kids value (strings in, numbers out)', () => {
    let f = sizingToForm(sizing());
    f = setIn(f, ['fits', 'kids', 'sizes', 2, 'top', 'chest'], '36.5');
    f = setIn(f, ['fits', 'kids', 'sizes', 2, 'height', 1], '135');
    const r = formToSizing(f, sizing());
    expect(r.errors).toEqual([]);
    expect(r.value.fits.kids.sizes[2].top.chest).toBe(36.5);
    expect(r.value.fits.kids.sizes[2].height).toEqual([122, 135]);
    expect(r.value.fits.men.sizes[0].height).toBeNull();
  });

  it('uses the server limits (exclusive) and paths', () => {
    let f = sizingToForm(sizing());
    f = setIn(f, ['fits', 'men', 'sizes', 0, 'top', 'chest'], '10');          // must be > 10
    f = setIn(f, ['fits', 'men', 'sizes', 0, 'top', 'sleeve_long'], 'abc');
    f = setIn(f, ['fits', 'women', 'sizes', 0, 'shorts', 'hip'], '110');      // must be < 110
    f = setIn(f, ['fits', 'kids', 'sizes', 0, 'top', 'length'], '');
    const r = formToSizing(f, sizing());
    expect(r.errors).toContainEqual({ path: 'fits.men.sizes.0.top.chest', message: 'Between 10 and 120 cm.' });
    expect(r.errors).toContainEqual({ path: 'fits.men.sizes.0.top.sleeve_long', message: 'Enter a number.' });
    expect(r.errors).toContainEqual({ path: 'fits.women.sizes.0.shorts.hip', message: 'Between 15 and 110 cm.' });
    expect(r.errors).toContainEqual({ path: 'fits.kids.sizes.0.top.length', message: 'Required.' });
    expect(fitErrorCount(r.errors, 'men')).toBe(2);
    expect(fitErrorCount(r.errors, 'kids')).toBeGreaterThanOrEqual(1);
  });

  it('chest and length must not shrink as sizes go up', () => {
    let f = sizingToForm(sizing());
    f = setIn(f, ['fits', 'kids', 'sizes', 3, 'top', 'chest'], '35');   // 10Y below 8Y (36)
    f = setIn(f, ['fits', 'men', 'sizes', 6, 'top', 'length'], '70');   // 3XL below XXL (78)
    const r = formToSizing(f, sizing());
    expect(r.errors).toContainEqual({ path: 'fits.kids.sizes.3.top.chest', message: 'Must not be smaller than 8Y (36).' });
    expect(r.errors).toContainEqual({ path: 'fits.men.sizes.6.top.length', message: 'Must not be smaller than XXL (78).' });
    // other measurements may go down (e.g. a shorter kids sleeve)
    const ok = setIn(sizingToForm(sizing()), ['fits', 'kids', 'sizes', 3, 'top', 'sleeve_short'], '12');
    expect(paths(ok)).toEqual([]);
  });

  it('checks ranges are from <= to, kids need a height, adults never keep one', () => {
    let f = sizingToForm(sizing());
    f = setIn(f, ['fits', 'men', 'sizes', 1, 'body_chest'], ['99', '90']);
    f = setIn(f, ['fits', 'kids', 'sizes', 1, 'height'], ['', '']);
    f = setIn(f, ['fits', 'women', 'sizes', 1, 'height'], ['150', '160']);
    const r = formToSizing(f, sizing());
    expect(r.errors).toContainEqual({ path: 'fits.men.sizes.1.body_chest', message: 'From must not be more than to.' });
    expect(r.errors.filter((e) => e.path === 'fits.kids.sizes.1.height').length).toBeGreaterThan(0);
    expect(r.value.fits.women.sizes[1].height).toBeNull();
  });

  it('validates tolerance, note and fit names', () => {
    let f = sizingToForm(sizing());
    f = setIn(f, ['tolerance_cm'], '6');
    f = setIn(f, ['note'], 'x'.repeat(401));
    f = setIn(f, ['fits', 'women', 'name'], ' ');
    expect(paths(f)).toEqual(expect.arrayContaining(['tolerance_cm', 'note', 'fits.women.name']));
  });
});
