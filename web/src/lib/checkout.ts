import type {
  Address, CartQuote, CartQuoteItem, CartQuoteRequest, CheckoutItemError, CheckoutRequest, DeliveryMethod, Language,
  PaymentMethod,
} from './api/types';
import { toApiItem, type CartEntry } from './cart';
import { hashString, validateAddress, validateCustomer, type DraftIssue } from './order';
import { PINCODE_RE } from './pincode';

// Checkout payloads and grouping, built from the cart (or a single "Buy now" item).

export interface CheckoutDraft {
  method: DeliveryMethod;
  address: Address;
  /** Index into the signed-in customer's address book, or -1 for a new address. */
  addressIndex: number;
  saveAddress: boolean;
  customer: { name: string; phone: string; email: string };
  coupon: string;
  rush: boolean;
  payment: PaymentMethod;
  idempotencyKey: string | null;
  keyFor: string | null;
}

const trimAddress = (a: Address): Address => ({
  name: a.name.trim(), phone: a.phone.trim(), line1: a.line1.trim(), line2: a.line2.trim(), city: a.city.trim(),
  state: a.state, pincode: a.pincode.trim(),
});

/** POST /checkout body without the idempotency key (added by the caller, see keyForPayload). */
export function checkoutPayload(input: {
  items: CartEntry[]; draft: Pick<CheckoutDraft, 'method' | 'address' | 'customer' | 'coupon' | 'rush' | 'payment'>;
  language: Language;
}): Omit<CheckoutRequest, 'idempotency_key'> {
  const { draft } = input;
  const customer = { name: draft.customer.name.trim(), phone: draft.customer.phone.trim(), email: draft.customer.email.trim() };
  const address = draft.method === 'ship'
    ? trimAddress({ ...draft.address, name: draft.address.name || customer.name, phone: draft.address.phone || customer.phone })
    : null;
  return {
    items: input.items.map(toApiItem),
    customer,
    delivery: { method: draft.method, address },
    coupon: draft.coupon.trim().toUpperCase(),
    rush: draft.rush,
    payment_method: draft.payment,
    channel: 'web',
    language: input.language,
  };
}

export function checkoutHash(p: Omit<CheckoutRequest, 'idempotency_key'>): string {
  return hashString(JSON.stringify(p));
}

/** Cart quote request for the current draft; the PIN code comes from the address, else the "Deliver to" chip. */
export function cartQuoteRequest(items: CartEntry[], draft: Pick<CheckoutDraft, 'method' | 'address' | 'coupon' | 'rush' | 'payment'>,
  chipPincode = ''): CartQuoteRequest | null {
  if (!items.length) return null;
  const pin = PINCODE_RE.test(draft.address.pincode.trim()) ? draft.address.pincode.trim() : PINCODE_RE.test(chipPincode) ? chipPincode : '';
  return {
    items: items.map(toApiItem),
    delivery: {
      method: draft.method,
      pincode: draft.method === 'ship' ? pin : '',
      state: draft.method === 'ship' && /^[A-Z]{2,4}$/.test(draft.address.state) ? draft.address.state : '',
    },
    coupon: draft.coupon.trim().toUpperCase(),
    rush: draft.rush,
    payment_method: draft.payment,
  };
}

export function checkoutIssues(draft: Pick<CheckoutDraft, 'method' | 'address' | 'customer'>): DraftIssue[] {
  return [...(draft.method === 'ship' ? validateAddress(draft.address) : []), ...validateCustomer(draft.customer)];
}

export interface SellerGroup {
  sellerId: string;
  sellerName: string;
  items: { index: number; entry: CartEntry; quote: CartQuoteItem }[];
  /** Latest delivery date of the group's items. */
  deliveryDate: string | null;
  /** The one delivery charge for this seller's items (0 when free). */
  shipping: number;
  free: boolean;
}

/** Items grouped by the seller that makes and ships them, in cart order, with one delivery charge each. */
export function groupBySeller(entries: CartEntry[], quote: CartQuote): SellerGroup[] {
  const groups: SellerGroup[] = [];
  quote.items.forEach((q) => {
    const entry = entries[q.index];
    if (!entry) return;
    const id = q.seller?.id ?? '';
    let g = groups.find((x) => x.sellerId === id);
    if (!g) {
      g = { sellerId: id, sellerName: q.seller?.name ?? '', items: [], deliveryDate: null, shipping: 0, free: true };
      groups.push(g);
    }
    g.items.push({ index: q.index, entry, quote: q });
    if (q.delivery_date && (!g.deliveryDate || q.delivery_date > g.deliveryDate)) g.deliveryDate = q.delivery_date;
    g.shipping = Math.round((g.shipping + q.quote.shipping.amount) * 100) / 100;
    g.free = g.free && (q.quote.shipping.free || q.quote.shipping.amount === 0);
  });
  return groups;
}

/** Per-item errors from a 422 on POST /checkout ("Some items can't be ordered"). */
export function checkoutItemErrors(data: unknown): CheckoutItemError[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is CheckoutItemError => !!x && typeof x === 'object' && typeof (x as CheckoutItemError).index === 'number');
}

/** Why cash on delivery can't be chosen, or null when it can. */
export function codBlock(quote: CartQuote | null, catalogueCod?: { enabled: boolean; max_order_value: number | null } | null):
  'disabled' | 'area' | 'limit' | null {
  if (catalogueCod && !catalogueCod.enabled) return 'disabled';
  if (!quote) return null;
  if (quote.cod_available) return null;
  const max = catalogueCod?.max_order_value;
  if (max && quote.totals.total > max) return 'limit';
  return 'area';
}
