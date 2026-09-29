import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/endpoints';
import type { Serviceability } from '../../api/types';
import { useAuth } from '../../state/auth';
import { effectivePincode, useLocation } from '../../state/location';
import { isPincode } from './pincode';

// Delivery answers are the same for everyone for a while, so they are shared
// between screens for five minutes.

const TTL = 5 * 60_000;
const cache = new Map<string, { at: number; data: Serviceability }>();

export interface ServiceQuery {
  garment?: string;
  fabric?: string;
  pieces?: number;
  rush?: boolean;
}

export async function checkServiceability(pincode: string, q: ServiceQuery = {}, signal?: AbortSignal): Promise<Serviceability> {
  const query = { pincode, garment: q.garment ?? 'jersey', fabric: q.fabric || undefined, pieces: q.pieces ?? 1, rush: q.rush || undefined };
  const key = JSON.stringify(query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await api.serviceability(query, signal);
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function useServiceability(pincode: string | null, q: ServiceQuery = {}) {
  const [data, setData] = useState<Serviceability | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify([pincode, q.garment, q.fabric, q.pieces, q.rush]);

  useEffect(() => {
    if (!pincode || !isPincode(pincode)) {
      setData(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      checkServiceability(pincode, q, controller.signal)
        .then((d) => !controller.signal.aborted && setData(d))
        .catch((e) => !controller.signal.aborted && setError(e))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, retry };
}

/** The PIN code the shop checks: the one picked on this device, else the default saved address. */
export function useDeliveryPincode(): string | null {
  const devicePin = useLocation((s) => s.pincode);
  const addresses = useAuth((s) => s.customer?.addresses);
  return effectivePincode(devicePin, addresses);
}
