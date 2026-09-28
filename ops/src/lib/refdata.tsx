/** Reference data most screens need: settings (stages, carriers, CRM lists, currency) and staff names. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get } from './api';
import { actorName } from './format';
import type { Company, CrmConfig, Delivery, PriceBook, Production } from './settingsForm';
import type { Staff, Versioned } from './types';

export interface AllSettings {
  price_book: Versioned<PriceBook>; production: Versioned<Production>; delivery: Versioned<Delivery>;
  company: Versioned<Company>; crm: Versioned<CrmConfig>;
}

interface Ref {
  settings: AllSettings | null;
  staff: Staff[];
  currency: string;
  reload: () => Promise<void>;
  who: (actor: string | null | undefined) => string;
  staffName: (id: string | null | undefined) => string;
}

const Ctx = createContext<Ref | null>(null);

export function RefDataProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const reload = useCallback(async () => {
    const [s, st] = await Promise.all([
      get<AllSettings>('/ops/settings').catch(() => null),
      get<{ items: Staff[] }>('/ops/staff').catch(() => ({ items: [] as Staff[] })),
    ]);
    if (s) setSettings(s);
    setStaff(st.items);
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const value = useMemo<Ref>(() => ({
    settings, staff, reload,
    currency: settings?.price_book.value.currency ?? 'INR',
    who: (a) => actorName(a, staff),
    staffName: (id) => {
      if (!id) return 'Unassigned';
      const bare = id.startsWith('staff:') ? id.slice(6) : id;
      const s = staff.find((x) => x.id === bare);
      return s ? s.name || s.email : bare;
    },
  }), [settings, staff, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useRefDataImpl(): Ref {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRefData outside RefDataProvider');
  return v;
}
export const useRefData = useRefDataImpl;
