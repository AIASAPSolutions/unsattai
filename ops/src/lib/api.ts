/** HTTP client for the Unsattai API: bearer token for /ops, X-API-Key where configured. */
import { env } from './env';
import { ApiError, toApiError } from './errors';

const TOKEN_KEY = 'unsattai-ops-token';
let token: string | null = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { token = null; }

let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked: memory only */ }
}
export const getToken = () => token;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query, base = env.apiBase): string {
  const qs = query
    ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
    : '';
  return `${base}/api/v1${path}${qs ? `?${qs}` : ''}`;
}

interface Opts { query?: Query; body?: unknown; method?: string; strip?: string[]; raw?: boolean }

async function send(path: string, opts: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (env.apiKey) headers['X-API-Key'] = env.apiKey;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and the API address.');
  }
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const err = toApiError(res.status, body, opts.strip);
    // A 401 on anything but the login itself means the session is over.
    if (res.status === 401 && path.startsWith('/ops/') && !path.startsWith('/ops/auth/login') && !path.startsWith('/ops/me/password')) {
      onUnauthorized?.();
    }
    throw err;
  }
  return res;
}

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const res = await send(path, opts);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? await res.json() : await res.text()) as T;
}

export const get = <T = unknown>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T = unknown>(path: string, body: unknown = {}, query?: Query) => api<T>(path, { body, query, method: 'POST' });
export const put = <T = unknown>(path: string, body: unknown) => api<T>(path, { body, method: 'PUT' });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { body, method: 'PATCH' });

/** Fetch with auth and hand the result to the browser as a download. */
export async function download(path: string, filename: string, opts: Opts = {}) {
  const res = await send(path, opts);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Open an authenticated HTML page (invoice, label) in a new tab. The window is opened
 * synchronously (before awaiting) so pop-up blockers allow it. The server's HTML is shown
 * in a sandboxed frame (no scripts), with a Print button around it.
 */
export async function openHtml(path: string, title: string, opts: Opts = {}) {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font:14px system-ui;padding:24px">Loading…</p>');
  try {
    const res = await send(path, opts);
    const html = await res.text();
    const target = w ?? window.open('', '_blank');
    if (!target) throw new ApiError(0, 'The browser blocked the new tab. Allow pop-ups for this site.');
    target.document.open();
    target.document.write(printShell(title, html));
    target.document.close();
  } catch (e) {
    w?.close();
    throw e;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function printShell(title: string, html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>html,body{margin:0;height:100%;font:14px system-ui,sans-serif;background:#eef0f3}
.bar{display:flex;gap:8px;align-items:center;padding:8px 16px;background:#fff;border-bottom:1px solid #d8dce2}
.bar b{flex:1}button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #1f5fbf;background:#1f5fbf;color:#fff;cursor:pointer}
iframe{border:0;width:100%;height:calc(100% - 50px);background:#fff}@media print{.bar{display:none}iframe{height:100%}}</style></head>
<body><div class="bar"><b>${escapeHtml(title)}</b><button onclick="document.getElementById('doc').contentWindow.print()">Print</button></div>
<iframe id="doc" sandbox="allow-same-origin allow-modals" srcdoc="${escapeHtml(html)}"></iframe></body></html>`;
}
