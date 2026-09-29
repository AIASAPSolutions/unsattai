import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/endpoints';
import type { Product } from '../api/types';
import { safeStorage } from './storage';

// Saved products. A guest's list stays on the device and is added to the account
// on sign-in; signed in, the server's list is used.

interface WishlistState {
  ids: string[];
  products: Record<string, Product>;
  remote: boolean;
  loading: boolean;
  error: unknown;
  has: (id: string) => boolean;
  toggle: (p: Product) => Promise<boolean>;
  load: () => Promise<void>;
  mergeIntoAccount: () => Promise<void>;
  signOut: () => void;
}

export const useWishlist = create<WishlistState>()(
  persist(
    (set, get) => {
      const fromServer = (w: { product_ids: string[]; items: Product[] }) => {
        const products: Record<string, Product> = {};
        for (const p of w.items) products[p.id] = p;
        // Products unpublished since they were saved are left out, as the server does.
        set({ ids: w.product_ids.filter((id) => products[id]), products, error: null });
      };
      return {
        ids: [],
        products: {},
        remote: false,
        loading: false,
        error: null,
        has: (id) => get().ids.includes(id),

        toggle: async (p) => {
          const on = !get().has(p.id);
          const before = { ids: get().ids, products: get().products };
          // Show the change at once; undo it if the server says no.
          set({ ids: on ? [p.id, ...get().ids] : get().ids.filter((x) => x !== p.id), products: { ...get().products, [p.id]: p } });
          if (!get().remote) return on;
          try {
            fromServer(on ? await api.addToWishlist(p.id) : await api.removeFromWishlist(p.id));
          } catch (e) {
            set({ ...before, error: e });
            throw e;
          }
          return on;
        },

        load: async () => {
          if (!get().remote) return;
          set({ loading: true });
          try {
            fromServer(await api.wishlist());
          } catch (e) {
            set({ error: e });
          } finally {
            set({ loading: false });
          }
        },

        mergeIntoAccount: async () => {
          const local = [...get().ids].reverse();
          set({ remote: true });
          for (const id of local) {
            await api.addToWishlist(id).catch(() => undefined);
          }
          await get().load();
        },

        signOut: () => set({ ids: [], products: {}, remote: false, error: null }),
      };
    },
    { name: 'urjersey.wishlist', storage: safeStorage, version: 1, partialize: (s) => (s.remote ? {} : { ids: s.ids, products: s.products }) },
  ),
);
