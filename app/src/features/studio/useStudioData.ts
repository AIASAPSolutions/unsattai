import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { api } from '../../api/endpoints';
import type { Check, DesignSpec, PanelsResponse, Size, TextElement } from '../../api/types';

export type RefreshStatus = 'idle' | 'loading' | 'error';

export interface StudioData {
  /** Panel art without customer layers: the editor draws those itself so they can move under a finger. */
  panels: PanelsResponse | null;
  checks: Check[] | null;
  /** From the server for exactly `checkedSpec`; null until the first answer arrives. */
  ready: boolean | null;
  checkedSpec: DesignSpec | null;
  defaults: TextElement[] | null;
  status: RefreshStatus;
  error: unknown;
}

/**
 * Keeps panel art and manufacturing checks in step with the spec. Requests are
 * debounced and superseded (only the newest answer is applied), and a failed
 * refresh never touches the spec: the last good art stays on screen with an
 * offline/error notice, and `ready` is cleared so ordering waits for a fresh check.
 */
export function useStudioData(spec: DesignSpec | null, sizes: Size[], delay = 350): StudioData & { retry: () => void } {
  const [data, setData] = useState<StudioData>({
    panels: null, checks: null, ready: null, checkedSpec: null, defaults: null, status: 'idle', error: null,
  });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  const sizeKey = sizes.join(',');
  useEffect(() => {
    if (!spec) return;
    const id = ++seq.current;
    const controller = new AbortController();
    setData((d) => ({ ...d, status: 'loading', ready: d.checkedSpec === spec ? d.ready : null }));
    const timer = setTimeout(async () => {
      try {
        const res = await api.panels(spec, false, sizes, controller.signal);
        if (id !== seq.current) return;
        setData({
          panels: res, checks: res.checks, ready: res.manufacturing_ready, checkedSpec: spec,
          defaults: res.default_elements, status: 'idle', error: null,
        });
      } catch (e) {
        if (controller.signal.aborted || id !== seq.current) return;
        setData((d) => ({ ...d, status: 'error', error: e, ready: null }));
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, sizeKey, nonce, delay]);

  return { ...data, retry: () => setNonce((n) => n + 1) };
}

export function isOffline(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout');
}

/** Full print art (with layers) for the 3D view, fetched only while it is visible. */
export function usePrintPanels(spec: DesignSpec | null, enabled: boolean, delay = 500) {
  const [state, setState] = useState<{ panels: PanelsResponse | null; error: unknown }>({ panels: null, error: null });
  useEffect(() => {
    if (!spec || !enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.panels(spec, true, [], controller.signal)
        .then((panels) => setState({ panels, error: null }))
        .catch((error) => {
          if (!controller.signal.aborted) setState((s) => ({ ...s, error }));
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [spec, enabled, delay]);
  return state;
}
