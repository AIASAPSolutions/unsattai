'use client';
import type { ReactNode } from 'react';
import { Loading } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { flowStore } from '@/lib/flow';
import { useHydrated } from '@/lib/store';

/** Waits until the saved draft has been read from IndexedDB before showing flow pages. */
export function Hydrated({ children }: { children: ReactNode }) {
  const t = useT();
  const ok = useHydrated(flowStore);
  return ok ? <>{children}</> : <Loading label={t('loading')} />;
}
