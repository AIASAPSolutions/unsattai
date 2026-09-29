'use client';
import { api } from './api/endpoints';
import type { Me } from './api/types';
import { addToCart, fromApiItems, mergeCarts, toApiItem, type AddResult, type CartEntry, type NewEntry } from './cart';
import type { CheckoutDraft } from './checkout';
import { EMPTY_ADDRESS } from './flow';
import { newIdempotencyKey } from './ids';
import { NO_PINCODE, parseSaved, type PincodeChoice } from './pincode';
import { createStore, local, useHydrated, useStore, whenHydrated } from './store';

// Shopping state: the cart (on the device for guests, on the server when signed in),
// a "Buy now" item that skips the cart, the checkout draft, the wishlist and the
// "Deliver to" PIN code.

export interface BuyNow {
  entry: CartEntry;
  /** A team list being ordered (placed as a single order that closes the list). */
  collection: { id: string; title: string } | null;
}

export interface ShopState {
  guest: CartEntry[];
  /** The signed-in customer's server cart; null until loaded (or when signed out). */
  server: CartEntry[] | null;
  customerId: string | null;
  syncError: boolean;
  buyNow: BuyNow | null;
  checkout: CheckoutDraft;
  wishlist: string[] | null;
  pin: PincodeChoice;
  pinLoaded: boolean;
}

export const EMPTY_DRAFT: CheckoutDraft = {
  method: 'ship', address: EMPTY_ADDRESS, addressIndex: -1, saveAddress: true, customer: { name: '', phone: '', email: '' },
  coupon: '', rush: false, payment: 'online', idempotencyKey: null, keyFor: null,
};

export const shopStore = createStore<ShopState>({
  guest: [], server: null, customerId: null, syncError: false, buyNow: null, checkout: EMPTY_DRAFT, wishlist: null,
  pin: NO_PINCODE, pinLoaded: false,
}, {
  key: 'shop.v1',
  pick: (s) => ({ guest: s.guest, buyNow: s.buyNow, checkout: s.checkout }),
});

const get = shopStore.get;
const set = shopStore.set;

const NO_ITEMS: CartEntry[] = [];
// Must return the same array for the same state (useSyncExternalStore compares snapshots).
export const cartItems = (s: ShopState): CartEntry[] => (s.customerId ? s.server ?? NO_ITEMS : s.guest);

export function useShop<T>(select: (s: ShopState) => T): T {
  return useStore(shopStore, select);
}

export function useCart() {
  const hydrated = useHydrated(shopStore);
  const items = useShop(cartItems);
  const signedIn = useShop((s) => !!s.customerId);
  const loaded = useShop((s) => !s.customerId || s.server !== null);
  const syncError = useShop((s) => s.syncError);
  return { items, ready: hydrated && loaded, signedIn, syncError };
}

// ----------------------------------------------------------------- server sync

let putTimer: ReturnType<typeof setTimeout> | null = null;
let putSeq = 0;

function schedulePut() {
  if (putTimer) clearTimeout(putTimer);
  putTimer = setTimeout(() => {
    putTimer = null;
    const s = get();
    if (!s.customerId || !s.server) return;
    const id = ++putSeq;
    const who = s.customerId;
    api.putCart(s.server.map(toApiItem))
      .then((res) => {
        if (id !== putSeq || get().customerId !== who) return;
        set({ server: fromApiItems(res.items, get().server ?? []), syncError: false });
      })
      .catch(() => {
        if (id === putSeq) set({ syncError: true });
      });
  }, 400);
}

function setItems(items: CartEntry[]) {
  if (get().customerId) {
    set({ server: items });
    schedulePut();
  } else {
    set({ guest: items });
  }
}

export const cart = {
  add: (entry: NewEntry): AddResult => {
    const r = addToCart(cartItems(get()), entry);
    if (r.outcome === 'added' || r.outcome === 'combined') setItems(r.items);
    return r;
  },
  update: (key: string, patch: Partial<NewEntry> | ((e: CartEntry) => CartEntry)) =>
    setItems(cartItems(get()).map((e) => (e.key === key ? (typeof patch === 'function' ? patch(e) : { ...e, ...patch }) : e))),
  remove: (key: string) => setItems(cartItems(get()).filter((e) => e.key !== key)),
  /** After an order: take the ordered items out of the cart. */
  removeMany: (keys: string[]) => setItems(cartItems(get()).filter((e) => !keys.includes(e.key))),
  retrySync: () => schedulePut(),

  /** Right after sign-in: move the device cart into the account (POST /me/cart/merge). */
  signedIn: async (me: Pick<Me, 'id'>) => {
    await whenHydrated(shopStore);
    if (get().customerId === me.id && get().server) return;
    const device = get().guest;
    set({ customerId: me.id, server: null, syncError: false, wishlist: null });
    try {
      const res = device.length ? await api.mergeCart(device.map(toApiItem)) : await api.myCart();
      if (get().customerId !== me.id) return;
      set({ server: fromApiItems(res.items, device), guest: [] });
    } catch {
      if (get().customerId !== me.id) return;
      // Keep the device items visible; they are saved to the account with the next change.
      set({ server: mergeCarts([], device).items, syncError: true });
    }
    api.wishlist().then((w) => get().customerId === me.id && set({ wishlist: w.product_ids })).catch(() => set({ wishlist: [] }));
  },

  signedOut: () => {
    if (putTimer) clearTimeout(putTimer);
    set({ customerId: null, server: null, syncError: false, wishlist: null });
  },
};

// ----------------------------------------------------------------- buy now and checkout draft

export const checkoutDraft = {
  set: (patch: Partial<CheckoutDraft> | ((c: CheckoutDraft) => Partial<CheckoutDraft>)) => {
    const cur = get().checkout;
    set({ checkout: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } });
  },
  /** Same payload -> same key (safe retry); a changed checkout -> a new key. */
  keyFor: (hash: string) => {
    const c = get().checkout;
    if (c.idempotencyKey && c.keyFor === hash) return c.idempotencyKey;
    const key = newIdempotencyKey();
    set({ checkout: { ...c, idempotencyKey: key, keyFor: hash } });
    return key;
  },
  /** After a successful checkout: keep contact and address, forget the coupon and the key. */
  placed: () => set({ checkout: { ...get().checkout, coupon: '', rush: false, idempotencyKey: null, keyFor: null } }),
};

export const buyNow = {
  start: (entry: NewEntry, collection: BuyNow['collection'] = null) =>
    set({ buyNow: { entry: { ...entry, key: 'buy-now' }, collection } }),
  update: (patch: Partial<NewEntry>) => {
    const b = get().buyNow;
    if (b) set({ buyNow: { ...b, entry: { ...b.entry, ...patch } } });
  },
  clear: () => set({ buyNow: null }),
};

// ----------------------------------------------------------------- wishlist

export const wishlist = {
  toggle: async (productId: string) => {
    const cur = get().wishlist ?? [];
    const on = cur.includes(productId);
    set({ wishlist: on ? cur.filter((x) => x !== productId) : [productId, ...cur] });
    try {
      const w = on ? await api.wishlistRemove(productId) : await api.wishlistAdd(productId);
      set({ wishlist: w.product_ids });
      return !on;
    } catch (e) {
      set({ wishlist: cur });
      throw e;
    }
  },
  set: (ids: string[]) => set({ wishlist: ids }),
};

// ----------------------------------------------------------------- "Deliver to" PIN code

export const pin = {
  load: () => {
    if (get().pinLoaded) return;
    set({ pin: parseSaved(local.get<unknown>('pincode', null)), pinLoaded: true });
  },
  choose: (pincode: string) => {
    const choice: PincodeChoice = { pincode, source: 'user' };
    local.set('pincode', choice);
    set({ pin: choice, pinLoaded: true });
  },
};
