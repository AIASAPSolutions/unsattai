import { Platform } from 'react-native';
import { getApiKey, getApiUrl, getDeviceId } from './config';
import { getSessionToken } from './session';

export type ApiErrorKind =
  | 'network'      // server unreachable / offline
  | 'timeout'
  | 'auth'         // 401: missing API key, not signed in, or a wrong code or password
  | 'forbidden'    // 403: account blocked or not allowed
  | 'locked'       // 423 (and 429 on sign-in): too many wrong tries for now
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

  /** The server's machine reason code, e.g. not_serviceable or cod_unavailable, when it sent one. */
  get code(): string | null {
    const c = (this.data as { code?: unknown } | null)?.code;
    return typeof c === 'string' ? c : null;
  }

  /** The request carried a session token and the server no longer accepts it. */
  sessionExpired = false;
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
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 423) return 'locked';
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
  /** Leave out the session token (sign-in calls). */
  anonymous?: boolean;
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Told when the server rejects the saved session token (expired or signed out elsewhere).
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onSessionExpired = fn;
}

/** The server names the session's device from this, e.g. "Unsattai app on Android". Browsers send their own. */
export function appUserAgent(os: string = Platform.OS): string | null {
  if (os === 'android') return 'Unsattai app on Android';
  if (os === 'ios') return 'Unsattai app on iPhone';
  return null;
}

export type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);

/** Tests swap the transport; the app always uses global fetch. */
export function setFetcher(f: Fetcher): void {
  fetcher = f;
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const base = getApiUrl();
  const key = await getApiKey();
  const token = opts.anonymous ? null : await getSessionToken();
  const headers: Record<string, string> = { Accept: opts.text ? 'image/svg+xml, text/plain, */*' : 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-API-Key'] = key;
  if (token) headers.Authorization = `Bearer ${token}`;
  const ua = appUserAgent();
  if (ua) headers['User-Agent'] = ua;
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
    throw new ApiError('network', `Can't reach the Unsattai server at ${base}.`);
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
    const err = parseErrorBody(res.status, body);
    // A 401 for a request that carried our session means the session is gone, not a wrong password.
    if (res.status === 401 && token && !/X-API-Key/i.test(err.message)) {
      err.sessionExpired = true;
      onSessionExpired?.();
    }
    throw err;
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
