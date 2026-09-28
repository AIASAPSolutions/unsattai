'use client';
import { useCallback, useEffect, useState } from 'react';
import { StatusChip } from '@/components/ui';
import { useT } from '@/i18n/provider';
import type { FulfilmentStatus, Order } from '@/lib/api/types';

export const FSTATUS_TONE: Record<FulfilmentStatus, 'neutral' | 'info' | 'warn' | 'pass' | 'fail'> = {
  awaiting_payment: 'warn', queued: 'info', in_production: 'info', ready: 'info', dispatched: 'info', delivered: 'pass', cancelled: 'fail',
};

export function FulfilmentChip({ status, hold, testId }: { status: FulfilmentStatus; hold?: boolean; testId?: string }) {
  const t = useT();
  return (
    <StatusChip tone={hold ? 'warn' : FSTATUS_TONE[status] ?? 'neutral'} testId={testId}>
      {t(`fstatus_${status}` as 'fstatus_queued')}
    </StatusChip>
  );
}

/** Orders placed before the shop existed have no fulfilment block: derive one from the payment. */
export function fulfilmentStatus(o: Pick<Order, 'fulfilment' | 'payment' | 'status'>): FulfilmentStatus {
  return o.fulfilment?.status ?? (o.payment ? 'queued' : 'awaiting_payment');
}

export function orderLabel(o: Pick<Order, 'number' | 'id'>): string {
  return o.number || o.id;
}

/** Load one order (public view or the signed-in customer's view) with retry. */
export function useOrder(id: string, load: (id: string) => Promise<Order>) {
  const [state, setState] = useState<{ order: Order | null; error: unknown; loading: boolean }>({ order: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    load(id)
      .then((order) => live && setState({ order, error: null, loading: false }))
      .catch((error) => live && setState({ order: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [id, load, nonce]);
  const retry = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    setNonce((n) => n + 1);
  }, []);
  const replace = useCallback((order: Order) => setState({ order, error: null, loading: false }), []);
  return { ...state, retry, replace };
}

export function invoiceUrl(orderId: string): string {
  return `/api/uj/orders/${encodeURIComponent(orderId)}/invoice`;
}
