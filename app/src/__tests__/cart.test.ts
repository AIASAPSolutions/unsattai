import { setApiUrl } from '../api/config';
import { setFetcher } from '../api/client';
import type { CartItem, CartQuote } from '../api/types';
import {
  addLine, fromServerItems, groupBySeller, itemSignature, linesSummary, MAX_CART_ITEMS, mergeLines, sameItem, setLineQuantity, type CartLine,
} from '../features/cart/cart';
import { useCart } from '../state/cart';

const product = (id: string, size = 'M', quantity = 1, extra: Partial<CartItem> = {}): CartItem => ({
  product_id: id, fabric: 'poly_dryfit', lines: [{ player_name: '', number: '', size: size as never, quantity }], ...extra,
});
const team = (): CartItem => ({
  spec: { garment: 'jersey', style_name: 'A' } as never, garment: 'jersey', fabric: 'poly_dryfit', logos: 0,
  lines: [{ player_name: 'Priya', number: '10', size: 'S', quantity: 1 }, { player_name: 'Arul', number: '7', size: 'XL', quantity: 2 }],
});
const line = (key: string, item: CartItem, title = key): CartLine => ({ key, item, title });

describe('cart rules', () => {
  it('compares items the way the server does, ignoring key order and empty fields', () => {
    const a = product('p1', 'M', 1, { seller_id: '' });
    const b = { lines: a.lines, fabric: a.fabric, product_id: 'p1' } as CartItem;
    expect(itemSignature(a)).toBe(itemSignature(b));
    expect(sameItem(a, product('p1', 'L'))).toBe(false);
  });

  it('adds a product again as more pieces, and a team design as a new item', () => {
    let r = addLine([], line('a', product('p1', 'M', 1)));
    expect(r.outcome).toBe('added');
    r = addLine(r.lines, line('b', product('p1', 'M', 2)));
    expect(r).toMatchObject({ outcome: 'merged', key: 'a' });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].item.lines[0].quantity).toBe(3);
    r = addLine(r.lines, line('c', product('p1', 'L', 1)));
    r = addLine(r.lines, line('d', team()));
    r = addLine(r.lines, line('e', team()));
    expect(r.lines.map((l) => l.key)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('stops at 20 items but still merges into an existing product', () => {
    const full = Array.from({ length: MAX_CART_ITEMS }, (_, i) => line(`k${i}`, product(`p${i}`)));
    expect(addLine(full, line('x', product('new'))).outcome).toBe('full');
    expect(addLine(full, line('x', product('p3'))).outcome).toBe('merged');
  });

  it('keeps quantities between 1 and 500 and leaves rosters alone', () => {
    const l = line('a', product('p1'));
    expect(setLineQuantity(l, 0).item.lines[0].quantity).toBe(1);
    expect(setLineQuantity(l, 9999).item.lines[0].quantity).toBe(500);
    const t = line('t', team());
    expect(setLineQuantity(t, 5)).toBe(t);
  });

  it('merges the device cart after the saved one, skipping duplicates, up to 20', () => {
    const saved = [line('s1', product('p1')), line('s2', team())];
    const device = [line('d1', product('p1')), line('d2', product('p2')), line('d3', team())];
    expect(mergeLines(saved, device).map((l) => l.key)).toEqual(['s1', 's2', 'd2']);
    const many = Array.from({ length: 19 }, (_, i) => line(`s${i}`, product(`q${i}`)));
    expect(mergeLines(many, device)).toHaveLength(20);
  });

  it('keeps titles and keys for items the server sends back', () => {
    const known = [line('k1', product('p1'), 'Chennai Kings home')];
    let n = 0;
    const out = fromServerItems([product('p2'), product('p1')], known, () => `new${++n}`);
    expect(out.map((l) => [l.key, l.title])).toEqual([['new1', ''], ['k1', 'Chennai Kings home']]);
  });

  it('groups quoted items by seller with the latest date', () => {
    const q = {
      items: [
        { index: 0, seller: { id: 'sel_house', name: 'UrJersey' }, delivery_date: '2026-10-05' },
        { index: 1, seller: { id: 'sel_fast', name: 'Fast Prints' }, delivery_date: '2026-10-03' },
        { index: 2, seller: { id: 'sel_house', name: 'UrJersey' }, delivery_date: '2026-10-07' },
      ],
    } as unknown as CartQuote;
    expect(groupBySeller(q)).toEqual([
      { seller: { id: 'sel_house', name: 'UrJersey' }, deliveryDate: '2026-10-07', indexes: [0, 2] },
      { seller: { id: 'sel_fast', name: 'Fast Prints' }, deliveryDate: '2026-10-03', indexes: [1] },
    ]);
  });

  it('summarises roster lines', () => {
    expect(linesSummary(team().lines)).toBe('Priya 10 · S × 1, Arul 7 · XL × 2');
    expect(linesSummary(product('p', 'M', 2).lines)).toBe('M × 2');
  });
});

describe('cart store', () => {
  let calls: { method: string; url: string; body: unknown }[] = [];
  function server(handler: (method: string, url: string, body: { items?: CartItem[] }) => unknown) {
    calls = [];
    setFetcher((async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method: String(init.method), url, body });
      return new Response(JSON.stringify(handler(String(init.method), url, body)), { status: 200 });
    }) as unknown as typeof fetch);
  }

  beforeEach(async () => {
    await setApiUrl('http://localhost:8000');
    useCart.getState().signOut();
  });

  it('keeps a guest cart on the device without calling the server', () => {
    server(() => ({}));
    const s = useCart.getState();
    expect(s.add({ item: product('p1'), title: 'Kit' }).outcome).toBe('added');
    expect(s.add({ item: product('p1'), title: 'Kit' }).outcome).toBe('merged');
    s.add({ item: team(), title: 'Team' });
    expect(useCart.getState().lines).toHaveLength(2);
    expect(useCart.getState().remote).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('merges the device cart into the account on sign-in and shows the combined cart', async () => {
    useCart.getState().add({ item: product('p1'), title: 'Device kit' });
    server((_m, _u, body) => ({ items: [product('saved'), ...(body.items ?? [])], max_items: 20 }));
    await useCart.getState().mergeIntoAccount();
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://localhost:8000/api/v1/me/cart/merge' });
    expect((calls[0].body as { items: CartItem[] }).items[0].product_id).toBe('p1');
    const s = useCart.getState();
    expect(s.remote).toBe(true);
    expect(s.sync).toBe('saved');
    expect(s.lines.map((l) => [l.item.product_id, l.title])).toEqual([['saved', ''], ['p1', 'Device kit']]);
  });

  it('keeps the device cart when the merge fails', async () => {
    useCart.getState().add({ item: product('p1'), title: 'Kit' });
    setFetcher((async () => new Response('{"detail":"down"}', { status: 503 })) as unknown as typeof fetch);
    await useCart.getState().mergeIntoAccount();
    expect(useCart.getState().sync).toBe('error');
    expect(useCart.getState().lines).toHaveLength(1);
  });

  it('saves changes to the account with PUT once signed in', async () => {
    jest.useFakeTimers();
    try {
      server((_m, _u, body) => ({ items: body?.items ?? [], max_items: 20 }));
      await useCart.getState().mergeIntoAccount();
      calls = [];
      useCart.getState().add({ item: product('p9'), title: 'New' });
      expect(useCart.getState().sync).toBe('saving');
      jest.advanceTimersByTime(500);
      await Promise.resolve();
      jest.useRealTimers();
      await new Promise((r) => setTimeout(r, 10));
      expect(calls[0]).toMatchObject({ method: 'PUT', url: 'http://localhost:8000/api/v1/me/cart' });
      expect(useCart.getState().sync).toBe('saved');
    } finally {
      jest.useRealTimers();
    }
  });

  it('empties the cart on sign-out', async () => {
    server((_m, _u, body) => ({ items: body?.items ?? [], max_items: 20 }));
    useCart.getState().add({ item: product('p1'), title: 'Kit' });
    await useCart.getState().mergeIntoAccount();
    useCart.getState().signOut();
    expect(useCart.getState()).toMatchObject({ lines: [], remote: false, sync: 'local' });
  });
});
