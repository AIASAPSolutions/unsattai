import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/endpoints';
import type { PaymentMethod } from '../api/types';
import {
  addLine, fromServerItems, mergeLines, setLineQuantity, toServerItems, type CartLine,
} from '../features/cart/cart';
import { newId, newIdempotencyKey } from '../lib/ids';
import { draftStorage } from './storage';

// The cart. Guests keep it on the device; signed in, the server keeps it and this
// store mirrors it (every change is saved with PUT /me/cart). Custom designs can
// carry logo images, so it is stored like the design draft (a file on native).

export type SyncState = 'local' | 'saving' | 'saved' | 'error';

interface CartState {
  lines: CartLine[];
  /** Checkout options that survive leaving the checkout screen. */
  coupon: string;
  rush: boolean;
  payment: PaymentMethod;
  /** One key per checkout attempt; reused for retries of the same content. */
  checkoutKey: string | null;
  checkoutKeyFor: string | null;
  /** Saved on the server (signed in) or device only (guest). */
  remote: boolean;
  sync: SyncState;
  syncError: unknown;

  add: (line: Omit<CartLine, 'key'>) => { outcome: 'added' | 'merged' | 'full'; key: string | null };
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  replace: (key: string, line: Omit<CartLine, 'key'>) => void;
  removeMany: (keys: string[]) => void;
  setOptions: (patch: Partial<Pick<CartState, 'coupon' | 'rush' | 'payment'>>) => void;
  keyFor: (hash: string) => string;
  /** After sign-in: send the device cart to the account and show the combined cart. */
  mergeIntoAccount: () => Promise<void>;
  /** Signed in on start: the server's cart is the truth. */
  loadFromAccount: () => Promise<void>;
  /** Signing out: the account's cart stays on the server, not on this device. */
  signOut: () => void;
  save: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DELAY = 400;

export const useCart = create<CartState>()(
  persist(
    (set, get) => {
      const changed = (lines: CartLine[]) => {
        set({ lines });
        if (!get().remote) return;
        set({ sync: 'saving' });
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          get().save().catch(() => undefined);
        }, SAVE_DELAY);
      };

      return {
        lines: [],
        coupon: '',
        rush: false,
        payment: 'online',
        checkoutKey: null,
        checkoutKeyFor: null,
        remote: false,
        sync: 'local',
        syncError: null,

        add: (line) => {
          const res = addLine(get().lines, { ...line, key: newId('ci') });
          if (res.outcome !== 'full') changed(res.lines);
          return { outcome: res.outcome, key: res.key };
        },
        remove: (key) => changed(get().lines.filter((l) => l.key !== key)),
        removeMany: (keys) => changed(get().lines.filter((l) => !keys.includes(l.key))),
        setQuantity: (key, quantity) => changed(get().lines.map((l) => (l.key === key ? setLineQuantity(l, quantity) : l))),
        replace: (key, line) => changed(get().lines.map((l) => (l.key === key ? { ...line, key } : l))),
        setOptions: (patch) => set(patch),

        keyFor: (hash) => {
          const s = get();
          if (s.checkoutKey && s.checkoutKeyFor === hash) return s.checkoutKey;
          const key = newIdempotencyKey().replace(/^ord_/, 'app-ck-');
          set({ checkoutKey: key, checkoutKeyFor: hash });
          return key;
        },

        save: async () => {
          if (!get().remote) return;
          set({ sync: 'saving', syncError: null });
          try {
            const res = await api.putCart(toServerItems(get().lines));
            set({ lines: fromServerItems(res.items, get().lines, () => newId('ci')), sync: 'saved' });
          } catch (e) {
            set({ sync: 'error', syncError: e });
            throw e;
          }
        },

        mergeIntoAccount: async () => {
          const device = get().lines;
          set({ remote: true, sync: 'saving', syncError: null });
          try {
            const res = await api.mergeCart(toServerItems(device));
            set({ lines: fromServerItems(res.items, device, () => newId('ci')), sync: 'saved' });
          } catch (e) {
            // Keep what is on the device; the next change tries to save it again.
            set({ sync: 'error', syncError: e });
          }
        },

        loadFromAccount: async () => {
          set({ remote: true, sync: 'saving', syncError: null });
          try {
            const res = await api.getCart();
            // Anything added on this device while offline is kept too.
            const saved = fromServerItems(res.items, get().lines, () => newId('ci'));
            const merged = mergeLines(saved, get().lines);
            set({ lines: merged, sync: 'saved' });
            if (merged.length !== saved.length) await get().save();
          } catch (e) {
            set({ sync: 'error', syncError: e });
          }
        },

        signOut: () => {
          if (saveTimer) clearTimeout(saveTimer);
          saveTimer = null;
          set({ lines: [], remote: false, sync: 'local', syncError: null, checkoutKey: null, checkoutKeyFor: null, coupon: '' });
        },
      };
    },
    {
      name: 'unsattai.cart',
      storage: draftStorage,
      version: 1,
      partialize: (s) => ({
        lines: s.lines, coupon: s.coupon, rush: s.rush, payment: s.payment, checkoutKey: s.checkoutKey, checkoutKeyFor: s.checkoutKeyFor,
      }),
    },
  ),
);

export const cartCount = (s: { lines: CartLine[] }) => s.lines.length;
