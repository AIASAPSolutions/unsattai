/** Shapes returned by the UrJersey API (only the fields the ops app reads). */
import type { Role } from './permissions';

export type Garment = 'jersey' | 'vneck' | 'shorts';
export const GARMENTS: Garment[] = ['jersey', 'vneck', 'shorts'];
/** Every size of every fit, in chart order (server engine/sizing.py). */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4Y', '6Y', '8Y', '10Y', '12Y', '14Y'] as const;
export type Size = (typeof SIZES)[number];
export const ADULT_SIZES: readonly Size[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
export const KIDS_SIZES: readonly Size[] = ['4Y', '6Y', '8Y', '10Y', '12Y', '14Y'];

/** Size charts per order line. The size list of each fit is fixed; GET /meta `fit_sizes` has the same lists. */
export const FITS = ['men', 'women', 'kids'] as const;
export type Fit = (typeof FITS)[number];
export const FIT_SIZES: Record<Fit, readonly Size[]> = {
  men: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  women: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  kids: ['4Y', '6Y', '8Y', '10Y', '12Y', '14Y'],
};
export const FIT_LABEL: Record<Fit, string> = { men: 'Men / unisex', women: 'Women', kids: 'Kids' };
/** The size a new line of this fit starts at. */
export const FIT_DEFAULT_SIZE: Record<Fit, Size> = { men: 'M', women: 'M', kids: '8Y' };

/** Garment options (spec.sleeves, spec.collar). Sleeves don't apply to shorts; collars only to the crew-neck jersey. */
export const SLEEVES = ['short', 'long', 'none'] as const;
export type Sleeves = (typeof SLEEVES)[number];
export const SLEEVE_LABEL: Record<Sleeves, string> = { short: 'Short sleeves', long: 'Long sleeves', none: 'Sleeveless' };
export const COLLARS = ['crew', 'polo', 'mandarin'] as const;
export type Collar = (typeof COLLARS)[number];
export const COLLAR_LABEL: Record<Collar, string> = { crew: 'Crew neck', polo: 'Polo collar', mandarin: 'Mandarin collar' };
export interface OrderOptions { sleeves?: Sleeves; collar?: Collar }

/** Finished garment measurements of a line (cm): tops have chest, length, shoulder (and sleeve); shorts waist, hip, length. */
export type Measurements = Partial<Record<'chest' | 'length' | 'shoulder' | 'sleeve' | 'waist' | 'hip', number>>;
export const FULFILMENT = ['awaiting_payment', 'queued', 'in_production', 'ready', 'dispatched', 'delivered', 'cancelled'] as const;
export type Fulfilment = (typeof FULFILMENT)[number];
export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'demo'] as const;
export const SHIPMENT_STATUSES = ['planned', 'packed', 'dispatched', 'delivered', 'returned', 'cancelled'] as const;
export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'converted', 'declined', 'expired'] as const;
export const ACTIVITY_KINDS = ['note', 'call', 'email', 'whatsapp', 'meeting', 'task'] as const;

export interface Staff { id: string; email: string; role: Role; active: boolean; name?: string; created_at?: string; seller_id?: string }
export interface Me { staff: Staff; permissions: string[]; roles: Role[] }
export interface Page<T> { items: T[]; total: number; page: number; pages: number }

export type Spec = Record<string, any> & { garment: Garment; style_name?: string; elements?: { type: string }[] };

export interface OrderSummary {
  id: string; number?: string; created_at: string; status: string; fulfilment_status: Fulfilment;
  customer_id?: string; customer_name?: string; phone?: string; team_name?: string; garment?: Garment;
  pieces?: number; total?: number; currency?: string; rush?: boolean; promised_delivery_date?: string | null;
  channel?: string; hold?: boolean; style_name?: string;
  // marketplace
  seller_id?: string; seller_name?: string; payment_method?: 'online' | 'cod'; checkout_id?: string | null; email?: string;
  product_id?: string | null; cod_collected?: boolean | null;
}

export interface PriceParts { garment: number; fabric: number; logos: number; size: number; name: number; number: number; sleeves?: number; collar?: number; fit?: number }
export interface OptionPrice { id: string; name: string; price: number }
export interface Pricing {
  currency: string; price_book_version: number | 'draft'; garment: Garment; fabric: { id: string; name: string };
  lines: { line: number; fit?: Fit; size: Size; quantity: number; player_name: string; number: string; unit_price: number; line_total: number; parts: PriceParts }[];
  options?: { sleeves?: OptionPrice; collar?: OptionPrice };
  pieces: number; subtotal: number;
  quantity_discount: { min: number; rate: number; amount: number; next: { min: number; rate: number; pieces_needed: number } | null };
  rush: { selected: boolean; amount: number; rate: number; label: string };
  coupon: { code: string; amount: number; error?: string; note?: string } | null;
  shipping: { method: 'ship' | 'pickup'; zone?: string; zone_name?: string; label?: string; amount: number; free: boolean; free_above?: number | null; transit_days: number };
  tax: { name: string; rate: number; amount: number; inclusive: boolean };
  total: number; average_per_piece: number; problems: string[];
  sales_discount?: number;
  estimate?: { ship_date: string; delivery_date: string; ready_date: string; production_days: number };
  // marketplace
  cod?: { selected: boolean; fee: number; available: boolean; max_order_value: number | null };
  seller?: { id: string; name: string } | null; seller_problem?: string | null; payment_method?: 'online' | 'cod';
}

export interface OrderEvent { at: string; code: string; text: string; actor: string; public: boolean; [k: string]: unknown }
export interface StageState { id: string; name: string; done_at: string | null; done_by?: string | null }
export interface Address { name?: string; phone?: string; line1: string; line2?: string; city: string; state: string; pincode: string }
export interface Order {
  id: string; number?: string; created_at: string; status: string; design_id?: string; spec: Spec; garment: Garment;
  lines: OrderLine[];
  /** Sleeves and collar the order is made with (empty for shorts). */
  options?: OrderOptions;
  /** Production sheets besides the per-piece print files, e.g. "measurements.svg". */
  sheets?: string[];
  total_pieces: number; customer: { name: string; phone: string; email?: string }; customer_id?: string; channel?: string;
  checks?: { level: string; message?: string; code?: string }[]; manufacturing_ready?: boolean;
  files: { name: string; line: number; fit?: Fit; size: Size; panel: string; player_name: string; number: string }[];
  payment: null | { demo: boolean; method: string; reference: string; amount?: number; confirmed_at: string; recorded_by?: string; note?: string;
    collected?: boolean; collected_at?: string | null; collected_by?: string };
  factory?: Record<string, unknown> | null;
  pricing?: Pricing;
  delivery?: { method: 'ship' | 'pickup'; address: Address | null; zone: string | null; transit_days: number };
  fulfilment?: {
    status: Fulfilment; rush: boolean; paid_at: string | null; promised_ship_date: string | null; promised_delivery_date: string | null;
    stages: StageState[]; hold: boolean; hold_reason?: string; cancel_reason?: string; estimate?: Pricing['estimate'];
    dispatched_at?: string; delivered_at?: string;
  };
  events?: OrderEvent[]; shipments?: string[]; quote_id?: string | null;
  // marketplace
  seller?: { id: string; name: string }; checkout_id?: string | null; payment_method?: 'online' | 'cod'; product_id?: string | null;
  refunds?: { id: string; amount: number; at: string; method: string; note: string }[];
  review?: { id: string; rating: number; title: string; body: string; created_at: string; hidden: boolean } | null;
}

export interface OrderLine {
  line: number; fit?: Fit; size: Size; quantity: number; player_name: string; number: string; files?: string[];
  /** Finished garment measurements in cm (from the size chart when the order was placed). */
  measurements?: Measurements;
  /** Flat pattern piece sizes in mm, width and height, before bleed: {front: [w, h], ...}. */
  pieces_mm?: Record<string, [number, number]>;
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
  tracking_url: string; created_at?: string; updated_at?: string; seller_id?: string;
}

export interface AuditRow { id: number; at: string; actor: string; action: string; subject: string; detail: Record<string, unknown> }

export interface Customer {
  id: string; name: string; phone: string; email: string; status: 'active' | 'blocked'; source: string; organisation_id: string;
  owner: string; tags: string[]; addresses: Address[]; orders_count: number; lifetime_value: number; last_order_at: string | null;
  marketing_opt_in: boolean; notes: string; created_at?: string; updated_at?: string;
  phone_verified?: boolean; email_verified?: boolean; has_password?: boolean;
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
export interface QuoteLine { fit?: Fit; size: Size; quantity: number; player_name: string; number: string }
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

// ------------------------------------------------------------------ marketplace

export interface ServiceArea { match: string; transit_days: number; cod: boolean }
export interface SellerAddress { line1: string; city: string; state: string; pincode: string }
/** POST/PUT /ops/sellers body. */
export interface SellerIn {
  name: string; legal_name: string; gstin: string; email: string; phone: string; address: SellerAddress; active: boolean;
  garments: Garment[]; fabrics: string[]; service_areas: ServiceArea[]; blocked_pincodes: string[]; capacity_factor: number;
  holidays: string[]; handling_days: number; min_pieces: number; max_pieces: number; price_adjust: number;
}
export interface Rating { average: number | null; count: number }
export interface Seller extends SellerIn { id: string; rating: Rating; created_at?: string; updated_at?: string; house?: boolean }
export interface SellerDetail { seller: Seller; staff: Staff[]; orders_by_status: Record<string, number> }
export interface PincodeCheck {
  pincode: string; place: { state: string; state_name: string } | null; serviceable: boolean; reason: string | null;
  area: ServiceArea | null; blocked: boolean; matched_by?: 'prefix' | 'state' | '*' | null;
  estimate: { ship_date: string; delivery_date: string; ready_date: string; production_days: number } | null;
}

export interface Product {
  id: string; slug: string; title: string; description: string; sport: string; garment: Garment; spec: Spec; tags: string[];
  colours: string[]; fabric: string; colourways?: Colourway[]; featured: boolean; status: 'draft' | 'published'; orders_count: number; rating: Rating;
  source: { kind: 'spec' | 'brief' | 'order' | 'quote' | 'seed'; ref?: string }; published_at: string | null;
  created_at?: string; updated_at?: string;
}

/** Another colour choice of a product; "original" (the product's own palette) is implied and never stored. */
export const PALETTE_ROLES = ['primary', 'secondary', 'accent', 'trim', 'text'] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export interface Colourway { id: string; name: string; palette: Record<PaletteRole, string> }

export interface Review {
  id: string; order_id: string; product_id: string; seller_id: string; seller_name?: string; customer_id: string; customer_name: string;
  rating: number; title: string; body: string; verified_purchase: boolean; hidden: boolean; hidden_reason?: string; garment?: string;
  created_at: string; updated_at?: string;
}

export const RETURN_STATUSES = ['requested', 'approved', 'picked_up', 'resolved', 'rejected'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export interface ReturnRec {
  id: string; number: string; order_id: string; order_number?: string; customer_id: string; customer_name: string; seller_id: string;
  status: ReturnStatus; reason: string; details: string; lines: { line: number; quantity: number }[];
  resolution: 'replacement' | 'refund' | null; refund_amount: number | null; note: string;
  history: { at: string; status: string; by: string; note?: string }[]; created_at: string; updated_at?: string;
}

export interface Message {
  id: string; channel: 'sms' | 'email'; to: string; subject: string; body: string; status: 'logged' | 'sent' | 'failed';
  customer_id: string; order_id: string; event: string; sent_at: string | null; created_at: string; updated_at?: string;
}

export interface CheckoutRef { id: string; number: string; order_ids: string[]; payment_method: 'online' | 'cod'; status: string }
