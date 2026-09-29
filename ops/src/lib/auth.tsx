import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get, getToken, post, setToken, setUnauthorizedHandler } from './api';
import { can as canP, canEditSection, isSellerLogin, type Permission, type SettingsSection } from './permissions';
import type { Me, Staff } from './types';

interface AuthState {
  me: Me | null;
  ready: boolean;
  /** Set when the session ended on its own (401), shown on the login screen. */
  notice: string | null;
  /** True after an explicit sign-out (as opposed to an expired session or a deep link). */
  signedOut: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  canEdit: (s: SettingsSection) => boolean;
  staff: Staff | null;
  /** A partner seller's own login: sees only that seller's work. */
  isSeller: boolean;
  /** The seller a seller login belongs to. */
  sellerId: string | null;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
      setNotice('Your session ended. Please sign in again.');
    });
    if (!getToken()) { setReady(true); return; }
    get<Me>('/ops/me').then(setMe).catch(() => setToken(null)).finally(() => setReady(true));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<{ token: string; staff: Staff; permissions: string[] }>('/ops/auth/login', { email, password });
    setToken(r.token);
    const full = await get<Me>('/ops/me');
    setNotice(null);
    setSignedOut(false);
    setMe(full);
  }, []);

  const logout = useCallback(async () => {
    try { await post('/ops/auth/logout'); } catch { /* signing out locally is enough */ }
    setToken(null);
    // No "return to" page after signing out: the next person starts at the dashboard.
    setSignedOut(true);
    setMe(null);
  }, []);

  const value = useMemo<AuthState>(() => ({
    me, ready, notice, signedOut, login, logout, staff: me?.staff ?? null,
    isSeller: isSellerLogin(me?.permissions),
    sellerId: isSellerLogin(me?.permissions) ? me?.staff.seller_id ?? null : null,
    can: (p) => canP(me?.permissions, p),
    canEdit: (s) => canEditSection(me?.permissions, s),
  }), [me, ready, notice, signedOut, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
