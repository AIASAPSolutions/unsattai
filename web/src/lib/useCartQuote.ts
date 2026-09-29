'use client';
import { useEffect, useRef, useState } from 'react';
import { isAbort } from './api/client';
import { api } from './api/endpoints';
import type { CartQuote, CartQuoteRequest } from './api/types';

export interface CartQuoteState {
  quote: CartQuote | null;
  status: 'idle' | 'loading' | 'error';
  error: unknown;
  /** The delivery date with express production, when express is not selected (to compare). */
  expressBy: string | null;
}

/**
 * Live cart price from POST /shop/cart/quote. Debounced, superseded requests are aborted,
 * and the previous price stays on screen (marked as updating) until the new one arrives.
 */
export function useCartQuote(req: CartQuoteRequest | null, opts: { delay?: number; express?: boolean } = {}):
  CartQuoteState & { retry: () => void } {
  const { delay = 350, express = false } = opts;
  const [state, setState] = useState<CartQuoteState>({ quote: null, status: 'idle', error: null, expressBy: null });
  const [nonce, setNonce] = useState(0);
  const key = req ? JSON.stringify(req) : null;
  const seq = useRef(0);

  useEffect(() => {
    if (!key) return;
    const body = JSON.parse(key) as CartQuoteRequest;
    const id = ++seq.current;
    const controller = new AbortController();
    const start = setTimeout(() => setState((s) => ({ ...s, status: 'loading', error: null })), 0);
    const timer = setTimeout(async () => {
      try {
        const [quote, fast] = await Promise.all([
          api.cartQuote(body, controller.signal),
          express && !body.rush ? api.cartQuote({ ...body, rush: true, coupon: '' }, controller.signal).catch(() => null) : Promise.resolve(null),
        ]);
        if (id !== seq.current) return;
        setState({ quote, status: 'idle', error: null, expressBy: fast?.delivery_by ?? null });
      } catch (e) {
        if (isAbort(e) || id !== seq.current) return;
        setState((s) => ({ ...s, status: 'error', error: e }));
      }
    }, delay);
    return () => {
      clearTimeout(start);
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, delay, express, nonce]);

  return { ...state, quote: key ? state.quote : null, retry: () => setNonce((n) => n + 1) };
}
