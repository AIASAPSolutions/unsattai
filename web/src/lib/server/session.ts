import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, apiKey, DEVICE_COOKIE, isValidDeviceId, sameOrigin, SESSION_COOKIE } from '../proxy';
import { signInBody } from '../signin';
import { cookieSecure } from './cookie';

/**
 * Sign-in routes (OTP verify, password login) call the API from the server and keep the
 * returned bearer token in an httpOnly cookie. The browser only gets the profile.
 */
export async function signInRoute(req: NextRequest, apiPath: 'auth/otp/verify' | 'auth/login', kind: 'otp' | 'password') {
  if (!sameOrigin('POST', req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
    return NextResponse.json({ detail: 'Cross-site request refused' }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 });
  }
  const body = signInBody(kind, raw);
  if (!body) return NextResponse.json({ detail: 'Invalid request' }, { status: 422 });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['X-API-Key'] = key;
  const ua = req.headers.get('user-agent');
  if (ua) headers['User-Agent'] = ua.slice(0, 300);
  const device = req.cookies.get(DEVICE_COOKIE)?.value;
  if (isValidDeviceId(device)) headers['X-Device-Id'] = device;
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/api/v1/${apiPath}`, {
      method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ detail: 'The Unsattai service is not reachable right now.' }, { status: 502 });
  }
  const data = (await upstream.json().catch(() => ({}))) as { token?: string; expires_at?: string; customer?: unknown };
  if (!upstream.ok || !data.token) {
    const res = NextResponse.json(data, { status: upstream.ok ? 502 : upstream.status });
    const retry = upstream.headers.get('retry-after');
    if (retry) res.headers.set('Retry-After', retry);
    return res;
  }

  const res = NextResponse.json({ customer: data.customer, expires_at: data.expires_at });
  const expires = data.expires_at ? new Date(data.expires_at) : undefined;
  res.cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true, sameSite: 'lax', secure: cookieSecure(), path: '/',
    ...(expires && !Number.isNaN(expires.getTime()) ? { expires } : { maxAge: 60 * 60 * 24 * 60 }),
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
