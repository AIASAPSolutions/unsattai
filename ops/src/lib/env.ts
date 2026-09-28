/** Build-time configuration (see .env.example). */
function clean(url: string | undefined, fallback: string): string {
  return (url && url.trim() ? url.trim() : fallback).replace(/\/+$/, '');
}

export const env = {
  apiBase: clean(import.meta.env.VITE_API_BASE_URL, 'http://127.0.0.1:8000'),
  apiKey: (import.meta.env.VITE_API_KEY ?? '').trim(),
  webStore: clean(import.meta.env.VITE_WEB_STORE_URL, 'http://127.0.0.1:3000'),
};

/** Customer link for a quote: the web store serves /quote/{token}. */
export function quoteLink(path: string, base = env.webStore): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
