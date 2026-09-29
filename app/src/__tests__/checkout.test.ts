import { ApiError, parseErrorBody } from '../api/client';
import type { CartItem } from '../api/types';
import type { CartLine } from '../features/cart/cart';
import {
  cartQuoteRequest, checkoutHash, checkoutIssues, checkoutPayload, checkoutProblems, type CheckoutDraft,
} from '../features/checkout/checkout';
import { useCart } from '../state/cart';

const item = (id: string): CartItem => ({ product_id: id, fabric: 'poly_dryfit', lines: [{ player_name: '', number: '', size: 'M', quantity: 2 }] });
const lines: CartLine[] = [
  { key: 'a', item: item('p1'), title: 'Kings home' },
  { key: 'b', item: { spec: { garment: 'jersey' } as never, fabric: 'cotton', lines: [{ player_name: 'Priya', number: '10', size: 'S', quantity: 1 }] }, title: 'Team' },
];
const draft = (over: Partial<CheckoutDraft> = {}): CheckoutDraft => ({
  method: 'ship',
  address: { line1: ' 12 Beach Road ', line2: '', city: 'Chennai', state: 'tn', pincode: '600 028' },
  customer: { name: ' Priya ', phone: ' 9876543210 ', email: 'priya@example.com ' },
  coupon: ' welcome10 ', rush: false, payment: 'cod', ...over,
});

describe('checkout request', () => {
  it('sends every cart item with a cleaned address, the channel and the language', () => {
    const p = checkoutPayload(lines, draft(), 'ta');
    // Lines saved without a fit are sent as men's.
    const men = (i: CartItem) => ({ ...i, lines: i.lines.map((l) => ({ ...l, fit: 'men' })) });
    expect(p.items).toEqual([men(lines[0].item), men(lines[1].item)]);
    expect(p.customer).toEqual({ name: 'Priya', phone: '9876543210', email: 'priya@example.com' });
    expect(p.delivery).toEqual({
      method: 'ship',
      address: { name: 'Priya', phone: '9876543210', line1: '12 Beach Road', line2: '', city: 'Chennai', state: 'TN', pincode: '600028' },
    });
    expect(p).toMatchObject({ coupon: 'WELCOME10', rush: false, payment_method: 'cod', channel: 'app', language: 'ta' });
    expect(p).not.toHaveProperty('idempotency_key');
  });

  it('keeps the receiver on a saved address and sends no address for pickup', () => {
    const p = checkoutPayload(lines, draft({ address: { ...draft().address, name: 'Arul', phone: '9000000000' } }), 'en');
    expect(p.delivery).toMatchObject({ address: { name: 'Arul', phone: '9000000000' } });
    expect(checkoutPayload(lines, draft({ method: 'pickup' }), 'en').delivery).toEqual({ method: 'pickup' });
  });

  it('quotes with the PIN code only once it is complete', () => {
    expect(cartQuoteRequest(lines, draft()).delivery).toEqual({ method: 'ship', pincode: '600028', state: 'TN' });
    expect(cartQuoteRequest(lines, draft({ address: { ...draft().address, pincode: '6000' } })).delivery.pincode).toBe('');
    expect(cartQuoteRequest(lines, draft()).payment_method).toBe('cod');
  });

  it('flags missing details before sending', () => {
    const d = draft({ address: { line1: '', line2: '', city: '', state: 'Tamil Nadu', pincode: '99' }, customer: { name: '', phone: '12', email: 'x' } });
    const fields = checkoutIssues(d).map((i) => `${i.kind}.${'field' in i ? i.field : ''}`);
    expect(fields).toEqual(expect.arrayContaining(['address.line1', 'address.city', 'address.state', 'address.pincode', 'customer.name', 'customer.phone', 'customer.email']));
    expect(checkoutIssues(draft())).toEqual([]);
  });

  it('reuses one idempotency key for the same checkout and makes a new one when it changes', () => {
    useCart.getState().signOut();
    const h1 = checkoutHash(checkoutPayload(lines, draft(), 'en'));
    const h2 = checkoutHash(checkoutPayload(lines, draft({ payment: 'online' }), 'en'));
    expect(h1).not.toBe(h2);
    const k1 = useCart.getState().keyFor(h1);
    expect(k1).toMatch(/^app-ck-/);
    expect(useCart.getState().keyFor(h1)).toBe(k1);
    expect(useCart.getState().keyFor(h2)).not.toBe(k1);
  });

  it('reads per-item reasons from a 422 answer', () => {
    const e = parseErrorBody(422, { detail: { message: 'Nothing was ordered', items: [{ index: 1, code: 'not_serviceable', message: 'No seller', failures: [] }] } });
    expect(checkoutProblems(e)).toEqual([{ index: 1, code: 'not_serviceable', message: 'No seller', failures: [] }]);
    expect(checkoutProblems(new ApiError('network', 'x'))).toEqual([]);
    expect(checkoutProblems(new Error('x'))).toEqual([]);
  });
});
