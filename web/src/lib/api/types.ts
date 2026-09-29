// Types mirror server/app/schemas.py and server/app/platform/*. Ported from the mobile
// app (app/src/api/types.ts). Specs are round-tripped as-is: fields this store does not
// know about stay on the object (index signatures), so nothing the server adds later
// is dropped when a spec is sent back.

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

/** The core adult sizes (the studio's print checks and older data use these). */
export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

/** Men / unisex, women and kids charts. The size list of each fit is fixed on the server. */
export const FITS = ['men', 'women', 'kids'] as const;
export type Fit = (typeof FITS)[number];
export const FIT_SIZES = {
  men: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  women: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  kids: ['4Y', '6Y', '8Y', '10Y', '12Y', '14Y'],
} as const;
export const ALL_SIZES = [...FIT_SIZES.men, ...FIT_SIZES.kids] as const;
export type Size = (typeof ALL_SIZES)[number];

export const SLEEVES = ['short', 'long', 'none'] as const;
export type Sleeves = (typeof SLEEVES)[number];
export const COLLARS = ['crew', 'polo', 'mandarin'] as const;
export type Collar = (typeof COLLARS)[number];

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
  /** Older designs have no sleeves or collar: short sleeves and a crew neck. */
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
  /** How the piece is made, e.g. "Sleeveless: the armholes are finished with a binding." */
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
  /** Missing on older data: men / unisex. */
  fit?: Fit;
  size: Size;
  quantity: number;
}

export interface Customer {
  name: string;
  phone: string;
  email: string;
}

export interface Address {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export type DeliveryMethod = 'ship' | 'pickup';

export interface OrderRequest {
  design_id: string;
  spec: DesignSpec;
  items: OrderItem[];
  customer: Customer;
  language: Language;
  idempotency_key: string;
  fabric: string;
  delivery: { method: DeliveryMethod; address: Address | null };
  rush: boolean;
  coupon: string;
  collection_id: string;
  channel: 'web';
  seller_id?: string;
  payment_method?: PaymentMethod;
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

export type FulfilmentStatus =
  | 'awaiting_payment' | 'queued' | 'in_production' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

export interface Estimate {
  ship_date: string;
  delivery_date: string;
  ready_date: string;
  production_days: number;
}

export interface Fulfilment {
  status: FulfilmentStatus;
  rush: boolean;
  paid_at: string | null;
  estimate?: Estimate;
  promised_ship_date: string | null;
  promised_delivery_date: string | null;
  stages: { id: string; name: string; done_at: string | null }[];
  hold: boolean;
  dispatched_at?: string;
  delivered_at?: string;
  cancel_reason?: string;
  shipment?: PublicShipment | null;
  return_until?: string | null;
}

export interface TimelineEvent {
  at: string;
  code: string;
  text: string;
  params?: Record<string, string | number | null>;
}

export interface Order {
  id: string;
  number?: string;
  pricing?: Quote;
  fulfilment?: Fulfilment;
  timeline?: TimelineEvent[];
  delivery?: { method: DeliveryMethod; address: Address | null; zone: string | null; transit_days: number };
  channel?: string;
  collection_id?: string | null;
  quote_id?: string | null;
  shipments?: string[];
  created_at: string;
  status: OrderStatus;
  design_id: string;
  garment: Garment;
  lines: (OrderItem & { line: number; files: string[]; measurements?: Record<string, number> })[];
  /** Sleeves and collar the order is made with (empty for shorts). */
  options?: { sleeves?: Sleeves; collar?: Collar };
  items_submitted: number;
  total_pieces: number;
  customer: Customer;
  language: Language;
  checks: Check[];
  manufacturing_ready: boolean;
  files: OrderFile[];
  payment: {
    demo?: boolean; reference?: string; confirmed_at?: string; note?: string; method?: string; collected?: boolean;
    amount?: number; collected_at?: string | null;
  } | null;
  factory: FactoryReceipt | null;
  notes: string[];
  duplicate?: boolean;
  spec: DesignSpec;
  // marketplace
  seller?: SellerRef;
  checkout_id?: string | null;
  payment_method?: PaymentMethod;
  product_id?: string | null;
  can_cancel?: boolean;
  can_return?: boolean;
  return_until?: string | null;
  review?: OrderReview | null;
  returns?: ReturnRecord[];
  refunds?: { id: string; amount: number; at: string; method: string; note: string }[];
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
  options?: { sleeves: Sleeves[]; collars: Collar[]; fits: Fit[] };
  fit_sizes?: Partial<Record<Fit, Size[]>>;
  palettes: { name: string; palette: Palette; tags: string[] }[];
  colors: { name: string; hex: string }[];
  languages: { code: Language; name: string; native: string }[];
}

export interface Health {
  status: string;
  version: string;
  providers: Record<string, boolean>;
  default_provider: string;
  factory_connected: boolean;
  auth_required: boolean;
  /** False in production: "Pay (demo)" is refused (403, code demo_payments_off). */
  demo_payments?: boolean;
}

// ----------------------------------------------------------------- size guide (GET /shop/size-guide)

export interface SizeGuideRow {
  size: Size;
  /** The wearer's chest all round that the size fits, in cm. */
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

/** A priced choice from the catalogue; the price is per piece and can be negative. */
export interface OptionPrice {
  id: string;
  name: string;
  price: number;
}

// ----------------------------------------------------------------- shop (server/app/platform)

export interface Fabric {
  id: string;
  name: string;
  surcharge: number;
  garments: Garment[];
}

export interface Catalogue {
  currency: string;
  garments: Record<Garment, { name: string; base: number }>;
  fabrics: Fabric[];
  size_surcharge: Partial<Record<Size, number>>;
  options?: { sleeves: OptionPrice[]; collar: OptionPrice[]; fit: OptionPrice[] };
  personalisation: { name: number; number: number };
  logo_per_piece: number;
  quantity_tiers: { min: number; discount: number }[];
  minimum_pieces: number;
  rush: { enabled: boolean; fee_rate: number; label: string };
  tax: { name: string; inclusive: boolean };
  pickup: { enabled: boolean; label: string; fee: number };
  zones: { id: string; name: string; transit_days: number; free_above: number | null }[];
  company: { name: string; email: string; phone: string; support_hours: string };
  cod?: { enabled: boolean; fee: number; max_order_value: number | null };
  returns?: { window_days: number; reasons: string[] };
}

export interface PriceLineIn {
  fit?: Fit;
  size: Size;
  quantity: number;
  player_name: string;
  number: string;
}

export interface QuoteRequest {
  garment: Garment;
  fabric: string;
  logos: number;
  lines: PriceLineIn[];
  delivery: { method: DeliveryMethod; pincode: string; state: string };
  rush: boolean;
  coupon: string;
  sleeves?: Sleeves;
  collar?: Collar;
}

export interface QuoteLine extends PriceLineIn {
  line: number;
  fit?: Fit;
  unit_price: number;
  line_total: number;
  parts: Record<string, number>;
}

export interface Quote {
  currency: string;
  price_book_version: number | string;
  garment: Garment;
  fabric: { id: string; name: string };
  lines: QuoteLine[];
  pieces: number;
  subtotal: number;
  quantity_discount: {
    min: number; rate: number; amount: number;
    next: { min: number; rate: number; pieces_needed: number } | null;
  };
  rush: { selected: boolean; amount: number; rate: number; label: string };
  coupon: { code: string; amount: number; note?: string; error?: string } | null;
  shipping: {
    method: DeliveryMethod; label?: string; zone?: string; zone_name?: string; amount: number; free: boolean;
    free_above?: number | null; transit_days: number; combined?: boolean;
  };
  tax: { name: string; rate: number; amount: number; inclusive: boolean };
  total: number;
  average_per_piece: number;
  problems: string[];
  /** The sleeves and collar priced, when they are not the included choice. */
  options?: { sleeves?: OptionPrice; collar?: OptionPrice };
  sales_discount?: number;
  estimate?: Estimate | null;
  estimate_standard?: Estimate;
  seller?: SellerRef | null;
  seller_problem?: ReasonCode | null;
  payment_method?: PaymentMethod;
  cod?: { selected: boolean; fee: number; available: boolean; max_order_value: number | null };
}

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string;
  addresses: Address[];
  marketing_opt_in: boolean;
  orders_count: number;
  phone_verified?: boolean;
  email_verified?: boolean;
  has_password?: boolean;
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
  rush: boolean;
  promised_delivery_date: string | null;
  style_name: string | null;
  hold: boolean;
  seller_id?: string;
  seller_name?: string | null;
  payment_method?: PaymentMethod;
  checkout_id?: string | null;
  product_id?: string | null;
}

export interface Reorder {
  spec: DesignSpec;
  design_id: string | null;
  items: OrderItem[];
  fabric: string;
  delivery: { method?: DeliveryMethod; address?: Address | null };
}

export interface SavedDesign {
  id: string;
  name: string;
  spec: DesignSpec;
  design_id: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionEntry {
  id: string;
  player_name: string;
  number: string;
  fit?: Fit;
  size: Size;
  quantity: number;
  contact: string;
  edit_key?: string;
  created_at?: string;
}

export type CollectionStatus = 'open' | 'locked' | 'cancelled' | 'ordered';

export interface Collection {
  id: string;
  token: string;
  title: string;
  spec: DesignSpec;
  design_id: string;
  fabric: string;
  deadline: string | null;
  message: string;
  unique_numbers: boolean;
  status: CollectionStatus;
  organiser_name: string;
  order_id?: string;
  count?: number;
  entries?: CollectionEntry[];
  created_at?: string;
}

export interface PublicCollection {
  id: string;
  token: string;
  title: string;
  spec: DesignSpec;
  deadline: string | null;
  message: string;
  status: CollectionStatus;
  organiser: string;
  fabric: string;
  sizes: Size[];
  fit_sizes?: Partial<Record<Fit, Size[]>>;
  count: number;
  taken_numbers: string[];
  unique_numbers: boolean;
  currency: string;
  base_price: number;
}

export interface PublicQuote {
  id: string;
  number: string;
  title: string;
  spec: DesignSpec;
  lines: PriceLineIn[];
  pricing: Quote;
  valid_until: string;
  message: string;
  status: string;
  customer: { name: string; phone: string; email: string };
  fabric: string;
  rush: boolean;
  delivery: { method: DeliveryMethod; pincode: string; state: string };
  expired: boolean;
}

export interface TicketMessage {
  at: string;
  from: 'customer' | 'staff' | string;
  body: string;
}

export interface Ticket {
  id: string;
  number: string;
  subject: string;
  category: string;
  order_id: string;
  priority: string;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  messages: TicketMessage[];
  created_at: string;
  updated_at: string;
}

export interface OtpRequestResponse {
  sent: boolean;
  phone?: string;
  email?: string;
  expires_in: number;
  /** Only present when the server runs with OTP_DEV_ECHO on (development). */
  dev_code?: string;
}

// ----------------------------------------------------------------- marketplace (docs/marketplace-api.md)

export type ReasonCode =
  | 'invalid_pincode' | 'not_serviceable' | 'garment_unavailable' | 'pieces_out_of_range' | 'seller_unavailable'
  | 'cod_unavailable' | 'print_check_failed';

export interface Rating {
  average: number | null;
  count: number;
}

export interface SellerRef {
  id: string;
  name: string;
}

export interface Offer {
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
  place: { state: string; state_name: string } | null;
  reason: ReasonCode | null;
  offers: Offer[];
  recommended_seller_id: string | null;
}

export interface PublicOffer {
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
  /** Other colours the design comes in; the first is always { id: "original" }. */
  colourways?: Colourway[];
}

/** List items carry a two-colour swatch, product detail the full palette. */
export interface Colourway {
  id: string;
  name: string;
  swatch?: [string, string];
  palette?: Partial<Palette>;
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  body: string;
  customer_name: string;
  created_at: string;
  verified_purchase: boolean;
  garment: Garment;
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

export interface ProductList {
  items: Product[];
  total: number;
  page: number;
  pages: number;
  sort: ProductSort;
  facets: { sport: Facet[]; garment: Facet[]; colour: Facet[]; price: { min: number | null; max: number | null } };
}

export interface ProductQuery {
  q?: string;
  sport?: string;
  garment?: string;
  colour?: string;
  min_price?: number;
  max_price?: number;
  featured?: boolean;
  sort?: ProductSort;
  page?: number;
  size?: number;
}

/** A cart item as the API takes it: a product or the customer's own design, never both. */
export interface ApiCartItem {
  product_id?: string;
  spec?: DesignSpec | null;
  design_id?: string;
  garment?: Garment | null;
  fabric: string;
  logos?: number;
  lines: OrderItem[];
  seller_id?: string;
  /** Products only: a colourway id and sleeve and collar choices that override the product's. */
  colourway?: string;
  sleeves?: Sleeves;
  collar?: Collar;
}

export type PaymentMethod = 'online' | 'cod';

export interface CartQuoteRequest {
  items: ApiCartItem[];
  delivery: { method: DeliveryMethod; pincode: string; state: string };
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
  product_id: string | null;
  title: string;
  garment: Garment;
  seller: SellerRef | null;
  quote: Quote;
  coupon_share: number;
  delivery_date: string | null;
  problems: string[];
  options?: { sleeves?: Sleeves; collar?: Collar; colourway?: string | null };
  image_url?: string | null;
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
  items: ApiCartItem[];
  customer: Customer;
  delivery: { method: DeliveryMethod; address: Address | null };
  coupon: string;
  rush: boolean;
  payment_method: PaymentMethod;
  idempotency_key: string;
  channel: 'web';
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

export interface CheckoutItemError {
  index: number;
  code: ReasonCode | string;
  message: string;
  failures?: OrderFailure[];
}

export interface ReturnRecord {
  id: string;
  number: string;
  status: 'requested' | 'approved' | 'picked_up' | 'resolved' | 'rejected';
  reason: string;
  details: string;
  lines: { line: number; quantity: number }[] | null;
  resolution: 'replacement' | 'refund' | null;
  refund_amount: number | null;
  created_at: string;
  updated_at: string;
  note: string;
}

export interface OrderReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  hidden: boolean;
}

export interface PublicShipment {
  id: string;
  carrier_name: string;
  tracking_no: string;
  tracking_url: string;
  status: string;
  planned_date: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
}

export interface Session {
  id: string;
  created_at: string;
  last_seen_at: string;
  device_label: string;
  current: boolean;
}

export interface Notification {
  id: string;
  code: string;
  title: string;
  body: string;
  order_id: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationPage {
  items: Notification[];
  total: number;
  unread: number;
  page: number;
}

export interface Wishlist {
  product_ids: string[];
  items: Product[];
}
