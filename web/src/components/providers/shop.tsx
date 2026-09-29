'use client';
import { useEffect, useRef, useState } from 'react';
import { isAbort } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Garment, Product, Serviceability } from '@/lib/api/types';
import { PINCODE_RE, resolvePincode, type PincodeChoice } from '@/lib/pincode';
import { cart, pin, useShop } from '@/lib/shopStore';
import { useSession } from './session';

/** Keeps the cart and wishlist in step with who is signed in (merging the device cart on sign-in). */
export function ShopSync() {
  const { me, loading } = useSession();
  const id = me?.id ?? null;
  const last = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    pin.load();
  }, []);
  useEffect(() => {
    if (loading || last.current === id) return;
    const prev = last.current;
    last.current = id;
    if (id) void cart.signedIn({ id });
    else if (prev !== undefined) cart.signedOut();
  }, [id, loading]);
  return null;
}

/** The "Deliver to" PIN code: this device's choice, else the signed-in customer's default address. */
export function usePincode(): PincodeChoice & { ready: boolean } {
  const { me, loading } = useSession();
  const saved = useShop((s) => s.pin);
  const loaded = useShop((s) => s.pinLoaded);
  return { ...resolvePincode(saved, me), ready: loaded && !loading };
}

// ----------------------------------------------------------------- serviceability (cached per page load)

const cache = new Map<string, { at: number; value: Promise<Serviceability> }>();
const TTL = 5 * 60_000;

export function serviceabilityKey(q: ServiceQuery): string {
  return [q.pincode, q.garment ?? 'jersey', q.fabric ?? '', q.pieces ?? 1, q.rush ? 1 : 0].join('|');
}

export interface ServiceQuery {
  pincode: string;
  garment?: Garment;
  fabric?: string;
  pieces?: number;
  rush?: boolean;
}

export function loadServiceability(q: ServiceQuery): Promise<Serviceability> {
  const key = serviceabilityKey(q);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = api.serviceability({ pincode: q.pincode, garment: q.garment, fabric: q.fabric || undefined, pieces: q.pieces, rush: q.rush || undefined });
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

export function useServiceability(q: ServiceQuery | null) {
  const key = q && PINCODE_RE.test(q.pincode) ? serviceabilityKey(q) : null;
  const [state, setState] = useState<{ key: string | null; data: Serviceability | null; error: unknown }>({ key: null, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const qRef = useRef(q);
  useEffect(() => {
    qRef.current = q;
  });
  useEffect(() => {
    if (!key || !qRef.current) return;
    let live = true;
    loadServiceability(qRef.current)
      .then((data) => live && setState({ key, data, error: null }))
      .catch((error) => live && !isAbort(error) && setState({ key, data: null, error }));
    return () => {
      live = false;
    };
  }, [key, nonce]);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !!key && !current,
    retry: () => { cache.clear(); setNonce((n) => n + 1); },
  };
}

// ----------------------------------------------------------------- product index (titles and pictures for cart rows)

let index: Promise<Map<string, Product>> | null = null;

export function productIndex(): Promise<Map<string, Product>> {
  index ??= api.products({ size: 60 })
    .then((r) => new Map(r.items.map((p) => [p.id, p])))
    .catch((e) => {
      index = null;
      throw e;
    });
  return index;
}

export function rememberProduct(p: Product) {
  void productIndex().then((m) => m.set(p.id, p)).catch(() => undefined);
}

export function useProductIndex() {
  const [map, setMap] = useState<Map<string, Product> | null>(null);
  useEffect(() => {
    let live = true;
    productIndex().then((m) => live && setMap(m)).catch(() => live && setMap(new Map()));
    return () => {
      live = false;
    };
  }, []);
  return map;
}

/** Product pictures come from the API through our proxy. */
export function productImage(p: Pick<Product, 'slug'>): string {
  return `/api/uj/shop/products/${encodeURIComponent(p.slug)}/mockup.svg`;
}
