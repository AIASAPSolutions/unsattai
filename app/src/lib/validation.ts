import { HEX_RE } from './color';
import { normalizeDigits } from './digits';
import { MAX_LOCKED_COLORS, PROMPT_LIMIT, SIZES, TEXT_LIMITS, type Size } from '../api/types';

export type FieldIssue = 'required' | 'tooLong' | 'digits' | 'range' | 'format' | 'tooMany';

export function checkPrompt(prompt: string | null | undefined): FieldIssue | null {
  prompt ??= '';
  const p = prompt.trim();
  if (p.length < 3) return 'required';
  if (prompt.length > PROMPT_LIMIT) return 'tooLong';
  return null;
}

export function checkTeam(v: string | null | undefined): FieldIssue | null {
  v ??= '';
  return v.length > TEXT_LIMITS.team_name ? 'tooLong' : null;
}

export function checkPlayer(v: string | null | undefined): FieldIssue | null {
  v ??= '';
  return v.length > TEXT_LIMITS.player_name ? 'tooLong' : null;
}

export function cleanNumber(v: string | null | undefined): string {
  v ??= '';
  return normalizeDigits(v).replace(/\s/g, '');
}

export function checkNumber(v: string | null | undefined): FieldIssue | null {
  return /^\d{0,3}$/.test(cleanNumber(v)) ? null : 'digits';
}

export function checkFreeText(v: string): FieldIssue | null {
  if (!v.trim()) return 'required';
  return v.length > TEXT_LIMITS.free ? 'tooLong' : null;
}

export function checkLockedColors(colors: string[]): FieldIssue | null {
  if (colors.length > MAX_LOCKED_COLORS) return 'tooMany';
  return colors.every((c) => HEX_RE.test(c)) ? null : 'format';
}

export function checkQuantity(q: number): FieldIssue | null {
  return Number.isInteger(q) && q >= 1 && q <= 500 ? null : 'range';
}

export function isSize(s: string): s is Size {
  return (SIZES as readonly string[]).includes(s);
}

export function checkPhone(v: string): FieldIssue | null {
  if (!v.trim()) return 'required';
  return /^\+?[0-9 ()-]{6,24}$/.test(v.trim()) ? null : 'format';
}

export function checkEmail(v: string): FieldIssue | null {
  if (!v.trim()) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : 'format';
}

export function checkCustomerName(v: string): FieldIssue | null {
  if (!v.trim()) return 'required';
  return v.length > 80 ? 'tooLong' : null;
}
