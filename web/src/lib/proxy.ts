// Pure helpers for the server-side API proxy (src/app/api/uj/[...path]/route.ts).
// Kept free of Next.js imports so they can be unit tested.

export const SESSION_COOKIE = 'uj_session';
export const DEVICE_COOKIE = 'uj_device';
export const LANG_COOKIE = 'uj_lang';

const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SEGMENT_RE = /^[A-Za-z0-9._~@:=,+-]+$/;

const ID = '[A-Za-z0-9._~@:=,+-]+';

/**
 * Paths the browser may reach: an explicit allow-list of customer routes. Everything
 * else is refused, including staff tools (ops, stats, dataset export, factory queue),
 * print files and factory uploads. Sign-in (OTP verify and password login) and sign-out
 * are only reachable through our own /api/session routes, so the session token never
 * reaches browser JavaScript.
 */
export const ALLOWED: RegExp[] = [
  /^(meta|health)$/,
  /^brief\/understand$/,
  /^designs\/(generate|refine|from-image)$/,
  new RegExp(`^designs\\/${ID}(\\/(feedback|mockup\\.svg))?$`),
  /^render(\/panels)?$/,
  /^ai\/allowance$/,
  /^logos\/(suggest|remove-background)$/,
  /^orders$/,
  new RegExp(`^orders\\/${ID}(\\/(payment-confirmed|invoice|track))?$`),
  /^shop\/(catalogue|quote|delivery-estimate|enquiries|serviceability|offers|products|size-guide|cart\/quote)$/,
  new RegExp(`^shop\\/sellers\\/${ID}$`),
  new RegExp(`^shop\\/products\\/${ID}(\\/(reviews|mockup\\.svg))?$`),
  /^checkout$/,
  new RegExp(`^checkouts\\/${ID}(\\/pay)?$`),
  /^auth\/otp\/request$/,
  /^me(\/[A-Za-z0-9._~@:=,+-]+)*$/,
  new RegExp(`^collections(\\/${ID}(\\/entries(\\/${ID})?)?)?$`),
  new RegExp(`^quotes\\/${ID}(\\/accept)?$`),
];

/** Never proxied, even if an allow-list entry would match (defence in depth). */
const BLOCKED = [/^ops(\/|$)/, /^stats$/, /^dataset(\/|$)/, /^factory(\/|$)/, /^auth\/(otp\/verify|login|logout)$/, /^print$/,
  /\/print\.svg$/, /^orders\/[^/]+\/files(\/|$)/];

export function upstreamPath(segments: string[]): string | null {
  if (!segments.length) return null;
  for (const s of segments) {
    if (!s || s === '.' || s === '..' || !SEGMENT_RE.test(s)) return null;
  }
  const path = segments.join('/');
  if (BLOCKED.some((re) => re.test(path))) return null;
  if (!ALLOWED.some((re) => re.test(path))) return null;
  return path;
}

export function upstreamUrl(base: string, segments: string[], search: string): string | null {
  const path = upstreamPath(segments);
  if (!path) return null;
  return `${base.replace(/\/+$/, '')}/api/v1/${path}${search && search !== '?' ? (search.startsWith('?') ? search : `?${search}`) : ''}`;
}

export interface ProxyInput {
  /** Incoming request headers (lower-case names). */
  headers: Record<string, string | undefined>;
  cookies: Record<string, string | undefined>;
  apiKey?: string;
}

/**
 * Headers sent to the API. Only a small allow-list is forwarded: the browser's own
 * cookies, host and any X-API-Key it tries to send are dropped. The channel key comes
 * from the server environment, the customer's bearer token from the httpOnly session
 * cookie (or an explicit Authorization header), and the device id from its cookie.
 */
export function upstreamHeaders({ headers, cookies, apiKey }: ProxyInput): Record<string, string> {
  const out: Record<string, string> = {};
  const accept = headers['accept'];
  if (accept) out['Accept'] = accept;
  const ct = headers['content-type'];
  if (ct) out['Content-Type'] = ct;
  const lang = headers['accept-language'];
  if (lang) out['Accept-Language'] = lang;
  // The API names signed-in devices from the User-Agent ("Chrome on Android").
  const ua = headers['user-agent'];
  if (ua) out['User-Agent'] = ua.slice(0, 300);
  if (apiKey) out['X-API-Key'] = apiKey;

  const auth = headers['authorization'];
  const session = cookies[SESSION_COOKIE];
  if (auth && /^bearer\s+\S+/i.test(auth)) out['Authorization'] = auth;
  else if (session) out['Authorization'] = `Bearer ${session}`;

  const device = headers['x-device-id'] || cookies[DEVICE_COOKIE];
  if (device && DEVICE_RE.test(device)) out['X-Device-Id'] = device;
  return out;
}

/** Response headers passed back to the browser. */
const PASS_BACK = ['content-type', 'content-disposition', 'retry-after', 'cache-control'];

export function downstreamHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const name of PASS_BACK) {
    const v = upstream.get(name);
    if (v) out.set(name, v);
  }
  const ct = (out.get('content-type') ?? '').toLowerCase();
  // HTML (invoices) and SVG are served from our origin: lock them down so nothing in them can run script.
  if (ct.includes('text/html') || ct.includes('image/svg')) {
    out.set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
  }
  if (!out.has('cache-control')) out.set('Cache-Control', 'no-store');
  return out;
}

export function newDeviceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'web_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidDeviceId(v: string | undefined): v is string {
  return !!v && DEVICE_RE.test(v);
}

export function apiBase(env: Record<string, string | undefined> = process.env): string {
  return (env.UJ_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
}

/**
 * Cross-site request guard for state-changing calls: when the browser sends an Origin
 * header it must match this site's host. (The session cookie is SameSite=Lax as well.)
 */
export function sameOrigin(method: string, origin: string | null | undefined, host: string | null | undefined): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  if (!origin || origin === 'null') return !origin; // no Origin (same-origin fetch in some browsers, curl) is allowed
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}
