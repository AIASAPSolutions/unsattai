import 'server-only';
import { apiBase } from '../proxy';

/** Server components and route handlers call the API directly (never through the browser). */
export async function serverApi<T>(path: string, init: RequestInit & { revalidate?: number } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (process.env.UJ_API_KEY) headers.set('X-API-Key', process.env.UJ_API_KEY);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const { revalidate, ...rest } = init;
  const res = await fetch(`${apiBase()}/api/v1/${path.replace(/^\//, '')}`, {
    ...rest,
    headers,
    ...(revalidate !== undefined ? { next: { revalidate } } : { cache: 'no-store' as const }),
  });
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}`);
  return (await res.json()) as T;
}
