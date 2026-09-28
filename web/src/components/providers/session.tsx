'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api/client';
import { api, signOut as apiSignOut } from '@/lib/api/endpoints';
import type { Me } from '@/lib/api/types';

interface Session {
  me: Me | null;
  /** True until the first /me answer (or failure). */
  loading: boolean;
  refresh: () => Promise<Me | null>;
  setMe: (me: Me | null) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

/** Who is signed in. The session token itself lives in an httpOnly cookie; this only knows the profile. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api.me();
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'auth') setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api.me()
      .then((m) => live && setMe(m))
      .catch(() => live && setMe(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, loading, refresh, setMe, signOut }), [me, loading, refresh, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
