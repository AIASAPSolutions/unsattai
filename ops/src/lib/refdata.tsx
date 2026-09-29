/** Reference data most screens need: settings (stages, carriers, CRM lists, currency) and staff names. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get } from './api';
import { useAuth } from './auth';
import { actorName } from './format';
import type { Company, CrmConfig, Delivery, PriceBook, Production } from './settingsForm';
import type { Sizing } from './sizingForm';
import type { Seller, Staff, Versioned } from './types';

export interface AllSettings {
  price_book: Versioned<PriceBook>; production: Versioned<Production>; delivery: Versioned<Delivery>;
  company: Versioned<Company>; crm: Versioned<CrmConfig>;
  /** Size charts (servers from before fits have none). */
  sizing?: Versioned<Sizing>;
}

interface Ref {
  settings: AllSettings | null;
  staff: Staff[];
  currency: string;
  reload: () => Promise<void>;
  who: (actor: string | null | undefined) => string;
  staffName: (id: string | null | undefined) => string;
  /** Sellers for filters and names (a seller login gets only its own). */
  sellers: Seller[];
  sellerName: (id: string | null | undefined) => string;
  reloadSellers: () => Promise<void>;
}

const Ctx = createContext<Ref | null>(null);

export function RefDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const { isSeller } = useAuth();
  const reloadSellers = useCallback(async () => {
    const r = await get<{ items: Seller[] }>('/ops/sellers').catch(() => ({ items: [] as Seller[] }));
    setSellers(r.items);
  }, []);
  const reload = useCallback(async () => {
    // A seller login may not read settings or the staff list (403); it works without them.
    if (isSeller) { await reloadSellers(); return; }
    const [s, st] = await Promise.all([
      get<AllSettings>('/ops/settings').catch(() => null),
      get<{ items: Staff[] }>('/ops/staff').catch(() => ({ items: [] as Staff[] })),
      reloadSellers(),
    ]);
    if (s) setSettings(s);
    setStaff(st.items);
  }, [isSeller, reloadSellers]);
  useEffect(() => { void reload(); }, [reload]);
  const value = useMemo<Ref>(() => ({
    settings, staff, reload, sellers, reloadSellers,
    sellerName: (id) => (id ? sellers.find((x) => x.id === id)?.name ?? id : '—'),
    currency: settings?.price_book.value.currency ?? 'INR',
    who: (a) => actorName(a, staff),
    staffName: (id) => {
      if (!id) return 'Unassigned';
      const bare = id.startsWith('staff:') ? id.slice(6) : id;
      const s = staff.find((x) => x.id === bare);
      return s ? s.name || s.email : bare;
    },
  }), [settings, staff, reload, sellers, reloadSellers]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useRefDataImpl(): Ref {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRefData outside RefDataProvider');
  return v;
}
export const useRefData = useRefDataImpl;
