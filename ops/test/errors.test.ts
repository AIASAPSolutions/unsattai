import { describe, expect, it } from 'vitest';
import { ApiError, errorsAt, errorsByPath, errorText, friendly, locToPath, statusMessage, toApiError } from '../src/lib/errors';

describe('locToPath', () => {
  it('strips body and value from request-validation locs', () => {
    expect(locToPath(['body', 'value', 'fabrics', 0, 'id'])).toBe('fabrics.0.id');
  });
  it('handles the settings handler shape (body + dotted path split into strings)', () => {
    expect(locToPath(['body', 'quantity_tiers', '2', 'min'])).toBe('quantity_tiers.2.min');
  });
  it('maps model-level errors (empty path) to the form', () => {
    expect(locToPath(['body', ''])).toBe('');
    expect(locToPath(['body'])).toBe('');
    expect(locToPath(undefined)).toBe('');
  });
  it('keeps a field literally called "value" deeper in the path', () => {
    expect(locToPath(['body', 'coupons', 0, 'value'])).toBe('coupons.0.value');
  });
  it('supports a custom strip list', () => {
    expect(locToPath(['body', 'request', 'lines', 0, 'size'], ['body', 'request'])).toBe('lines.0.size');
  });
});

describe('toApiError', () => {
  it('uses a string detail as the message', () => {
    const e = toApiError(409, { detail: 'price_book was changed by someone else (version 3). Reload and try again.' });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(409);
    expect(e.isConflict).toBe(true);
    expect(e.message).toMatch(/version 3/);
  });
  it('maps 422 detail lists to field errors with friendly messages', () => {
    const e = toApiError(422, { detail: [
      { loc: ['body', 'name'], msg: 'String should have at least 1 character', type: 'value_error' },
      { loc: ['body', 'lead_stages'], msg: 'Field required', type: 'missing' },
      { loc: ['body', ''], msg: 'Value error, one zone must have no states', type: 'value_error' },
    ] });
    expect(e.fields).toEqual([
      { path: 'name', message: 'String should have at least 1 character' },
      { path: 'lead_stages', message: 'Required.' },
      { path: '', message: 'One zone must have no states' },
    ]);
    expect(e.message).toBe('3 values need attention.');
  });
  it('names the field when there is only one', () => {
    expect(toApiError(422, { detail: [{ loc: ['body', 'value', 'tax', 'rate'], msg: 'Input should be less than or equal to 0.5' }] }).message)
      .toBe('tax.rate: Input should be less than or equal to 0.5');
  });
  it('reads order errors ({detail: {message}})', () => {
    expect(toApiError(409, { detail: { message: 'This order was cancelled.' } }).message).toBe('This order was cancelled.');
  });
  it('falls back to a status message for HTML or empty bodies', () => {
    expect(toApiError(502, '<html>bad gateway</html>').message).toBe(statusMessage(502));
    expect(toApiError(404, null).message).toBe('Not found.');
  });
  it('uses short plain-text bodies', () => {
    expect(toApiError(400, 'bad thing').message).toBe('bad thing');
  });
});

describe('messages', () => {
  it('friendly() rewrites pydantic phrasing', () => {
    expect(friendly('Input should be a valid number, unable to parse string as a number')).toBe('Enter a number.');
    expect(friendly('value error, oops')).toBe('Value error, oops');
    expect(friendly('Value error, a percent coupon can be at most 90')).toBe('A percent coupon can be at most 90');
  });
  it('errorText explains 403 with the role', () => {
    expect(errorText(new ApiError(403, 'Your role (production) cannot change price_book.'), 'production'))
      .toBe('Not allowed for your role (production): Your role (production) cannot change price_book.');
    expect(errorText(new Error('x'))).toBe('x');
    expect(errorText('plain')).toBe('plain');
  });
  it('statusMessage covers network failure and server errors', () => {
    expect(statusMessage(0)).toMatch(/Could not reach/);
    expect(statusMessage(503)).toMatch(/server had a problem/);
  });
});

describe('errorsByPath / errorsAt', () => {
  const map = errorsByPath([
    { path: 'fabrics.0.id', message: 'bad id' },
    { path: 'fabrics.0.garments', message: 'pick one' },
    { path: 'fabrics', message: 'unique ids' },
    { path: 'fabrics10.x', message: 'other' },
  ]);
  it('finds exact paths', () => {
    expect(errorsAt(map, 'fabrics.0.id')).toEqual(['bad id']);
    expect(errorsAt(map, 'nope')).toEqual([]);
  });
  it('finds a subtree without matching sibling prefixes', () => {
    expect(errorsAt(map, 'fabrics', true).sort()).toEqual(['bad id', 'pick one', 'unique ids']);
  });
});
