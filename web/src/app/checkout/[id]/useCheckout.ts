'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/endpoints';
import type { Checkout, Order } from '@/lib/api/types';

export function useCheckout(id: string) {
  const [state, setState] = useState<{ data: Checkout | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    api.getCheckout(id)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [id, nonce]);
  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setNonce((n) => n + 1);
  }, []);
  return { ...state, retry };
}

/** A checkout's orders grouped by the seller that makes and ships them. */
export function ordersBySeller(orders: Order[]): { seller: string; orders: Order[] }[] {
  const out: { seller: string; orders: Order[] }[] = [];
  for (const o of orders) {
    const name = o.seller?.name || '';
    const g = out.find((x) => x.seller === name);
    if (g) g.orders.push(o);
    else out.push({ seller: name, orders: [o] });
  }
  return out;
}

export function orderTitle(o: Order): string {
  return o.spec?.typography?.team_name || o.spec?.style_name || o.number || o.id;
}
