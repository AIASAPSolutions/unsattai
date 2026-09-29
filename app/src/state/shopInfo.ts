import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { Catalogue, Health, SizeGuide } from '../api/types';

// Server facts that change rarely: the size guide, option prices (catalogue) and
// whether demo payments are on. Loaded once per app run and shared; a failed load
// is retried the next time a screen asks.

function cachedLoader<V>(fetch: () => Promise<V>) {
  let value: V | null = null;
  let inflight: Promise<V> | null = null;
  const load = (): Promise<V> => {
    if (value) return Promise.resolve(value);
    inflight ??= fetch().then((v) => {
      value = v;
      return v;
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  };
  const use = (enabled = true): { value: V | null; error: unknown } => {
    const [state, setState] = useState<{ value: V | null; error: unknown }>({ value, error: null });
    useEffect(() => {
      if (!enabled || state.value) return;
      let live = true;
      load().then((v) => live && setState({ value: v, error: null })).catch((error) => live && setState({ value: null, error }));
      return () => {
        live = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);
    return state;
  };
  return { load, use, reset: () => { value = null; inflight = null; } };
}

const guide = cachedLoader<SizeGuide>(() => api.sizeGuide());
const catalogue = cachedLoader<Catalogue>(() => api.catalogue());
const health = cachedLoader<Health>(() => api.health());

export const loadSizeGuide = guide.load;
export const useSizeGuide = (enabled = true) => {
  const s = guide.use(enabled);
  return { guide: s.value, error: s.error };
};

export const loadCatalogue = catalogue.load;
export const useCatalogue = () => catalogue.use().value;

/** Tests only. */
export function resetShopInfo(): void {
  guide.reset();
  catalogue.reset();
  health.reset();
  demoOff = false;
}

// A 403 demo_payments_off answer switches the demo button off for the rest of the run.
let demoOff = false;

export function isDemoPaymentsOff(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'demo_payments_off';
}

export function noteDemoPaymentsOff(e: unknown): boolean {
  if (isDemoPaymentsOff(e)) demoOff = true;
  return demoOff;
}

/**
 * Whether the demo "Pay" button may be offered. Older servers don't say: then it is
 * offered, and a 403 demo_payments_off answer turns it off.
 */
export function useDemoPayments(): { enabled: boolean; known: boolean; markOff: (e: unknown) => boolean } {
  const h = health.use().value;
  const [off, setOff] = useState(demoOff);
  const enabled = !off && h?.demo_payments !== false;
  return {
    enabled,
    known: !!h,
    markOff: (e) => {
      const now = noteDemoPaymentsOff(e);
      if (now) setOff(true);
      return isDemoPaymentsOff(e);
    },
  };
}
