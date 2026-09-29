import type { Address, DesignSpec, Language, OrderFailure, OrderItem, OrderRequest } from './api/types';
import type { CheckoutDraft } from './flow';
import { isFitSize, normaliseFit } from './sizing';
import {
  checkCustomerName, checkEmail, checkNumber, checkPhone, checkPincode, checkPlayer, checkQuantity, checkRequired, cleanNumber,
} from './validation';

// Order building and validation, ported from the mobile app (app/src/features/order/buildOrder.ts)
// and extended with fabric, delivery, express, coupon and team collections.

export const MAX_LINES = 200;
export const MAX_PIECES = 5000;
/** Above this many pieces the store suggests talking to the sales team (bulk enquiry). */
export const BULK_PIECES = 50;

/** Lines exactly as they will be printed: a single order uses the design's own name and number. */
export function buildItems(draft: Pick<CheckoutDraft, 'mode' | 'single' | 'rows'>, spec: DesignSpec): OrderItem[] {
  if (draft.mode === 'single') {
    return [{
      player_name: spec.typography.player_name, number: cleanNumber(spec.typography.number),
      fit: normaliseFit(draft.single.fit), size: draft.single.size, quantity: draft.single.quantity,
    }];
  }
  return draft.rows.map(({ player_name, number, fit, size, quantity }) => ({
    player_name: player_name.trim(), number: cleanNumber(number), fit: normaliseFit(fit), size, quantity,
  }));
}

export type DraftIssue =
  | { kind: 'emptyRoster' }
  | { kind: 'tooManyLines' }
  | { kind: 'tooManyPieces' }
  | { kind: 'row'; index: number; field: 'player_name' | 'number' | 'quantity' | 'size' }
  | { kind: 'customer'; field: 'name' | 'phone' | 'email' }
  | { kind: 'address'; field: 'line1' | 'city' | 'state' | 'pincode' };

export function validateItems(items: OrderItem[], mode: CheckoutDraft['mode']): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (mode === 'team' && items.length === 0) issues.push({ kind: 'emptyRoster' });
  if (items.length > MAX_LINES) issues.push({ kind: 'tooManyLines' });
  items.forEach((it, index) => {
    if (checkPlayer(it.player_name)) issues.push({ kind: 'row', index, field: 'player_name' });
    if (checkNumber(it.number)) issues.push({ kind: 'row', index, field: 'number' });
    if (checkQuantity(it.quantity)) issues.push({ kind: 'row', index, field: 'quantity' });
    if (!isFitSize(normaliseFit(it.fit), it.size)) issues.push({ kind: 'row', index, field: 'size' });
  });
  if (items.reduce((n, i) => n + (i.quantity || 0), 0) > MAX_PIECES) issues.push({ kind: 'tooManyPieces' });
  return issues;
}

export function validateAddress(a: Address): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (checkRequired(a.line1, 3, 160)) issues.push({ kind: 'address', field: 'line1' });
  if (checkRequired(a.city, 2, 60)) issues.push({ kind: 'address', field: 'city' });
  if (!/^[A-Z]{2,4}$/.test(a.state)) issues.push({ kind: 'address', field: 'state' });
  if (checkPincode(a.pincode)) issues.push({ kind: 'address', field: 'pincode' });
  return issues;
}

export function validateCustomer(c: { name: string; phone: string; email: string }): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (checkCustomerName(c.name)) issues.push({ kind: 'customer', field: 'name' });
  if (checkPhone(c.phone)) issues.push({ kind: 'customer', field: 'phone' });
  if (checkEmail(c.email)) issues.push({ kind: 'customer', field: 'email' });
  return issues;
}

/** Small, stable string hash (FNV-1a). Same order content -> same hash -> same idempotency key. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + s.length.toString(16);
}

export function orderPayload(input: {
  designId: string; spec: DesignSpec; items: OrderItem[]; customer: { name: string; phone: string; email: string };
  language: Language; draft: Pick<CheckoutDraft, 'fabric' | 'rush' | 'coupon' | 'method' | 'address' | 'collectionId'>;
}): Omit<OrderRequest, 'idempotency_key'> {
  const { draft } = input;
  const a = draft.address;
  return {
    design_id: input.designId.slice(0, 40), spec: input.spec, items: input.items, language: input.language,
    customer: { name: input.customer.name.trim(), phone: input.customer.phone.trim(), email: input.customer.email.trim() },
    fabric: draft.fabric, rush: draft.rush, coupon: draft.coupon.trim().toUpperCase(), collection_id: draft.collectionId,
    channel: 'web',
    delivery: {
      method: draft.method,
      address: draft.method === 'ship'
        ? { ...a, name: a.name.trim(), phone: a.phone.trim(), line1: a.line1.trim(), line2: a.line2.trim(), city: a.city.trim(), pincode: a.pincode.trim() }
        : null,
    },
  };
}

export function payloadHash(p: Omit<OrderRequest, 'idempotency_key'>): string {
  return hashString(JSON.stringify(p));
}

/** Which roster rows a server failure refers to (the server merges identical rows into one line). */
export function rowsForFailure(items: OrderItem[], f: Pick<OrderFailure, 'player_name' | 'number' | 'size' | 'fit'>): number[] {
  return items.flatMap((it, i) => (it.player_name === f.player_name && it.number === f.number && it.size === f.size
    && normaliseFit(it.fit) === normaliseFit(f.fit) ? [i] : []));
}
