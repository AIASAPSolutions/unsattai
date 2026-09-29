import type { Identifier } from '../../api/endpoints';
import { normalizeDigits } from '../../lib/digits';

// Mobile numbers and emails as typed on the sign-in screen. The server normalises
// them again (+91…, lower-case email); this catches typos before a code is sent.

export type IdKind = 'phone' | 'email';

export function isEmail(v: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v.trim());
}

/** A 10-digit Indian mobile number, with or without +91 / 0 and spaces or dashes. */
export function normalizeMobile(v: string): string | null {
  const digits = normalizeDigits(v).replace(/[\s()-]/g, '');
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

export function toIdentifier(kind: IdKind, value: string): Identifier | null {
  if (kind === 'email') return isEmail(value) ? { email: value.trim().toLowerCase() } : null;
  const phone = normalizeMobile(value);
  return phone ? { phone } : null;
}

/** For "Sign in with a password": a phone or an email in one box. */
export function guessKind(value: string): IdKind {
  return value.includes('@') ? 'email' : 'phone';
}

/** "+91 98765 43210" and "a•••@example.com" for "we sent a code to …". */
export function displayIdentifier(id: Identifier): string {
  if ('phone' in id) {
    const m = /^\+91(\d{5})(\d{5})$/.exec(id.phone);
    return m ? `+91 ${m[1]} ${m[2]}` : id.phone;
  }
  return id.email;
}

export type PasswordRule = 'length' | 'upper' | 'lower' | 'digit';

/** The server's rule: at least 10 characters with upper and lower case and a digit. */
export function passwordProblems(pw: string): PasswordRule[] {
  const out: PasswordRule[] = [];
  if (pw.length < 10) out.push('length');
  if (!/[A-Z]/.test(pw)) out.push('upper');
  if (!/[a-z]/.test(pw)) out.push('lower');
  if (!/\d/.test(pw)) out.push('digit');
  return out;
}

export function isCode(v: string): boolean {
  return /^\d{4,8}$/.test(normalizeDigits(v).trim());
}
