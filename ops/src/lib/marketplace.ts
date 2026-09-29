/** Small marketplace rules the screens share. Pure: unit tested. */
import type { PriceBook } from './settingsForm';
import type { Garment, ReturnStatus, Seller } from './types';

/**
 * The "from" price the store shows for a product: the lowest one-piece price any active seller
 * offers for the product's garment and fabric (garment base + fabric surcharge, with the seller's
 * price adjustment). Mirrors catalog.price_from on the server. null when no active seller makes it.
 */
export function priceFrom(pb: Pick<PriceBook, 'garments' | 'fabrics' | 'quantity_tiers'>, sellers: Pick<Seller, 'active' | 'garments' | 'fabrics' | 'price_adjust'>[],
  garment: Garment, fabric: string | null | undefined): number | null {
  let fab = fabric ? pb.fabrics.find((f) => f.id === fabric) : undefined;
  if (!fab) {
    const options = pb.fabrics.filter((f) => f.garments.includes(garment));
    if (!options.length) return null;
    fab = options.reduce((a, b) => (b.surcharge < a.surcharge ? b : a));
  }
  const tier = pb.quantity_tiers.filter((t) => t.min <= 1).reduce((a, b) => (b.min > a.min ? b : a), { min: 1, discount: 0 });
  const base = (pb.garments[garment]?.base ?? 0) + fab.surcharge;
  const prices = sellers
    .filter((s) => s.active && (s.garments ?? []).includes(garment) && (!s.fabrics?.length || (fabric ? s.fabrics.includes(fabric) : false)))
    .map((s) => Math.round((base * (1 + (s.price_adjust ?? 0)) * (1 - tier.discount) + 1e-9) * 100) / 100);
  return prices.length ? Math.min(...prices) : null;
}

/** Moves the server allows from each return status (commerce.RETURN_FLOW). */
export const RETURN_FLOW: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'rejected'],
  picked_up: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export const RETURN_ACTION: Record<ReturnStatus, string> = {
  requested: 'Requested', approved: 'Approve', picked_up: 'Mark picked up', resolved: 'Resolve', rejected: 'Reject',
};

/** Returns that still need someone to act. */
export const OPEN_RETURN_STATUSES: ReturnStatus[] = ['requested', 'approved', 'picked_up'];

/** The body for POST /ops/returns/{id}/status, with the client-side checks the server also makes. */
export function returnStatusBody(to: ReturnStatus, v: { resolution: '' | 'replacement' | 'refund'; refund: string; note: string }):
  { body: Record<string, unknown>; error: string | null } {
  const body: Record<string, unknown> = { status: to, note: v.note.trim() };
  if (to === 'resolved') {
    if (!v.resolution) return { body, error: 'Choose replacement or refund.' };
    body.resolution = v.resolution;
    if (v.resolution === 'refund' && v.refund.trim() !== '') {
      const n = Number(v.refund.replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) return { body, error: 'Enter a refund amount above 0, or leave it empty for the order total.' };
      body.refund_amount = n;
    }
  }
  if (to === 'rejected' && !v.note.trim()) return { body, error: 'Tell the customer why (the note is shown to them).' };
  return { body, error: null };
}
