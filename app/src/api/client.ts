import { getApiKey, getApiUrl, getDeviceId } from './config';

export type ApiErrorKind =
  | 'network'      // server unreachable / offline
  | 'timeout'
  | 'auth'         // 401
  | 'validation'   // 422 with field errors
  | 'blocked'      // 422 with manufacturing failures (orders)
  | 'conflict'     // 409
  | 'not_found'
  | 'too_large'    // 413
  | 'quota'        // 429: free AI edits used up, or too many too fast
  | 'server'       // 5xx
  | 'http';        // anything else

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

  /** Worth retrying with the same request (and the same idempotency key). */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'server';
  }
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

export interface RequestOptions {
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Return the raw text body (SVG downloads). */
  text?: boolean;
}

export type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);

/** Tests swap the transport; the app always uses global fetch. */
export function setFetcher(f: Fetcher): void {
  fetcher = f;
}

export async function request<T>(method: 'GET' | 'POST', path: string, opts: RequestOptions = {}): Promise<T> {
  const base = getApiUrl();
  const key = await getApiKey();
  const headers: Record<string, string> = { Accept: opts.text ? 'image/svg+xml, text/plain, */*' : 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-API-Key'] = key;
  headers['X-Device-Id'] = await getDeviceId();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetcher(`${base}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (controller.signal.aborted) throw new ApiError('timeout', `The server at ${base} took too long to answer.`);
    throw new ApiError('network', `Can't reach the UrJersey server at ${base}.`);
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
      /* plain text error */
    }
    throw parseErrorBody(res.status, body);
  }
  if (opts.text) return raw as unknown as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError('server', 'The server sent a response the app could not read.', res.status);
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
