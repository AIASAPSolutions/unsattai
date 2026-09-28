'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/endpoints';
import type { Catalogue, Meta } from '@/lib/api/types';

// Catalogue and design metadata change rarely: fetched once per page load and shared.

function cached<T>(load: () => Promise<T>) {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    peek: () => value,
    get: () => {
      if (value) return Promise.resolve(value);
      pending ??= load().then((v) => (value = v)).finally(() => { pending = null; });
      return pending;
    },
  };
}

const meta = cached(() => api.meta());
const catalogue = cached(() => api.catalogue());

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
