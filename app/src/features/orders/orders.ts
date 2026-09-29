import type { Order, OrderSummary } from '../../api/types';

export function orderTitle(o: Pick<Order, 'spec' | 'number' | 'id'>): string {
  return o.spec?.typography?.team_name || o.spec?.style_name || o.number || o.id;
}

export function summaryTitle(o: OrderSummary): string {
  return o.team_name || o.style_name || o.number || o.id;
}

/** The return window is open until the end of return_until (local date). */
export function returnOpen(o: Pick<Order, 'can_return' | 'return_until'>, today = new Date().toISOString().slice(0, 10)): boolean {
  return !!o.can_return && (!o.return_until || o.return_until >= today);
}

/** Delivered and not reviewed yet: the server takes one review per order. */
export function canReview(o: Pick<Order, 'fulfilment' | 'review'>): boolean {
  return o.fulfilment?.status === 'delivered' && !o.review;
}

export const CANCEL_REASONS = ['ordered_by_mistake', 'changed_mind', 'wrong_details', 'too_late', 'other'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
