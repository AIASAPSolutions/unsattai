import type { NextRequest } from 'next/server';
import { signInRoute } from '@/lib/server/session';

// Password sign-in with a mobile number or email. Like /api/session/verify, the token
// only ever lives in the httpOnly session cookie.

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  return signInRoute(req, 'auth/login', 'password');
}
