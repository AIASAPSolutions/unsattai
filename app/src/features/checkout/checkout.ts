import { ApiError } from '../../api/client';
import type {
  Address, CartQuoteRequest, CheckoutItemProblem, CheckoutRequest, Customer, Language, PaymentMethod,
} from '../../api/types';
import { checkCustomerName, checkEmail, checkPhone, cleanNumber } from '../../lib/validation';
import type { CartLine } from '../cart/cart';
import { toServerItems } from '../cart/cart';
import { hashString, type DraftIssue } from '../order/buildOrder';

// Building the checkout request. The server does the maths (per item, one delivery
// charge per seller, coupon split, cash on delivery fee); this only shapes the request.

export interface CheckoutDraft {
  method: 'ship' | 'pickup';
  address: Address;
  customer: Customer;
  coupon: string;
  rush: boolean;
  payment: PaymentMethod;
}

export function cleanAddress(a: Address, customer?: Customer): Address {
  return {
    name: (a.name || customer?.name || '').trim(),
    phone: (a.phone || customer?.phone || '').trim(),
    line1: a.line1.trim(), line2: (a.line2 ?? '').trim(), city: a.city.trim(),
    state: a.state.trim().toUpperCase(), pincode: cleanNumber(a.pincode).replace(/\D/g, ''),
  };
}

export function addressProblems(a: Address): DraftIssue[] {
  const out: DraftIssue[] = [];
  if (a.line1.trim().length < 3) out.push({ kind: 'address', field: 'line1' });
  if (a.city.trim().length < 2) out.push({ kind: 'address', field: 'city' });
  if (!/^[A-Za-z]{2,4}$/.test(a.state.trim())) out.push({ kind: 'address', field: 'state' });
  if (!/^[1-8]\d{5}$/.test(cleanNumber(a.pincode).replace(/\D/g, ''))) out.push({ kind: 'address', field: 'pincode' });
  return out;
}

export function checkoutIssues(d: CheckoutDraft): DraftIssue[] {
  const out: DraftIssue[] = d.method === 'ship' ? addressProblems(d.address) : [];
  if (checkCustomerName(d.customer.name)) out.push({ kind: 'customer', field: 'name' });
  if (checkPhone(d.customer.phone)) out.push({ kind: 'customer', field: 'phone' });
  if (checkEmail(d.customer.email)) out.push({ kind: 'customer', field: 'email' });
  return out;
}

/** The live price request: the PIN code is sent only once it is a whole PIN code. */
export function cartQuoteRequest(lines: CartLine[], d: Pick<CheckoutDraft, 'method' | 'address' | 'coupon' | 'rush' | 'payment'>): CartQuoteRequest {
  const pin = cleanNumber(d.address.pincode).replace(/\D/g, '');
  return {
    items: toServerItems(lines),
    delivery: {
      method: d.method,
      pincode: d.method === 'ship' && /^\d{6}$/.test(pin) ? pin : '',
      state: d.method === 'ship' ? d.address.state.trim().toUpperCase() : '',
    },
    coupon: d.coupon.trim().toUpperCase(),
    rush: d.rush,
    payment_method: d.payment,
  };
}

export function checkoutPayload(lines: CartLine[], d: CheckoutDraft, language: Language): Omit<CheckoutRequest, 'idempotency_key'> {
  const customer = { name: d.customer.name.trim(), phone: d.customer.phone.trim(), email: d.customer.email.trim() };
  return {
    items: toServerItems(lines),
    customer,
    delivery: d.method === 'pickup' ? { method: 'pickup' } : { method: 'ship', address: cleanAddress(d.address, customer) },
    coupon: d.coupon.trim().toUpperCase(),
    rush: d.rush,
    payment_method: d.payment,
    channel: 'app',
    language,
  };
}

/** Same checkout content, same hash, same idempotency key: a retry never orders twice. */
export function checkoutHash(p: Omit<CheckoutRequest, 'idempotency_key'>): string {
  return hashString(JSON.stringify(p));
}

/** Per-item reasons from a 422 checkout answer ("nothing was ordered"). */
export function checkoutProblems(e: unknown): CheckoutItemProblem[] {
  if (!(e instanceof ApiError)) return [];
  const items = (e.data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as CheckoutItemProblem[]) : [];
}
