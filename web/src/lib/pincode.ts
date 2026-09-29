import type { Address, ReasonCode } from './api/types';

// "Deliver to" PIN code: remembered on the device, or taken from a signed-in customer's
// default (first) address until they pick one themselves.

export const PINCODE_RE = /^[1-8]\d{5}$/;

export interface PincodeChoice {
  pincode: string;
  /** user: typed or picked on this device; account: the signed-in customer's default address. */
  source: 'user' | 'account' | null;
}

export const NO_PINCODE: PincodeChoice = { pincode: '', source: null };

/** Client-side check before asking the server: six digits, first digit 1 to 8. */
export function pincodeIssue(v: string): 'empty' | 'format' | null {
  const p = v.trim();
  if (!p) return 'empty';
  return PINCODE_RE.test(p) ? null : 'format';
}

export function cleanPincode(v: string): string {
  return v.replace(/\D/g, '').slice(0, 6);
}

/** Read a saved choice defensively (older or hand-edited storage). */
export function parseSaved(raw: unknown): PincodeChoice {
  if (!raw || typeof raw !== 'object') return NO_PINCODE;
  const r = raw as Partial<PincodeChoice>;
  return typeof r.pincode === 'string' && PINCODE_RE.test(r.pincode) ? { pincode: r.pincode, source: 'user' } : NO_PINCODE;
}

/**
 * The PIN code to deliver to: the customer's own choice on this device wins; otherwise a
 * signed-in customer's default address; otherwise none yet.
 */
export function resolvePincode(saved: PincodeChoice, me: { addresses: Pick<Address, 'pincode'>[] } | null): PincodeChoice {
  if (saved.source === 'user' && PINCODE_RE.test(saved.pincode)) return saved;
  const def = me?.addresses.find((a) => PINCODE_RE.test(a.pincode));
  if (def) return { pincode: def.pincode, source: 'account' };
  return NO_PINCODE;
}

/** Which message to show for a reason code from /shop/serviceability or a cart quote. */
export const REASON_MESSAGE = {
  invalid_pincode: 'pinInvalidServer',
  not_serviceable: 'pinNotServiceable',
  garment_unavailable: 'pinGarmentUnavailable',
  pieces_out_of_range: 'pinPiecesOutOfRange',
  seller_unavailable: 'pinSellerUnavailable',
  cod_unavailable: 'codUnavailable',
  print_check_failed: 'orderBlockedServer',
} as const satisfies Record<ReasonCode, string>;

export function reasonKey(reason: string | null | undefined): (typeof REASON_MESSAGE)[ReasonCode] | null {
  if (!reason) return null;
  return (REASON_MESSAGE as Record<string, (typeof REASON_MESSAGE)[ReasonCode]>)[reason] ?? 'pinNotServiceable';
}
