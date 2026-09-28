import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import type { Meta } from '../api/types';

// Server catalogue (palettes, colour names, sizes). Loaded once per app run and
// shared; screens keep working with built-in lists if it can't be reached.

let cached: Meta | null = null;
let inflight: Promise<Meta> | null = null;

export function loadMeta(): Promise<Meta> {
  if (cached) return Promise.resolve(cached);
  inflight ??= api.meta().then((m) => {
    cached = m;
    return m;
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

export function useMeta(): { meta: Meta | null; error: unknown; retry: () => void } {
  const [meta, setMeta] = useState<Meta | null>(cached);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (cached) return;
    let live = true;
    loadMeta().then((m) => live && setMeta(m)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [nonce]);
  return { meta, error, retry: () => { setError(null); setNonce((n) => n + 1); } };
}
