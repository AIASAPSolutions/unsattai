// Sign-in helpers shared by the browser form and the server routes (kept free of
// Next.js imports so they can be unit tested).

export type Channel = 'phone' | 'email';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/;

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isPhone(v: string): boolean {
  return PHONE_RE.test(v.trim()) && v.replace(/\D/g, '').length >= 6;
}

/** Which kind of identifier the customer typed: an email, a mobile number, or nothing usable. */
export function identifierKind(v: string): Channel | null {
  if (isEmail(v)) return 'email';
  if (isPhone(v)) return 'phone';
  return null;
}

/** Same rule as the server: at least 10 characters with upper and lower case letters and a digit. */
export function passwordIssues(p: string): ('length' | 'upper' | 'lower' | 'digit')[] {
  const out: ('length' | 'upper' | 'lower' | 'digit')[] = [];
  if (p.length < 10) out.push('length');
  if (!/[A-Z]/.test(p)) out.push('upper');
  if (!/[a-z]/.test(p)) out.push('lower');
  if (!/\d/.test(p)) out.push('digit');
  return out;
}

/**
 * The body forwarded to the API by a sign-in route, rebuilt from known fields only.
 * Anything else the browser sends is dropped. Returns null when the body is unusable.
 */
export function signInBody(kind: 'otp' | 'password', raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof r[k] === 'string' ? (r[k] as string).slice(0, max) : '');
  if (kind === 'password') {
    const identifier = str('identifier', 120).trim();
    const password = str('password', 200);
    return identifier && password ? { identifier, password } : null;
  }
  const code = str('code', 8).trim();
  const phone = str('phone', 24).trim();
  const email = str('email', 120).trim();
  if (!code || (!phone && !email) || (phone && email)) return null;
  return { ...(phone ? { phone } : { email }), code, name: str('name', 80).trim() };
}
