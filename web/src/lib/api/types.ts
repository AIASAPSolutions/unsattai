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

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
export type Size = (typeof SIZES)[number];

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
}

export interface OrderFile {
  name: string;
  line: number;
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
}

export interface TimelineEvent {
  at: string;
  code: string;
  text: string;
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
  lines: (OrderItem & { line: number; files: string[] })[];
  items_submitted: number;
  total_pieces: number;
  customer: Customer;
  language: Language;
  checks: Check[];
  manufacturing_ready: boolean;
  files: OrderFile[];
  payment: { demo: boolean; reference: string; confirmed_at: string; note: string; method?: string } | null;
  factory: FactoryReceipt | null;
  notes: string[];
  duplicate?: boolean;
  spec: DesignSpec;
}

export interface OrderFailure {
  line: number;
  player_name: string;
  number: string;
  size: Size;
  checks: Check[];
}

export interface Meta {
  sports: string[];
  sizes: Size[];
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
  size_surcharge: Record<Size, number>;
  personalisation: { name: number; number: number };
  logo_per_piece: number;
  quantity_tiers: { min: number; discount: number }[];
  minimum_pieces: number;
  rush: { enabled: boolean; fee_rate: number; label: string };
  tax: { name: string; inclusive: boolean };
  pickup: { enabled: boolean; label: string; fee: number };
  zones: { id: string; name: string; transit_days: number; free_above: number | null }[];
  company: { name: string; email: string; phone: string; support_hours: string };
}

export interface PriceLineIn {
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
}

export interface QuoteLine extends PriceLineIn {
  line: number;
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
    free_above?: number | null; transit_days: number;
  };
  tax: { name: string; rate: number; amount: number; inclusive: boolean };
  total: number;
  average_per_piece: number;
  problems: string[];
  sales_discount?: number;
  estimate?: Estimate;
  estimate_standard?: Estimate;
}

export interface Me {
  id: string;
  name: string;
  phone: string;
  email: string;
  addresses: Address[];
  marketing_opt_in: boolean;
  orders_count: number;
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
  phone: string;
  expires_in: number;
  /** Only present when the server runs with OTP_DEV_ECHO on (development). */
  dev_code?: string;
}
