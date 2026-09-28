import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, sameOrigin, SESSION_COOKIE } from '@/lib/proxy';

// Phone OTP verification. The API returns a bearer token; it is stored in an httpOnly
// cookie here and never handed to browser JavaScript. The proxy attaches it to API calls.

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin('POST', req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
    return NextResponse.json({ detail: 'Cross-site request refused' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: 'Invalid request' }, { status: 400 });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.UJ_API_KEY) headers['X-API-Key'] = process.env.UJ_API_KEY;
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/api/v1/auth/otp/verify`, {
      method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ detail: 'The UrJersey service is not reachable right now.' }, { status: 502 });
  }
  const data = (await upstream.json().catch(() => ({}))) as { token?: string; expires_at?: string; customer?: unknown };
  if (!upstream.ok || !data.token) return NextResponse.json(data, { status: upstream.ok ? 502 : upstream.status });

  const res = NextResponse.json({ customer: data.customer, expires_at: data.expires_at });
  const expires = data.expires_at ? new Date(data.expires_at) : undefined;
  res.cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    ...(expires && !Number.isNaN(expires.getTime()) ? { expires } : { maxAge: 60 * 60 * 24 * 60 }),
  });
  return res;
}
