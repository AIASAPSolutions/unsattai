'use client';
import { useEffect, useRef, useState } from 'react';
import { isAbort } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Estimate, Quote, QuoteRequest } from '@/lib/api/types';
import { quoteKey } from '@/lib/price';

export interface QuoteState {
  quote: Quote | null;
  /** Request the shown quote was made for (it can lag behind while updating). */
  forKey: string | null;
  status: 'idle' | 'loading' | 'error';
  error: unknown;
  /** Express date when express is not selected, so both dates can be shown side by side. */
  expressEstimate: Estimate | null;
}

/**
 * Live price from POST /shop/quote. Debounced, superseded requests are aborted, and the
 * previous price stays on screen (marked as updating) until the new one arrives.
 */
export function useQuote(req: QuoteRequest | null, delay = 400): QuoteState & { retry: () => void } {
  const [state, setState] = useState<QuoteState>({ quote: null, forKey: null, status: 'idle', error: null, expressEstimate: null });
  const [nonce, setNonce] = useState(0);
  const key = req ? quoteKey(req) : null;
  const reqRef = useRef(req);
  const seq = useRef(0);

  useEffect(() => {
    reqRef.current = req;
  });

  useEffect(() => {
    const body = reqRef.current;
    if (!key || !body) return;
    const id = ++seq.current;
    const controller = new AbortController();
    const start = setTimeout(() => {
      setState((s) => ({ ...s, status: 'loading', error: null }));
    }, 0);
    const timer = setTimeout(async () => {
      try {
        const pieces = body.lines.reduce((n, l) => n + l.quantity, 0);
        const [quote, express] = await Promise.all([
          api.quote(body, controller.signal),
          // With express off, ask what express would give so both dates can be compared.
          !body.rush && pieces > 0
            ? api.deliveryEstimate(Math.min(pieces, 5000), body.delivery.method === 'ship' ? body.delivery.pincode : '', true,
              controller.signal).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (id !== seq.current) return;
        setState({ quote, forKey: key, status: 'idle', error: null, expressEstimate: express });
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
  }, [key, delay, nonce]);

  return { ...state, retry: () => setNonce((n) => n + 1) };
}
