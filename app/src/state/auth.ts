import { create } from 'zustand';
import { ApiError, setSessionExpiredHandler } from '../api/client';
import { api } from '../api/endpoints';
import { getSessionToken, setSessionToken } from '../api/session';
import type { Me, SignedIn } from '../api/types';
import { useCart } from './cart';
import { useWishlist } from './wishlist';

// Who is signed in. The token itself is only in secure storage (api/session);
// this store holds the profile the screens show and the unread notification count.

export type AuthStatus = 'unknown' | 'guest' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  customer: Me | null;
  /** The session ended on the server (expired, or signed out from another device). */
  expired: boolean;
  unread: number;
  /** Set just after a code sign-in so Security can offer "set a new password" (forgot-password flow). */
  codeSignInAt: number | null;
  restore: () => Promise<void>;
  completeSignIn: (res: SignedIn, via: 'code' | 'password') => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<Me | null>;
  setCustomer: (me: Me) => void;
  refreshUnread: () => Promise<void>;
  setUnread: (n: number) => void;
  dismissExpired: () => void;
}

function clearLocal(set: (p: Partial<AuthState>) => void, expired: boolean) {
  useCart.getState().signOut();
  useWishlist.getState().signOut();
  set({ status: 'guest', customer: null, unread: 0, expired, codeSignInAt: null });
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'unknown',
  customer: null,
  expired: false,
  unread: 0,
  codeSignInAt: null,

  restore: async () => {
    const token = await getSessionToken();
    if (!token) {
      set({ status: 'guest' });
      return;
    }
    try {
      const me = await api.me();
      set({ status: 'signedIn', customer: me, expired: false });
      useCart.getState().loadFromAccount().catch(() => undefined);
      useWishlist.setState({ remote: true });
      useWishlist.getState().load().catch(() => undefined);
      get().refreshUnread().catch(() => undefined);
    } catch (e) {
      if (e instanceof ApiError && (e.kind === 'auth' || e.kind === 'forbidden')) {
        await setSessionToken(null);
        clearLocal(set, e.kind === 'auth');
      } else {
        // Offline: stay signed in with what we know; screens show their own errors.
        set({ status: 'signedIn' });
      }
    }
  },

  completeSignIn: async (res, via) => {
    await setSessionToken(res.token);
    set({ status: 'signedIn', customer: res.customer, expired: false, codeSignInAt: via === 'code' ? Date.now() : null });
    await Promise.all([
      useCart.getState().mergeIntoAccount(),
      useWishlist.getState().mergeIntoAccount().catch(() => undefined),
      get().refreshUnread().catch(() => undefined),
    ]);
  },

  signOut: async () => {
    await api.logout().catch(() => undefined);
    await setSessionToken(null);
    clearLocal(set, false);
  },

  refresh: async () => {
    if (get().status !== 'signedIn') return null;
    const me = await api.me();
    set({ customer: me });
    return me;
  },

  setCustomer: (customer) => set({ customer }),

  refreshUnread: async () => {
    if (get().status !== 'signedIn') return;
    const page = await api.notifications(1, true);
    set({ unread: page.unread });
  },

  setUnread: (unread) => set({ unread }),
  dismissExpired: () => set({ expired: false }),
}));

// A request with our token came back 401: forget the session everywhere.
setSessionExpiredHandler(() => {
  if (useAuth.getState().status !== 'signedIn') return;
  setSessionToken(null).catch(() => undefined);
  clearLocal(useAuth.setState, true);
});

/** Code sign-in less than 15 minutes ago: the server lets the password be set without the old one. */
export function canResetPassword(codeSignInAt: number | null, now = Date.now()): boolean {
  return codeSignInAt !== null && now - codeSignInAt < 14 * 60_000;
}
