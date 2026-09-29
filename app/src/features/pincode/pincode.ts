import type { Place, SellerOffer, Serviceability } from '../../api/types';
import type { StringKey } from '../../i18n/en';
import { normalizeDigits } from '../../lib/digits';

// PIN code rules and the words shown for a serviceability answer. The server is
// the judge of what can be delivered; this only keeps obvious typos from a round trip.

/** Digits only (any Indian script), at most six. */
export function cleanPincode(v: string): string {
  return normalizeDigits(String(v ?? '')).replace(/\D/g, '').slice(0, 6);
}

/** Six digits, first digit 1 to 8: the shape of every Indian PIN code. */
export function isPincode(v: string): boolean {
  return /^[1-8]\d{5}$/.test(cleanPincode(v));
}

export type Tone = 'pass' | 'info' | 'warn' | 'fail';

export interface ServiceMessage {
  tone: Tone;
  key: StringKey;
  params?: Record<string, string | number>;
}

const REASONS: Record<string, StringKey> = {
  invalid_pincode: 'pinInvalid',
  not_serviceable: 'pinNotServiceable',
  garment_unavailable: 'pinGarmentUnavailable',
  pieces_out_of_range: 'pinPiecesOutOfRange',
  seller_unavailable: 'pinSellerUnavailable',
};

/** What to say about a PIN code: checked locally first, then the server's answer. */
export function serviceMessage(pincode: string, s: Serviceability | null): ServiceMessage | null {
  const pin = cleanPincode(pincode);
  if (!pin) return null;
  if (!isPincode(pin)) return { tone: 'fail', key: 'pinInvalid', params: { pin } };
  if (!s || s.pincode !== pin) return null;
  if (!s.serviceable || !s.offers.length) {
    return { tone: 'fail', key: REASONS[s.reason ?? ''] ?? 'pinNotServiceable', params: { pin } };
  }
  return s.place
    ? { tone: 'pass', key: 'pinDeliversTo', params: { pin, place: s.place.state_name } }
    : { tone: 'pass', key: 'pinDelivers', params: { pin } };
}

/** The offer the order goes to: the customer's pick when that seller can serve it, else the recommended one. */
export function chosenOffer(s: Serviceability | null, sellerId?: string | null): SellerOffer | null {
  if (!s?.serviceable) return null;
  return (sellerId && s.offers.find((o) => o.seller_id === sellerId)) || s.offers.find((o) => o.recommended) || s.offers[0] || null;
}

/** Everyone else who can deliver it, best first (the server already sorted them). */
export function otherOffers(s: Serviceability | null, sellerId?: string | null): SellerOffer[] {
  const chosen = chosenOffer(s, sellerId);
  return (s?.offers ?? []).filter((o) => o.seller_id !== chosen?.seller_id);
}

/** "600028 · Tamil Nadu" for the Deliver-to chip. */
export function deliverToText(pincode: string | null, place: Place | null): string | null {
  if (!pincode) return null;
  return place ? `${pincode} · ${place.state_name}` : pincode;
}
