import { setApiUrl } from '../api/config';
import { setFetcher } from '../api/client';
import { api } from '../api/endpoints';
import type { DesignSpec } from '../api/types';
import { addressIssues, buildItems, logoCount, orderPayload, payloadHash, quoteRequest, validateDraft } from '../features/order/buildOrder';
import { formatDay, formatMoney } from '../lib/money';
import { EMPTY_COMMERCE, mergePersisted, type Commerce, type OrderDraft } from '../state/flow';

const spec = { garment: 'jersey', typography: { team_name: 'Kings', player_name: 'ARUL', number: '7', font: 'block' }, elements: [] } as unknown as DesignSpec;
const draft = (over: Partial<OrderDraft> = {}): OrderDraft => ({
  mode: 'single', commerce: EMPTY_COMMERCE, single: { size: 'L', quantity: 2 }, rows: [],
  customer: { name: 'Arul', phone: '+91 98765 43210', email: '' }, idempotencyKey: null, keyFor: null, ...over,
});

describe('building the order', () => {
  it('a single order prints the design name and number', () => {
    expect(buildItems(draft(), spec)).toEqual([{ player_name: 'ARUL', number: '7', size: 'L', quantity: 2 }]);
    expect(validateDraft(draft(), spec)).toEqual([]);
  });

  it('a team order uses each roster row', () => {
    const d = draft({ mode: 'team', rows: [
      { key: 'a', player_name: 'Priya', number: '१०', size: 'S', quantity: 1 },
      { key: 'b', player_name: 'Kavya', number: '23', size: 'M', quantity: 3 },
    ] });
    expect(buildItems(d, spec).map((i) => i.number)).toEqual(['10', '23']);
  });

  it('flags an empty roster, bad rows and missing contact details', () => {
    const issues = validateDraft(draft({
      mode: 'team', rows: [{ key: 'a', player_name: 'X'.repeat(20), number: '1234', size: 'M', quantity: 0 }],
      customer: { name: '', phone: 'abc', email: 'bad' },
    }), spec);
    expect(issues).toEqual(expect.arrayContaining([
      { kind: 'row', index: 0, field: 'player_name' }, { kind: 'row', index: 0, field: 'number' },
      { kind: 'row', index: 0, field: 'quantity' }, { kind: 'customer', field: 'name' },
      { kind: 'customer', field: 'phone' }, { kind: 'customer', field: 'email' },
    ]));
    expect(validateDraft(draft({ mode: 'team' }), spec)).toContainEqual({ kind: 'emptyRoster' });
  });

  it('hashes the same order the same way', () => {
    const a = orderPayload('d1', spec, buildItems(draft(), spec), draft().customer, 'en');
    const b = orderPayload('d1', spec, buildItems(draft(), spec), { ...draft().customer, name: ' Arul ' }, 'en');
    expect(payloadHash(a)).toBe(payloadHash(b));
    expect(payloadHash(a)).not.toBe(payloadHash({ ...a, items: [{ ...a.items[0], quantity: 3 }] }));
  });
});

describe('idempotent retry', () => {
  it('retries a dropped order request with the same idempotency key', async () => {
    await setApiUrl('http://localhost:8000');
    const keys: string[] = [];
    let n = 0;
    setFetcher((async (_url: string, init: RequestInit) => {
      keys.push(JSON.parse(String(init.body)).idempotency_key);
      if (n++ === 0) throw new TypeError('Network request failed');
      return new Response(JSON.stringify({ id: 'ord_1', status: 'awaiting_payment' }), { status: 201 });
    }) as unknown as typeof fetch);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const p = api.createOrder({ ...orderPayload('d1', spec, buildItems(draft(), spec), draft().customer, 'en'), idempotency_key: 'ord_abc12345' });
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toMatchObject({ id: 'ord_1' });
    jest.useRealTimers();
    expect(keys).toEqual(['ord_abc12345', 'ord_abc12345']);
  });
});

describe('shop options', () => {
  const home: Commerce = {
    fabric: 'premium', method: 'ship', rush: true, coupon: ' welcome10 ',
    address: { line1: '12 Gandhi St', line2: '', city: 'Chennai', state: 'tn', pincode: '600 001' },
  };

  it('needs a full address only when shipping', () => {
    expect(addressIssues(home)).toEqual([]);
    expect(addressIssues({ ...home, address: { ...home.address, pincode: '6000', state: 'Tamil Nadu' } }))
      .toEqual([{ kind: 'address', field: 'state' }, { kind: 'address', field: 'pincode' }]);
    expect(addressIssues({ ...home, method: 'pickup', address: { line1: '', line2: '', city: '', state: '', pincode: '' } })).toEqual([]);
  });

  it('asks for a quote with the logos, lines and PIN code', () => {
    const withLogo = { ...spec, elements: [{ type: 'logo' }, { type: 'text' }] } as unknown as DesignSpec;
    expect(logoCount(withLogo)).toBe(1);
    const q = quoteRequest(withLogo, buildItems(draft(), spec), home);
    expect(q).toEqual({
      garment: 'jersey', fabric: 'premium', logos: 1, rush: true, coupon: 'welcome10',
      lines: [{ size: 'L', quantity: 2, player_name: 'ARUL', number: '7' }],
      delivery: { method: 'ship', pincode: '600001', state: 'TN' },
    });
  });

  it('sends the shop options with the order, and the old payload when the server has no shop', () => {
    const items = buildItems(draft(), spec);
    const withShop = orderPayload('d1', spec, items, draft().customer, 'en', home);
    expect(withShop).toMatchObject({
      fabric: 'premium', rush: true, coupon: 'welcome10', channel: 'app',
      delivery: { method: 'ship', address: { line1: '12 Gandhi St', city: 'Chennai', state: 'TN', pincode: '600001' } },
    });
    expect(orderPayload('d1', spec, items, draft().customer, 'en', { ...home, method: 'pickup' }).delivery).toEqual({ method: 'pickup' });
    const plain = orderPayload('d1', spec, items, draft().customer, 'en');
    expect(Object.keys(plain).sort()).toEqual(['customer', 'design_id', 'items', 'language', 'spec']);
  });

  it('fills shop options into a draft saved by an older version', () => {
    const old = { order: { mode: 'team', single: { size: 'S', quantity: 3 }, rows: [], customer: { name: '', phone: '', email: '' } } };
    const merged = mergePersisted(old, { order: draft() });
    expect(merged.order.mode).toBe('team');
    expect(merged.order.commerce).toEqual(EMPTY_COMMERCE);
  });

  it('formats rupees with Indian grouping', () => {
    expect(formatMoney(123456.5, 'INR')).toBe('₹1,23,456.50');
    expect(formatMoney(999, 'INR')).toBe('₹999');
    expect(formatMoney(-50, 'INR')).toBe('−₹50');
    expect(formatMoney(1234, 'AED')).toBe('AED 1,234');
    expect(formatDay('not a date')).toBe('not a date');
    expect(formatDay(null)).toBe('');
  });
});
