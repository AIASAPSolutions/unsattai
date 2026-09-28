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

export interface RefineResponse extends Preview {
  spec: DesignSpec;
  changes: RefineChange[];
  understood: boolean;
  message: string;
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

export interface OrderRequest {
  design_id: string;
  spec: DesignSpec;
  items: OrderItem[];
  customer: Customer;
  language: Language;
  idempotency_key: string;
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

export interface Order {
  id: string;
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
  payment: { demo: boolean; reference: string; confirmed_at: string; note: string } | null;
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
