/** Shapes returned by the UrJersey API (only the fields the ops app reads). */
import type { Role } from './permissions';

export type Garment = 'jersey' | 'vneck' | 'shorts';
export const GARMENTS: Garment[] = ['jersey', 'vneck', 'shorts'];
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = (typeof SIZES)[number];
export const FULFILMENT = ['awaiting_payment', 'queued', 'in_production', 'ready', 'dispatched', 'delivered', 'cancelled'] as const;
export type Fulfilment = (typeof FULFILMENT)[number];
export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'demo'] as const;
export const SHIPMENT_STATUSES = ['planned', 'packed', 'dispatched', 'delivered', 'returned', 'cancelled'] as const;
export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'converted', 'declined', 'expired'] as const;
export const ACTIVITY_KINDS = ['note', 'call', 'email', 'whatsapp', 'meeting', 'task'] as const;

export interface Staff { id: string; email: string; role: Role; active: boolean; name?: string; created_at?: string }
export interface Me { staff: Staff; permissions: string[]; roles: Role[] }
export interface Page<T> { items: T[]; total: number; page: number; pages: number }

export type Spec = Record<string, any> & { garment: Garment; style_name?: string; elements?: { type: string }[] };

export interface OrderSummary {
  id: string; number?: string; created_at: string; status: string; fulfilment_status: Fulfilment;
  customer_id?: string; customer_name?: string; phone?: string; team_name?: string; garment?: Garment;
  pieces?: number; total?: number; currency?: string; rush?: boolean; promised_delivery_date?: string | null;
  channel?: string; hold?: boolean; style_name?: string;
}

export interface PriceParts { garment: number; fabric: number; logos: number; size: number; name: number; number: number }
export interface Pricing {
  currency: string; price_book_version: number | 'draft'; garment: Garment; fabric: { id: string; name: string };
  lines: { line: number; size: Size; quantity: number; player_name: string; number: string; unit_price: number; line_total: number; parts: PriceParts }[];
  pieces: number; subtotal: number;
  quantity_discount: { min: number; rate: number; amount: number; next: { min: number; rate: number; pieces_needed: number } | null };
  rush: { selected: boolean; amount: number; rate: number; label: string };
  coupon: { code: string; amount: number; error?: string; note?: string } | null;
  shipping: { method: 'ship' | 'pickup'; zone?: string; zone_name?: string; label?: string; amount: number; free: boolean; free_above?: number | null; transit_days: number };
  tax: { name: string; rate: number; amount: number; inclusive: boolean };
  total: number; average_per_piece: number; problems: string[];
  sales_discount?: number;
  estimate?: { ship_date: string; delivery_date: string; ready_date: string; production_days: number };
}

export interface OrderEvent { at: string; code: string; text: string; actor: string; public: boolean; [k: string]: unknown }
export interface StageState { id: string; name: string; done_at: string | null; done_by?: string | null }
export interface Address { name?: string; phone?: string; line1: string; line2?: string; city: string; state: string; pincode: string }
export interface Order {
  id: string; number?: string; created_at: string; status: string; design_id?: string; spec: Spec; garment: Garment;
  lines: { line: number; size: Size; quantity: number; player_name: string; number: string; files?: string[] }[];
  total_pieces: number; customer: { name: string; phone: string; email?: string }; customer_id?: string; channel?: string;
  checks?: { level: string; message?: string; code?: string }[]; manufacturing_ready?: boolean;
  files: { name: string; line: number; size: Size; panel: string; player_name: string; number: string }[];
  payment: null | { demo: boolean; method: string; reference: string; amount?: number; confirmed_at: string; recorded_by?: string; note?: string };
  factory?: Record<string, unknown> | null;
  pricing?: Pricing;
  delivery?: { method: 'ship' | 'pickup'; address: Address | null; zone: string | null; transit_days: number };
  fulfilment?: {
    status: Fulfilment; rush: boolean; paid_at: string | null; promised_ship_date: string | null; promised_delivery_date: string | null;
    stages: StageState[]; hold: boolean; hold_reason?: string; cancel_reason?: string; estimate?: Pricing['estimate'];
    dispatched_at?: string; delivered_at?: string;
  };
  events?: OrderEvent[]; shipments?: string[]; quote_id?: string | null;
}

export interface PlanStage { id: string; name: string; start: string; end: string; pieces: number }
export interface Plan {
  order_id: string; stages: PlanStage[]; ready_date: string; ship_date: string; delivery_date: string;
  promised_delivery_date: string | null; late: boolean; rush: boolean; pieces: number; summary?: OrderSummary;
}

export interface Shipment {
  id: string; order_id: string; order_number?: string; carrier: string; carrier_name: string; tracking_no: string;
  status: (typeof SHIPMENT_STATUSES)[number]; planned_date: string | null; packed_at: string | null; dispatched_at: string | null;
  delivered_at: string | null; address: Address | null; method: 'ship' | 'pickup'; pieces: number; customer_name: string;
  tracking_url: string; created_at?: string; updated_at?: string;
}

export interface AuditRow { id: number; at: string; actor: string; action: string; subject: string; detail: Record<string, unknown> }

export interface Customer {
  id: string; name: string; phone: string; email: string; status: 'active' | 'blocked'; source: string; organisation_id: string;
  owner: string; tags: string[]; addresses: Address[]; orders_count: number; lifetime_value: number; last_order_at: string | null;
  marketing_opt_in: boolean; notes: string; created_at?: string; updated_at?: string;
}
export interface Organisation {
  id: string; name: string; kind: string; city: string; state: string; phone: string; email: string; owner: string;
  tags: string[]; notes: string; status: 'active' | 'archived'; created_at?: string; updated_at?: string;
}
export interface Lead {
  id: string; title: string; stage: string; customer_id: string; organisation_id: string; value: number; pieces: number;
  source: string; owner: string; expected_close: string | null; lost_reason: string; notes: string; spec?: Spec;
  history?: { at: string; from: string; to: string; by: string }[]; created_at?: string; updated_at?: string;
}
export interface Activity {
  id: string; kind: (typeof ACTIVITY_KINDS)[number]; subject: string; body: string; due_at: string | null; owner: string;
  done: boolean; done_at: string | null; created_by: string; created_at?: string;
}
export interface QuoteLine { size: Size; quantity: number; player_name: string; number: string }
export interface Quote {
  id: string; number: string; customer_id: string; lead_id: string; title: string; spec: Spec; design_id: string; garment: Garment;
  fabric: string; lines: QuoteLine[]; delivery: { method: 'ship' | 'pickup'; pincode: string; state: string }; rush: boolean;
  coupon: string; extra_discount: number; message: string; pricing: Pricing; status: (typeof QUOTE_STATUSES)[number];
  token: string; valid_until: string; created_by: string; customer: { name: string; phone: string; email?: string };
  order_id?: string; history?: { at: string; status: string; by: string }[]; created_at?: string; updated_at?: string; path?: string;
}
export interface Ticket {
  id: string; number: string; subject: string; body: string; category: string; order_id: string; priority: string;
  status: (typeof TICKET_STATUSES)[number]; customer_id: string; customer: { name: string | null; phone: string }; channel: string;
  owner: string; messages: { at: string; from: string; body: string; internal?: boolean }[]; created_at?: string; updated_at?: string;
}

export interface Versioned<T> { value: T; version: number; updated_at: string | null; updated_by: string | null }
