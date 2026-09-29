/** GET /meta and GET /health, loaded once per session and shared by every screen that needs them. */
import { get } from './api';
import { useLoad } from './hooks';
import { FIT_SIZES, FITS, type Fit, type Size } from './types';

export interface Meta {
  sports?: string[];
  options?: { sleeves: string[]; collars: string[]; fits: string[] };
  fit_sizes?: Record<string, string[]>;
  [k: string]: unknown;
}
export interface Health {
  status: string; version?: string; factory_connected?: boolean;
  /** "Pay (demo)" marks orders paid without taking money. Should be off on a live server. */
  demo_payments?: boolean;
  [k: string]: unknown;
}

let metaP: Promise<Meta> | null = null;
export function loadMeta(): Promise<Meta> {
  if (!metaP) {
    metaP = get<Meta>('/meta');
    metaP.catch(() => { metaP = null; });
  }
  return metaP;
}

let healthP: Promise<Health> | null = null;
export function loadHealth(fresh = false): Promise<Health> {
  if (!healthP || fresh) {
    healthP = get<Health>('/health');
    healthP.catch(() => { healthP = null; });
  }
  return healthP;
}

/** The size list per fit from meta, falling back to the built-in lists (same as the server's). Pure: unit tested. */
export function fitSizesFrom(meta: Meta | null | undefined): Record<Fit, readonly Size[]> {
  const out = { ...FIT_SIZES };
  for (const f of FITS) {
    const got = meta?.fit_sizes?.[f];
    if (Array.isArray(got) && got.length) out[f] = got as Size[];
  }
  return out;
}

export function useMeta() {
  return useLoad(() => loadMeta().catch(() => null), []);
}

export function useFitSizes(): Record<Fit, readonly Size[]> {
  return fitSizesFrom(useMeta().data);
}

export function useHealth() {
  return useLoad(() => loadHealth().catch(() => null), []);
}

/** A build pointed at anything but this machine is treated as live (production). */
export function isLiveApi(apiBase: string): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(apiBase.replace(/\/+$/, ''));
}
