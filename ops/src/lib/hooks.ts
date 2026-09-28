import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loadable<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T | undefined | ((cur: T | undefined) => T | undefined)) => void;
}

/** Load data for a screen; reloads when deps change; ignores stale responses. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { poll?: number } = {}): Loadable<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  // eslint-style exhaustive deps are intentional: callers pass what should trigger a reload.
  useEffect(() => { void reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!opts.poll) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, reload]);

  return { data, error, loading, reload, setData };
}

/** Debounced value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Run an action with a busy flag; errors go to onError. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, onError?: (e: unknown) => void): Promise<T | undefined> => {
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      onError?.(e);
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, run };
}
