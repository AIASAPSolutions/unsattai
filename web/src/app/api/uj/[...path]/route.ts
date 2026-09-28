import { NextResponse, type NextRequest } from 'next/server';
import {
  apiBase, DEVICE_COOKIE, sameOrigin, downstreamHeaders, isValidDeviceId, newDeviceId, upstreamHeaders, upstreamUrl,
} from '@/lib/proxy';

// Browser -> this route -> UrJersey API. The API key and the customer's session token
// stay on the server; the browser only ever sees /api/uj/... on this origin.

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

async function forward(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const url = upstreamUrl(apiBase(), path, req.nextUrl.search);
  if (!url) return NextResponse.json({ detail: 'Not found' }, { status: 404 });
  if (!sameOrigin(req.method, req.headers.get('origin'), req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) {
    return NextResponse.json({ detail: 'Cross-site request refused' }, { status: 403 });
  }

  const cookies = Object.fromEntries(req.cookies.getAll().map((c) => [c.name, c.value]));
  let device = cookies[DEVICE_COOKIE];
  const mintDevice = !isValidDeviceId(device);
  if (mintDevice) device = newDeviceId();

  const headers = upstreamHeaders({
    headers: Object.fromEntries(req.headers.entries()),
    cookies: { ...cookies, [DEVICE_COOKIE]: device },
    apiKey: process.env.UJ_API_KEY || undefined,
  });

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: req.signal,
    });
  } catch {
    return NextResponse.json({ detail: 'The UrJersey service is not reachable right now.' }, { status: 502 });
  }

  const res = new NextResponse(upstream.body, { status: upstream.status, headers: downstreamHeaders(upstream.headers) });
  if (mintDevice) {
    res.cookies.set(DEVICE_COOKIE, device!, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 400,
    });
  }
  return res;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
