// Types mirror server/app/schemas.py. Specs are round-tripped as-is: fields this
// app does not know about stay on the object (index signatures), so nothing the
// server adds later is dropped when the app sends a spec back.

export const GARMENTS = ['jersey', 'vneck', 'shorts'] as const;
export type Garment = (typeof GARMENTS)[number];

export const SPORTS = [
  'football', 'cricket', 'basketball', 'rugby', 'hockey', 'volleyball',
  'kabaddi', 'cycling', 'running', 'esports', 'netball', 'badminton',
] as const;
export type Sport = (typeof SPORTS)[number];

export const PATTERNS = [
  'stripes', 'pinstripe', 'chevron', 'camo', 'halftone', 'geometric',
  'hexagon', 'waves', 'shards', 'splatter', 'topo', 'gradient',
] as const;
export type PatternType = (typeof PATTERNS)[number];

export const COVERAGES = ['full', 'top', 'bottom', 'diagonal_band', 'side_panels', 'chest_band'] as const;
export type Coverage = (typeof COVERAGES)[number];

export const FONTS = ['block', 'athletic', 'modern'] as const;
export type Font = (typeof FONTS)[number];

export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'trim', 'text'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Men's sizes before fits existed (the studio's print checks use these). */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
/** Every size of every fit: Men XS-3XL, Women XS-XXL, Kids 4Y-14Y. */
export const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4Y', '6Y', '8Y', '10Y', '12Y', '14Y'] as const;
export type Size = (typeof ALL_SIZES)[number];

/** Which size chart a line is made to. Lines saved before fits existed are men's. */
export const FITS = ['men', 'women', 'kids'] as const;
export type Fit = (typeof FITS)[number];
export const FIT_SIZES: Record<Fit, readonly Size[]> = {
  men: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  women: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  kids: ['4Y', '6Y', '8Y', '10Y', '12Y', '14Y'],
};

/** Garment options for tops. "none" is sleeveless. Collars are for the round-neck jersey only. */
export const SLEEVES = ['short', 'long', 'none'] as const;
export type Sleeves = (typeof SLEEVES)[number];
export const COLLARS = ['crew', 'polo', 'mandarin'] as const;
export type Collar = (typeof COLLARS)[number];

/** What the customer picked before designing; null = read it from the brief or picture. */
export interface GarmentOptions {
  sleeves?: Sleeves | null;
  collar?: Collar | null;
}

export const LANGUAGES = ['en', 'hi', 'te', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];

export const TEXT_LIMITS = { team_name: 24, player_name: 16, number: 3, free: 32 } as const;
export const MAX_LOGOS = 4;
export const MAX_LOCKED_COLORS = 4;
export const MAX_LOGO_BYTES = 1_500_000;
export const PROMPT_LIMIT = 600;

type Open = { [extra: string]: unknown };

export type Palette = Record<ColorRole, string> & Open;

export interface PatternSpec extends Open {
  type: PatternType;
  colors: ColorRole[];
  scale: number;
  angle: number;
  density: number;
  opacity: number;
  coverage: Coverage;
}

export interface Accents extends Open {
  side_panels: boolean;
  shoulder_stripes: number;
  collar_role: ColorRole;
  cuff_role: ColorRole;
}

export interface Typography extends Open {
  team_name: string;
  player_name: string;
  number: string;
  font: Font;
}

export type LayerPanel = 'front' | 'back';
export type Bind = 'team_name' | 'player_name' | 'number';

interface LayerBase extends Open {
  id: string;
  panel: LayerPanel;
  x: number;
  y: number;
  rotation: number;
}

export interface TextElement extends LayerBase {
  type: 'text';
  bind?: Bind | null;
  text: string;
  size: number;
  max_width?: number | null;
  font?: Font | null;
  color_role?: ColorRole | null;
  color?: string | null;
}

export interface LogoElement extends LayerBase {
  type: 'logo';
  src: string;
  width: number;
  aspect: number;
  kind: 'raster' | 'vector';
  pixel_width?: number | null;
  pixel_height?: number | null;
  source: 'upload' | 'suggested';
  name?: string;
}

export type Element = TextElement | LogoElement;

export interface DesignSpec extends Open {
  garment: Garment;
  sport: string;
  style_name: string;
  base: 'solid' | 'gradient';
  palette: Palette;
  pattern: PatternSpec;
  accents: Accents;
  typography: Typography;
  seed: number;
  rationale: string;
  elements: Element[];
  /** Tops only; older specs leave them out (short sleeves, crew neck). */
  sleeves?: Sleeves;
  collar?: Collar;
}

export type CheckLevel = 'pass' | 'info' | 'warn' | 'fail';
export interface Check {
  id: string;
  level: CheckLevel;
  message: string;
  element_id?: string | null;
}

export interface Preview {
  mockup_svg: string;
  checks: Check[];
  manufacturing_ready: boolean;
}

export interface Design extends Preview {
  id: string;
  variant_index: number;
  spec: DesignSpec;
}

export interface GenerateRequest {
  prompt: string;
  garment: Garment;
  sport?: string | null;
  team_name: string;
  player_name: string;
  number: string;
  locked_colors: string[];
  variants: number;
  seed?: number | null;
  language: Language;
  options?: GarmentOptions;
}

export interface GenerateResponse {
  generation_id: string;
  provider: string;
  requested_provider: string;
  fallback_reason: string | null;
  seed: number;
  designs: Design[];
}

export interface UnderstandRequest {
  prompt: string;
  garment?: Garment | null;
  sport?: string | null;
  team_name: string;
  player_name: string;
  number: string;
  locked_colors: string[];
  language: Language;
}

export type ValueSource = 'form' | 'prompt' | 'choice' | 'locked' | 'default' | null;

export interface SourcedValue {
  value: string;
  source: ValueSource;
}

export interface Question {
  id: string;
  field: 'sport' | 'garment' | 'team_name' | 'player_name' | 'number';
  kind: 'conflict' | 'missing' | 'choice';
  message: string;
  options: { value: string; source: ValueSource }[];
}

export interface Understanding {
  prompt: string;
  normalized_prompt: string;
  language: Language;
  detected_language: Language | null;
  sport: string | null;
  sport_source: ValueSource;
  garment: Garment;
  garment_source: ValueSource;
  colors: { hex: string; name: string; source: 'locked' | 'prompt' }[];
  patterns: string[];
  themes: string[];
  coverage: string | null;
  font: string | null;
  team_name: SourcedValue;
  player_name: SourcedValue;
  number: SourcedValue;
  questions: Question[];
  ready: boolean;
  /** Sleeves and collar found in the brief ("sleeveless vest", "polo collar"). */
  options?: { sleeves: Sleeves | null; collar: Collar | null };
}

export interface Panel {
  name: string;
  kind: string;
  side: LayerPanel | null;
  width: number;
  height: number;
  outline: string;
  svg: string;
  editable: boolean;
  safe_zone: [number, number][] | null;
  /** e.g. "Flat front piece as printed. The sleeves are separate pieces, sewn on." */
  note?: string;
}

export interface PanelsResponse {
  garment: Garment;
  panels: Panel[];
  layers: { id: string; panel: LayerPanel; safe: boolean; size: [number, number]; corners: [number, number][] }[];
  default_elements: TextElement[];
  checks: Check[];
  manufacturing_ready: boolean;
}

export interface RefineChange {
  field: string;
  from: unknown;
  to: unknown;
  message: string;
}

export interface FromImageRequest {
  /** data:image/jpeg|png;base64,... up to 6 MB */
  image: string;
  garment: Garment;
  sport?: string | null;
  team_name: string;
  player_name: string;
  number: string;
  language: Language;
  options?: GarmentOptions;
}

/** What the server could read from the picture. Warnings are codes the app translates. */
export type PictureWarning =
  | 'busy_background' | 'small_picture' | 'not_garment' | 'text_not_copied' | 'garment_differs'
  | 'ai_limit' | 'ai_unavailable';

export interface FromImageResponse {
  generation_id: string;
  provider: string;
  source: 'ai' | 'pixels';
  colors: { hex: string; share: number }[];
  recognised: {
    garment_seen: string | null;
    text_seen: string[];
    notes: string;
    pattern: string;
    coverage: string;
    base: string;
    sleeves?: Sleeves | null;
    collar?: Collar | null;
  };
  warnings: PictureWarning[];
  ai: AiAllowance;
  designs: Design[];
}

/** Free AI edits for this phone today. Simple edits handled by the rules don't count. */
export interface AiAllowance {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  cached?: boolean;
  error?: boolean;
}

export interface RefineResponse extends Preview {
  spec: DesignSpec;
  changes: RefineChange[];
  understood: boolean;
  message: string;
  /** Older servers leave these out. */
  source?: 'rules' | 'ai';
  ai?: AiAllowance;
}

export interface LogoSuggestion {
  id: string;
  name: string;
  svg: string;
  data_url: string;
}

export interface LogoSuggestResponse {
  logos: LogoSuggestion[];
  offset: number;
  next_offset: number | null;
  total: number;
}

export interface BackgroundRemoval {
  applied: boolean;
  data_url: string;
  background: string | null;
  removed_ratio: number;
  reason: string | null;
}

export interface OrderItem {
  player_name: string;
  number: string;
  /** Missing on lines saved before fits existed: the server reads it as men. */
  fit?: Fit;
  size: Size;
  quantity: number;
}

/** A placed order line: measurements in cm and the flat pieces in mm, for production. */
export interface OrderLine extends OrderItem {
  line: number;
  files: string[];
  measurements?: Record<string, number>;
  pieces_mm?: Record<string, [number, number]>;
  chart_row?: unknown;
}

export interface Customer {
  name: string;
  phone: string;
  email: string;
}

export interface OrderRequest {
  design_id: string;
  spec: DesignSpec;
  items: OrderItem[];
  customer: Customer;
  language: Language;
  idempotency_key: string;
  /** Commerce options; older servers ignore them. */
  fabric?: string;
  delivery?: OrderDelivery | null;
  rush?: boolean;
  coupon?: string;
  channel?: 'app' | 'web' | 'sales';
}

export interface Address {
  /** Who receives it; optional, the checkout contact is used when empty. */
  name?: string;
  phone?: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export interface OrderDelivery {
  method: 'ship' | 'pickup';
  address?: Address | null;
}

export interface Fabric {
  id: string;
  name: string;
  surcharge: number;
  garments: Garment[];
  description?: string;
}

export interface Catalogue {
  currency: string;
  fabrics: Fabric[];
  minimum_pieces: number;
  rush: { enabled: boolean; fee_rate: number; label: string };
  pickup: { enabled: boolean; label: string; fee: number };
  quantity_tiers: { min: number; discount: number }[];
  cod?: { enabled: boolean; fee: number; max_order_value: number | null };
  returns?: { window_days: number; reasons: string[] };
  company: { name: string; email: string; phone: string; support_hours: string };
  /** Active choices only, price per piece (can be negative). Older servers leave it out. */
  options?: { sleeves: OptionPrice[]; collar: OptionPrice[]; fit: OptionPrice[] };
  size_surcharge?: Record<string, number>;
}

export interface OptionPrice {
  id: string;
  name: string;
  price: number;
}

export interface QuoteRequest {
  garment: Garment;
  fabric: string;
  logos: number;
  sleeves?: Sleeves;
  collar?: Collar;
  lines: { fit: Fit; size: Size; quantity: number; player_name: string; number: string }[];
  delivery: { method: 'ship' | 'pickup'; pincode: string; state: string };
  rush: boolean;
  coupon: string;
}

export interface DeliveryEstimate {
  ship_date: string;
  delivery_date: string;
  ready_date: string;
}

export interface Pricing {
  currency: string;
  fabric: { id: string; name: string };
  pieces: number;
  subtotal: number;
  quantity_discount: { min: number; rate: number; amount: number; next: { min: number; rate: number; pieces_needed: number } | null };
  rush: { selected: boolean; amount: number; rate: number; label: string };
  coupon: { code: string; amount: number; error?: string; note?: string } | null;
  shipping: { method: 'ship' | 'pickup'; amount: number; free: boolean; label?: string; zone_name?: string; transit_days: number; combined?: boolean };
  cod?: { selected: boolean; fee: number; available: boolean; max_order_value?: number | null };
  seller?: SellerRef | null;
  tax: { name: string; rate: number; amount: number; inclusive: boolean };
  total: number;
  average_per_piece: number;
  problems: string[];
}

export interface Quote extends Pricing {
  estimate: DeliveryEstimate;
  estimate_standard?: DeliveryEstimate;
}

export type FulfilmentStatus =
  | 'awaiting_payment' | 'queued' | 'in_production' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

export interface Fulfilment {
  status: FulfilmentStatus;
  rush: boolean;
  hold?: boolean;
  estimate?: DeliveryEstimate;
  promised_ship_date?: string | null;
  promised_delivery_date?: string | null;
  stages?: { id: string; name: string; done_at: string | null }[];
  shipment?: Shipment | null;
  return_until?: string | null;
  dispatched_at?: string;
  delivered_at?: string;
}

export interface Shipment {
  id: string;
  carrier_name: string;
  tracking_no: string;
  tracking_url: string;
  status: 'planned' | 'packed' | 'dispatched' | 'delivered' | 'returned' | 'cancelled' | string;
  planned_date: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
}


export interface OrderFile {
  name: string;
  line: number;
  fit?: Fit;
  size: Size;
  panel: string;
  player_name: string;
  number: string;
}

export interface FactoryReceipt {
  job_id: string;
  queue: string;
  accepted_at: string;
  factory_connected: boolean;
  duplicate: boolean;
  order_id: string;
  note?: string;
  error?: string;
}

export type OrderStatus =
  | 'awaiting_payment'
  | 'released_to_test_queue'
  | 'released_to_factory'
  | 'paid_release_failed';

export interface Order {
  id: string;
  created_at: string;
  status: OrderStatus;
  design_id: string;
  garment: Garment;
  lines: OrderLine[];
  /** Sleeves and collar the order is made with (empty for shorts). */
  options?: { sleeves?: Sleeves; collar?: Collar };
  /** Production sheets such as measurements.svg. */
  sheets?: string[];
  items_submitted: number;
  total_pieces: number;
  customer: Customer;
  language: Language;
  checks: Check[];
  manufacturing_ready: boolean;
  files: OrderFile[];
  payment: {
    demo?: boolean; reference: string; confirmed_at?: string; note?: string;
    method?: string; collected?: boolean; amount?: number; collected_at?: string | null;
  } | null;
  factory: FactoryReceipt | null;
  notes: string[];
  duplicate?: boolean;
  spec: DesignSpec;
  /** Present when the server runs the ordering platform. */
  number?: string;
  pricing?: Pricing;
  delivery?: OrderDelivery & { transit_days?: number; zone?: string | null };
  fulfilment?: Fulfilment;
  timeline?: { at: string; code: string; text: string; params?: Record<string, unknown> }[];
  /** Marketplace fields (servers from 2026-09 on). */
  seller?: SellerRef;
  checkout_id?: string | null;
  payment_method?: PaymentMethod;
  can_cancel?: boolean;
  can_return?: boolean;
  return_until?: string | null;
  review?: OrderReview | null;
  returns?: ReturnRecord[];
  refunds?: { id: string; amount: number; at: string; method: string; note: string }[];
  product_id?: string | null;
}

export interface OrderFailure {
  line: number;
  player_name: string;
  number: string;
  fit?: Fit;
  size: Size;
  checks: Check[];
}

export interface Meta {
  sports: string[];
  sizes: Size[];
  palettes: { name: string; palette: Palette; tags: string[] }[];
  colors: { name: string; hex: string }[];
  languages: { code: Language; name: string; native: string }[];
  /** Servers with garment options and fits. */
  options?: { sleeves: Sleeves[]; collars: Collar[]; fits: Fit[] };
  fit_sizes?: Partial<Record<Fit, Size[]>>;
}

/** GET /shop/size-guide. Garment measurements laid flat, in cm; body_chest is the wearer's chest all round. */
export interface SizeGuideRow {
  size: Size;
  body_chest: [number, number];
  height: [number, number] | null;
  top: { chest: number; length: number; shoulder: number; sleeve_short: number; sleeve_long: number };
  shorts: { waist: number; hip: number; length: number };
}

export interface SizeGuide {
  unit: string;
  tolerance_cm: number;
  note: string;
  how_to_measure: { id: string; name: string; text: string }[];
  fits: { id: Fit; name: string; sizes: SizeGuideRow[] }[];
}

export interface Health {
  status: string;
  version: string;
  providers: Record<string, boolean>;
  default_provider: string;
  factory_connected: boolean;
  auth_required: boolean;
  /** False in production: no "Pay (demo)"; online payment is coming soon. */
  demo_payments?: boolean;
}

// ------------------------------------------------------------------ marketplace

export type PaymentMethod = 'online' | 'cod';

export interface SellerRef {
  id: string;
  name: string;
}

export interface Rating {
  average: number | null;
  count: number;
}

export type ServiceReason =
  | 'invalid_pincode' | 'not_serviceable' | 'garment_unavailable' | 'pieces_out_of_range' | 'seller_unavailable'
  | 'cod_unavailable' | 'print_check_failed';

export interface Place {
  state: string;
  state_name: string;
}

export interface SellerOffer {
  seller_id: string;
  seller_name: string;
  rating: Rating;
  unit_price: number;
  ship_date: string;
  delivery_date: string;
  transit_days: number;
  cod_available: boolean;
  recommended: boolean;
  fastest: boolean;
  cheapest: boolean;
}

export interface Serviceability {
  pincode: string;
  serviceable: boolean;
  place: Place | null;
  reason: ServiceReason | string | null;
  offers: SellerOffer[];
  recommended_seller_id: string | null;
}

export interface Offer {
  code: string;
  title: string;
  kind: 'percent' | 'amount';
  value: number;
  max_discount: number | null;
  min_subtotal: number | null;
  expires: string | null;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description: string;
  sport: string;
  garment: Garment;
  colours: string[];
  tags: string[];
  fabric: string;
  featured: boolean;
  rating: Rating;
  orders_count: number;
  published_at: string;
  price_from: number | null;
  currency: string;
  image_url: string;
  style_name: string;
  /** The first is always the original. List items carry swatches, the detail full palettes. */
  colourways?: Colourway[];
}

export interface Colourway {
  id: string;
  name: string;
  swatch?: [string, string];
  palette?: Palette;
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  customer_name: string;
  created_at: string;
  verified_purchase: boolean;
  garment: string;
  seller_name: string;
}

export interface ProductDetail extends Product {
  spec: DesignSpec;
  review_summary: Rating & { distribution: Record<string, number> };
  reviews: Review[];
  fabrics: { id: string; name: string; surcharge: number }[];
}

export interface Facet {
  value: string;
  count: number;
}

export type ProductSort = 'popular' | 'new' | 'price_asc' | 'price_desc' | 'rating';

export interface ProductQuery {
  q?: string;
  sport?: string;
  garment?: string;
  colour?: string;
  min_price?: number | null;
  max_price?: number | null;
  sort?: ProductSort;
  page?: number;
  size?: number;
  featured?: boolean;
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pages: number;
  sort: ProductSort;
  facets: { sport: Facet[]; garment: Facet[]; colour: Facet[]; price: { min: number; max: number } | null };
}

/** A cart item exactly as the server takes it: a product or the customer's own design. */
export interface CartItem {
  product_id?: string;
  spec?: DesignSpec | null;
  design_id?: string;
  garment?: Garment | null;
  fabric: string;
  logos?: number;
  lines: OrderItem[];
  seller_id?: string;
  /** Products only: a colourway id and garment options that override the product's own. */
  colourway?: string;
  sleeves?: Sleeves | null;
  collar?: Collar | null;
}

export interface ServerCart {
  items: CartItem[];
  max_items: number;
}

export interface CartDelivery {
  method: 'ship' | 'pickup';
  pincode: string;
  state: string;
}

export interface CartQuoteRequest {
  items: CartItem[];
  delivery: CartDelivery;
  coupon: string;
  rush: boolean;
  payment_method: PaymentMethod;
}

export interface CartTotals {
  subtotal: number;
  quantity_discount: number;
  rush: number;
  coupon: number;
  shipping: number;
  cod_fee: number;
  tax: number;
  total: number;
}

export interface CartQuoteItem {
  index: number;
  product_id?: string | null;
  title: string;
  garment: Garment;
  seller: SellerRef | null;
  quote: Quote & { seller?: SellerRef | null; seller_problem?: string | null; cod?: { selected: boolean; fee: number; available: boolean } };
  coupon_share: number;
  delivery_date: string | null;
  problems: string[];
  /** Servers with garment options: what the item is made with, and a picture that shows it. */
  options?: { sleeves?: Sleeves | null; collar?: Collar | null; colourway?: string | null };
  image_url?: string;
}

export interface CartQuote {
  currency: string;
  items: CartQuoteItem[];
  coupon: { code: string; amount: number; note?: string; error?: string; split?: { index: number; amount: number }[] } | null;
  payment_method: PaymentMethod;
  pieces: number;
  totals: CartTotals;
  cod_available: boolean;
  delivery_by: string | null;
  problems: string[];
}

export interface CheckoutRequest {
  items: CartItem[];
  customer: Customer;
  delivery: OrderDelivery;
  coupon: string;
  rush: boolean;
  payment_method: PaymentMethod;
  idempotency_key: string;
  channel: 'app';
  language: Language;
}

export interface Checkout {
  id: string;
  number: string;
  order_ids: string[];
  customer: Customer;
  customer_id: string | null;
  payment_method: PaymentMethod;
  status: 'open' | 'paid' | string;
  coupon: CartQuote['coupon'];
  currency: string;
  totals: CartTotals;
  channel: string;
  created_at: string;
  updated_at: string;
  orders?: Order[];
  duplicate?: boolean;
}

/** One item that stopped a checkout (422). */
export interface CheckoutItemProblem {
  index: number;
  code: ServiceReason | string;
  message: string;
  failures?: OrderFailure[];
}

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string;
  addresses: Address[];
  marketing_opt_in: boolean;
  orders_count: number;
  phone_verified: boolean;
  email_verified: boolean;
  has_password: boolean;
}

export interface CodeSent {
  sent: boolean;
  phone?: string;
  email?: string;
  expires_in: number;
  /** Only from test servers (OTP_DEV_ECHO). */
  dev_code?: string;
}

export interface SignedIn {
  token: string;
  expires_at: string;
  session_id: string;
  customer: Me;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  device_label: string;
  current: boolean;
}

export interface OrderSummary {
  id: string;
  number: string | null;
  created_at: string;
  status: OrderStatus;
  fulfilment_status: FulfilmentStatus;
  team_name: string;
  garment: Garment;
  pieces: number;
  total: number | null;
  currency: string | null;
  promised_delivery_date: string | null;
  style_name: string | null;
  seller_name: string | null;
  payment_method: PaymentMethod;
  checkout_id: string | null;
  product_id: string | null;
}

export interface OrderReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  hidden?: boolean;
}

export interface ReturnRecord {
  id: string;
  number: string;
  status: 'requested' | 'approved' | 'picked_up' | 'resolved' | 'rejected' | string;
  reason: string;
  details: string;
  lines: { line: number; quantity: number }[];
  resolution: 'replacement' | 'refund' | null;
  refund_amount: number | null;
  created_at: string;
  updated_at: string;
  note: string;
}

export interface AppNotification {
  id: string;
  code: string;
  title: string;
  body: string;
  order_id: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationPage {
  items: AppNotification[];
  total: number;
  unread: number;
  page: number;
}

export interface Wishlist {
  product_ids: string[];
  items: Product[];
}
