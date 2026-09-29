import type { NextRequest } from 'next/server';
import { signInRoute } from '@/lib/server/session';

// One-time code sign-in (mobile number or email). The API returns a bearer token; it is
// stored in an httpOnly cookie here and never handed to browser JavaScript. The proxy
// attaches it to API calls.

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  return signInRoute(req, 'auth/otp/verify', 'otp');
}
