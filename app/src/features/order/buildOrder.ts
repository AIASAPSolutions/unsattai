import type { Customer, DesignSpec, OrderItem, OrderRequest, Language } from '../../api/types';
import { checkCustomerName, checkEmail, checkNumber, checkPhone, checkPlayer, checkQuantity, cleanNumber } from '../../lib/validation';
import type { OrderDraft } from '../../state/flow';

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
  | { kind: 'customer'; field: 'name' | 'phone' | 'email' };

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

/** Small, stable string hash (FNV-1a). Same order content -> same hash -> same idempotency key. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + s.length.toString(16);
}

export function orderPayload(
  designId: string, spec: DesignSpec, items: OrderItem[], customer: Customer, language: Language,
): Omit<OrderRequest, 'idempotency_key'> {
  return {
    design_id: designId, spec, items, language,
    customer: { name: customer.name.trim(), phone: customer.phone.trim(), email: customer.email.trim() },
  };
}

export function payloadHash(p: Omit<OrderRequest, 'idempotency_key'>): string {
  return hashString(JSON.stringify(p));
}
