import type { Customer, DesignSpec, OrderItem, OrderRequest, Language, QuoteRequest } from '../../api/types';
import { checkCustomerName, checkEmail, checkNumber, checkPhone, checkPlayer, checkQuantity, cleanNumber } from '../../lib/validation';
import type { Commerce, OrderDraft } from '../../state/flow';

export const MAX_LINES = 200;
export const MAX_PIECES = 5000;

/** Lines exactly as they will be printed: single orders use the design's own name and number. */
export function buildItems(draft: OrderDraft, spec: DesignSpec): OrderItem[] {
  if (draft.mode === 'single') {
    return [{
      player_name: spec.typography.player_name, number: cleanNumber(spec.typography.number),
      size: draft.single.size, quantity: draft.single.quantity,
    }];
  }
  return draft.rows.map(({ player_name, number, size, quantity }) => ({ player_name, number: cleanNumber(number), size, quantity }));
}

export type DraftIssue =
  | { kind: 'emptyRoster' }
  | { kind: 'tooManyLines' }
  | { kind: 'tooManyPieces' }
  | { kind: 'row'; index: number; field: 'player_name' | 'number' | 'quantity' }
  | { kind: 'customer'; field: 'name' | 'phone' | 'email' }
  | { kind: 'address'; field: 'line1' | 'city' | 'state' | 'pincode' };

/** Address rules match the server: a 6-digit PIN code and a short state code such as TN. */
export function addressIssues(c: Commerce): DraftIssue[] {
  if (c.method !== 'ship') return [];
  const a = c.address;
  const out: DraftIssue[] = [];
  if (a.line1.trim().length < 3) out.push({ kind: 'address', field: 'line1' });
  if (a.city.trim().length < 2) out.push({ kind: 'address', field: 'city' });
  if (!/^[A-Za-z]{2,4}$/.test(a.state.trim())) out.push({ kind: 'address', field: 'state' });
  if (!/^\d{6}$/.test(cleanNumber(a.pincode))) out.push({ kind: 'address', field: 'pincode' });
  return out;
}

export function validateDraft(draft: OrderDraft, spec: DesignSpec): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const items = buildItems(draft, spec);
  if (draft.mode === 'team' && items.length === 0) issues.push({ kind: 'emptyRoster' });
  if (items.length > MAX_LINES) issues.push({ kind: 'tooManyLines' });
  items.forEach((it, index) => {
    if (checkPlayer(it.player_name)) issues.push({ kind: 'row', index, field: 'player_name' });
    if (checkNumber(it.number)) issues.push({ kind: 'row', index, field: 'number' });
    if (checkQuantity(it.quantity)) issues.push({ kind: 'row', index, field: 'quantity' });
  });
  if (items.reduce((n, i) => n + (i.quantity || 0), 0) > MAX_PIECES) issues.push({ kind: 'tooManyPieces' });
  const c = draft.customer;
  if (checkCustomerName(c.name)) issues.push({ kind: 'customer', field: 'name' });
  if (checkPhone(c.phone)) issues.push({ kind: 'customer', field: 'phone' });
  if (checkEmail(c.email)) issues.push({ kind: 'customer', field: 'email' });
  return issues;
}

/** Logos priced per piece; the server allows up to 4. */
export function logoCount(spec: DesignSpec): number {
  return Math.min(4, (spec.elements ?? []).filter((e) => e.type === 'logo').length);
}

export function quoteRequest(spec: DesignSpec, items: OrderItem[], c: Commerce): QuoteRequest {
  const pincode = cleanNumber(c.address.pincode);
  return {
    garment: spec.garment, fabric: c.fabric, logos: logoCount(spec), rush: c.rush, coupon: c.coupon.trim(),
    lines: items.map(({ size, quantity, player_name, number }) => ({ size, quantity: Math.max(1, quantity || 1), player_name, number })),
    delivery: { method: c.method, pincode: /^\d{6}$/.test(pincode) ? pincode : '', state: c.address.state.trim().toUpperCase() },
  };
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

/** commerce is left out when the server has no shop (older servers), so the payload stays as it was. */
export function orderPayload(
  designId: string, spec: DesignSpec, items: OrderItem[], customer: Customer, language: Language, commerce?: Commerce | null,
): Omit<OrderRequest, 'idempotency_key'> {
  const base = {
    design_id: designId, spec, items, language,
    customer: { name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email.trim() },
  };
  if (!commerce) return base;
  const a = commerce.address;
  return {
    ...base, fabric: commerce.fabric, rush: commerce.rush, coupon: commerce.coupon.trim(), channel: 'app',
    delivery: commerce.method === 'pickup' ? { method: 'pickup' } : {
      method: 'ship',
      address: { line1: a.line1.trim(), line2: a.line2.trim(), city: a.city.trim(), state: a.state.trim().toUpperCase(), pincode: cleanNumber(a.pincode) },
    },
  };
}

export function payloadHash(p: Omit<OrderRequest, 'idempotency_key'>): string {
  return hashString(JSON.stringify(p));
}
