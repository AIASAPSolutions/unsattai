'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/endpoints';
import type { Catalogue, Health, Meta, SizeGuide } from '@/lib/api/types';

// Catalogue and design metadata change rarely: fetched once per page load and shared.

function cached<T>(load: () => Promise<T>) {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    peek: () => value,
    /** Seed with data the server already rendered with. */
    prime: (v: T) => {
      value ??= v;
    },
    get: () => {
      if (value) return Promise.resolve(value);
      pending ??= load().then((v) => (value = v)).finally(() => { pending = null; });
      return pending;
    },
  };
}

const meta = cached(() => api.meta());
const catalogue = cached(() => api.catalogue());
const sizeGuide = cached(() => api.sizeGuide());
const health = cached(() => api.health());

function useCached<T>(c: { peek: () => T | null; get: () => Promise<T> }) {
  const [state, setState] = useState<{ data: T | null; error: unknown }>({ data: c.peek(), error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (state.data) return;
    let live = true;
    c.get().then((data) => live && setState({ data, error: null })).catch((error) => live && setState({ data: null, error }));
    return () => {
      live = false;
    };
  }, [c, nonce, state.data]);
  return { ...state, retry: () => { setState({ data: null, error: null }); setNonce((n) => n + 1); } };
}

export function useMeta() {
  const r = useCached<Meta>(meta);
  return { meta: r.data, error: r.error, retry: r.retry };
}

export function useCatalogue() {
  const r = useCached<Catalogue>(catalogue);
  return { catalogue: r.data, error: r.error, retry: r.retry };
}

/** Use the size guide a server component already loaded, so it is not fetched again. */
export function primeSizeGuide(guide: SizeGuide | null | undefined) {
  // Browser only: on the server the module outlives the request and would keep old measurements.
  if (guide && typeof window !== 'undefined') sizeGuide.prime(guide);
}

/** The Men / Women / Kids size guide (GET /shop/size-guide), fetched once. */
export function useSizeGuide() {
  const r = useCached<SizeGuide>(sizeGuide);
  return { guide: r.data, error: r.error, retry: r.retry };
}

/**
 * Whether "Pay (demo)" is offered. Unknown (still loading, or an older server without the
 * flag) counts as on; a refused demo payment (403 demo_payments_off) is handled where it happens.
 */
export function useDemoPayments(): { demo: boolean; known: boolean } {
  const r = useCached<Health>(health);
  return { demo: r.data?.demo_payments !== false, known: !!r.data };
}
