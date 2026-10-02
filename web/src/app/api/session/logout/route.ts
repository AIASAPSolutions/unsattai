import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, apiKey, sameOrigin, SESSION_COOKIE } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin('POST', req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
    return NextResponse.json({ detail: 'Cross-site request refused' }, { status: 403 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    const key = apiKey();
    if (key) headers['X-API-Key'] = key;
    await fetch(`${apiBase()}/api/v1/auth/logout`, { method: 'POST', headers, cache: 'no-store' }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
