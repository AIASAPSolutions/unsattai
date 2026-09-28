// Browser-side API client. Every call goes to this site's own proxy (/api/uj/...),
// which adds the API key, the customer's session and the device id on the server.
// Error handling is ported from the mobile app (app/src/api/client.ts).

export type ApiErrorKind =
  | 'network' | 'timeout' | 'auth' | 'validation' | 'blocked' | 'conflict' | 'not_found'
  | 'too_large' | 'quota' | 'server' | 'http';

export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public status: number | null = null,
    public fields: FieldError[] = [],
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
}

function kindFor(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too_large';
  if (status === 422) return 'validation';
  if (status === 429) return 'quota';
  if (status >= 500) return 'server';
  return 'http';
}

export function parseErrorBody(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (Array.isArray(detail)) {
    const fields = detail.map((d: { loc?: (string | number)[]; msg?: string }) => ({
      path: (d.loc ?? []).filter((p) => p !== 'body').join('.'),
      message: String(d.msg ?? 'Invalid value').replace(/^Value error, /, ''),
    }));
    const first = fields[0];
    return new ApiError('validation', first ? `${first.path ? first.path + ': ' : ''}${first.message}` : 'Invalid request',
      status, fields, body);
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { message?: string; failures?: unknown };
    const kind: ApiErrorKind = d.failures ? 'blocked' : kindFor(status);
    return new ApiError(kind, d.message ?? `Request failed (${status})`, status, [], detail);
  }
  const message = typeof detail === 'string' ? detail : `Request failed (${status})`;
  return new ApiError(kindFor(status), message, status, [], body);
}

export interface RequestOptions {
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  text?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const PROXY_BASE = '/api/uj';

export function buildPath(path: string, query?: RequestOptions['query']): string {
  const clean = path.replace(/^\/+/, '');
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return `${PROXY_BASE}/${clean}${s ? `?${s}` : ''}`;
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: opts.text ? 'text/html, image/svg+xml, */*' : 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let res: Response;
  try {
    res = await fetch(buildPath(path, opts.query), {
      method, headers, credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (controller.signal.aborted) throw new ApiError('timeout', 'The server took too long to answer.');
    throw new ApiError('network', 'Can\'t reach UrJersey right now.');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  const raw = await res.text();
  if (!res.ok) {
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* plain text */
    }
    if (res.status === 502 && typeof (body as { detail?: unknown })?.detail === 'string') {
      throw new ApiError('network', String((body as { detail: string }).detail), 502);
    }
    throw parseErrorBody(res.status, body);
  }
  if (opts.text) return raw as unknown as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError('server', 'The server sent a response we could not read.', res.status);
  }
}

/** Retry a request that is safe to repeat (idempotent) on network, timeout and 5xx errors. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 600): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof ApiError) || !e.retryable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw last;
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}
