import { describe, expect, it } from 'vitest';
import type { CartQuote, DesignSpec } from './api/types';
import { addToCart, designEntry, productEntry, type CartEntry } from './cart';
import { ApiError } from './api/client';
import {
  cartQuoteRequest, checkoutHash, checkoutIssues, checkoutItemErrors, checkoutPayload, codBlock, groupBySeller, isDemoPaymentsOff, onlineMode,
} from './checkout';
import { EMPTY_ADDRESS } from './flow';

const spec = { garment: 'jersey' } as unknown as DesignSpec;
const line = { size: 'M' as const, quantity: 2, player_name: '', number: '' };
let items: CartEntry[] = [];
items = addToCart(items, productEntry('prd_1', 'standard', [line], 'sel_fast')).items;
items = addToCart(items, designEntry(spec, 'des_1', 'premium', [{ ...line, player_name: 'Arul', number: '7' }])).items;

const draft = {
  method: 'ship' as const,
  address: { ...EMPTY_ADDRESS, line1: ' 12 Anna Salai ', city: 'Chennai ', state: 'TN', pincode: '600002' },
  customer: { name: ' Asha ', phone: '98765 43210', email: '' },
  coupon: ' welcome10 ', rush: false, payment: 'cod' as const,
};

describe('checkout payload', () => {
  it('sends every cart item, the trimmed address (with the customer as recipient) and the payment method', () => {
    const p = checkoutPayload({ items, draft, language: 'ta' });
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ product_id: 'prd_1', seller_id: 'sel_fast' });
    expect(p.items[0]).not.toHaveProperty('key');
    expect(p.items[1]).toMatchObject({ spec, design_id: 'des_1', fabric: 'premium' });
    expect(p.customer).toEqual({ name: 'Asha', phone: '98765 43210', email: '' });
    expect(p.delivery.address).toMatchObject({ name: 'Asha', phone: '98765 43210', line1: '12 Anna Salai', city: 'Chennai', pincode: '600002' });
    expect(p).toMatchObject({ coupon: 'WELCOME10', payment_method: 'cod', channel: 'web', language: 'ta', rush: false });
    expect(p).not.toHaveProperty('idempotency_key');
  });
  it('sends no address for pickup and hashes stably', () => {
    const p = checkoutPayload({ items, draft: { ...draft, method: 'pickup' }, language: 'en' });
    expect(p.delivery).toEqual({ method: 'pickup', address: null });
    expect(checkoutHash(p)).toBe(checkoutHash(checkoutPayload({ items, draft: { ...draft, method: 'pickup' }, language: 'en' })));
    expect(checkoutHash(p)).not.toBe(checkoutHash(checkoutPayload({ items, draft: { ...draft, method: 'pickup', payment: 'online' }, language: 'en' })));
  });
  it('quotes with the address PIN code, else the chip PIN code', () => {
    expect(cartQuoteRequest(items, draft, '560001')!.delivery).toEqual({ method: 'ship', pincode: '600002', state: 'TN' });
    expect(cartQuoteRequest(items, { ...draft, address: EMPTY_ADDRESS }, '560001')!.delivery).toEqual({ method: 'ship', pincode: '560001', state: '' });
    expect(cartQuoteRequest([], draft)).toBeNull();
  });
  it('validates the address and contact details', () => {
    expect(checkoutIssues(draft)).toEqual([]);
    expect(checkoutIssues({ ...draft, address: EMPTY_ADDRESS, customer: { name: '', phone: 'x', email: 'bad' } }).map((i) => i.kind))
      .toEqual(['address', 'address', 'address', 'address', 'customer', 'customer', 'customer']);
    expect(checkoutIssues({ ...draft, method: 'pickup', address: EMPTY_ADDRESS })).toEqual([]);
  });
});

describe('seller groups and errors', () => {
  const q = (index: number, seller: string, date: string, shipping: number) => ({
    index, product_id: null, title: `T${index}`, garment: 'jersey', seller: { id: seller, name: seller.toUpperCase() },
    quote: { shipping: { amount: shipping, free: false, method: 'ship' } }, coupon_share: 0, delivery_date: date, problems: [],
  });
  const three = [...items, items[0]];
  const quote = { items: [q(0, 'a', '2026-10-04', 92), q(1, 'b', '2026-10-06', 60), q(2, 'a', '2026-10-05', 0)] } as unknown as CartQuote;
  it('groups by seller with one delivery charge and the latest date', () => {
    const g = groupBySeller(three, quote);
    expect(g.map((x) => [x.sellerId, x.items.map((i) => i.index), x.deliveryDate, x.shipping])).toEqual([
      ['a', [0, 2], '2026-10-05', 92], ['b', [1], '2026-10-06', 60],
    ]);
  });
  it('reads per-item checkout errors', () => {
    expect(checkoutItemErrors({ message: 'x', items: [{ index: 1, code: 'print_check_failed', message: 'm', failures: [] }, 'junk'] }))
      .toEqual([{ index: 1, code: 'print_check_failed', message: 'm', failures: [] }]);
    expect(checkoutItemErrors('nope')).toEqual([]);
  });
  it('explains why cash on delivery is off', () => {
    const base = { cod_available: false, totals: { total: 25000 } } as CartQuote;
    expect(codBlock(base, { enabled: false, max_order_value: 20000 })).toBe('disabled');
    expect(codBlock(base, { enabled: true, max_order_value: 20000 })).toBe('limit');
    expect(codBlock({ ...base, totals: { ...base.totals, total: 100 } }, { enabled: true, max_order_value: 20000 })).toBe('area');
    expect(codBlock({ ...base, cod_available: true }, { enabled: true, max_order_value: 20000 })).toBeNull();
  });
});

describe('payment availability', () => {
  it('uses demo payments when they are on, else cash on delivery, else pay later', () => {
    expect(onlineMode(true, null)).toBe('demo');
    expect(onlineMode(false, null)).toBe('off');
    expect(onlineMode(false, 'area')).toBe('later');
    expect(onlineMode(false, 'disabled')).toBe('later');
  });
  it('recognises a refused demo payment', () => {
    expect(isDemoPaymentsOff(new ApiError('auth', 'Online payment is not available yet.', 403, [], { code: 'demo_payments_off' }))).toBe(true);
    expect(isDemoPaymentsOff(new ApiError('auth', 'Sign in', 403, [], { code: 'other' }))).toBe(false);
    expect(isDemoPaymentsOff(new Error('x'))).toBe(false);
  });
});
