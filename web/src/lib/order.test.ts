import { describe, expect, it } from 'vitest';
import type { DesignSpec } from './api/types';
import { EMPTY_ADDRESS, EMPTY_CHECKOUT, type RosterRow } from './flow';
import { buildItems, hashString, orderPayload, payloadHash, rowsForFailure, validateAddress, validateCustomer, validateItems } from './order';

const spec = { garment: 'jersey', typography: { team_name: 'T', player_name: 'Arul', number: '07', font: 'block' } } as unknown as DesignSpec;
const row = (p: Partial<RosterRow>): RosterRow => ({ key: Math.random().toString(), player_name: '', number: '', size: 'M', quantity: 1, ...p });

describe('buildItems', () => {
  it('single orders print the studio name and number', () => {
    expect(buildItems({ ...EMPTY_CHECKOUT, single: { size: 'L', quantity: 3 } }, spec))
      .toEqual([{ player_name: 'Arul', number: '07', fit: 'men', size: 'L', quantity: 3 }]);
  });
  it('team orders use the roster, trimmed, with Indian digits normalised', () => {
    const items = buildItems({ ...EMPTY_CHECKOUT, mode: 'team', rows: [row({ player_name: ' Priya ', number: '१०', size: 'S' })] }, spec);
    expect(items).toEqual([{ player_name: 'Priya', number: '10', fit: 'men', size: 'S', quantity: 1 }]);
  });
});

describe('validation', () => {
  it('flags row problems by index and an empty roster', () => {
    const issues = validateItems([
      { player_name: 'Averyveryverylongname', number: '7', size: 'M', quantity: 1 },
      { player_name: 'A', number: '1234', size: 'M', quantity: 0 },
    ], 'team');
    expect(issues).toEqual([
      { kind: 'row', index: 0, field: 'player_name' }, { kind: 'row', index: 1, field: 'number' }, { kind: 'row', index: 1, field: 'quantity' },
    ]);
    expect(validateItems([], 'team')).toEqual([{ kind: 'emptyRoster' }]);
    expect(validateItems(Array.from({ length: 11 }, () => ({ player_name: '', number: '', size: 'M' as const, quantity: 500 })), 'team'))
      .toContainEqual({ kind: 'tooManyPieces' });
  });
  it('checks the address: PIN code, state code, required lines', () => {
    expect(validateAddress({ ...EMPTY_ADDRESS, line1: '12 Anna Salai', city: 'Chennai', state: 'TN', pincode: '600002' })).toEqual([]);
    expect(validateAddress({ ...EMPTY_ADDRESS, line1: 'x', city: '', state: 'Tamil Nadu', pincode: '6000' }).map((i) => (i as { field: string }).field))
      .toEqual(['line1', 'city', 'state', 'pincode']);
  });
  it('checks the customer', () => {
    expect(validateCustomer({ name: 'Arul', phone: '9876543210', email: '' })).toEqual([]);
    expect(validateCustomer({ name: '', phone: '12', email: 'nope' }).length).toBe(3);
  });
});

describe('order payload and idempotency', () => {
  const draft = { ...EMPTY_CHECKOUT, method: 'pickup' as const, coupon: ' welcome10 ', address: { ...EMPTY_ADDRESS, line1: '12 Road' } };
  const input = { designId: 'd1', spec, items: [{ player_name: 'A', number: '1', size: 'M' as const, quantity: 1 }],
    customer: { name: ' Arul ', phone: '9876543210 ', email: '' }, language: 'ta' as const, draft };
  it('is sent on the web channel, with trimmed contact and no address for pickup', () => {
    const p = orderPayload(input);
    expect(p.channel).toBe('web');
    expect(p.coupon).toBe('WELCOME10');
    expect(p.customer).toEqual({ name: 'Arul', phone: '9876543210', email: '' });
    expect(p.delivery).toEqual({ method: 'pickup', address: null });
    expect(orderPayload({ ...input, draft: { ...draft, method: 'ship' } }).delivery?.address?.line1).toBe('12 Road');
  });
  it('the same order hashes the same; a changed order does not', () => {
    expect(payloadHash(orderPayload(input))).toBe(payloadHash(orderPayload({ ...input })));
    expect(payloadHash(orderPayload(input))).not.toBe(payloadHash(orderPayload({ ...input, draft: { ...draft, rush: true } })));
    expect(hashString('abc')).toMatch(/^[0-9a-f]{8}/);
  });
  it('maps a server failure back to the roster rows it came from', () => {
    const items = [
      { player_name: 'A', number: '1', size: 'M' as const, quantity: 1 }, { player_name: 'B', number: '2', size: 'L' as const, quantity: 1 },
      { player_name: 'A', number: '1', size: 'M' as const, quantity: 2 },
    ];
    expect(rowsForFailure(items, { player_name: 'A', number: '1', size: 'M' })).toEqual([0, 2]);
    expect(rowsForFailure(items, { player_name: 'C', number: '', size: 'M' })).toEqual([]);
  });
});

describe('fits on order lines', () => {
  it('sends the fit with every line and flags a size the fit does not have', () => {
    const items = buildItems({ ...EMPTY_CHECKOUT, mode: 'team', rows: [row({ fit: 'kids', size: '8Y' }), row({ size: 'L' })] }, spec);
    expect(items.map((i) => i.fit)).toEqual(['kids', 'men']);
    expect(buildItems({ ...EMPTY_CHECKOUT, single: { size: 'M', quantity: 1 } }, spec)[0].fit).toBe('men');   // older drafts
    expect(validateItems([{ player_name: '', number: '', fit: 'women', size: '3XL', quantity: 1 }], 'single'))
      .toEqual([{ kind: 'row', index: 0, field: 'size' }]);
  });
  it('matches a server failure to rows by fit as well as size', () => {
    const items = [{ player_name: 'A', number: '1', fit: 'women' as const, size: 'S' as const, quantity: 1 },
      { player_name: 'A', number: '1', size: 'S' as const, quantity: 1 }];
    expect(rowsForFailure(items, { player_name: 'A', number: '1', size: 'S', fit: 'women' })).toEqual([0]);
    expect(rowsForFailure(items, { player_name: 'A', number: '1', size: 'S' })).toEqual([1]);
  });
});
