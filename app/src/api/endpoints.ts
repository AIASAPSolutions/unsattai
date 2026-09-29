import { request, withRetry } from './client';
import type {
  AppNotification, CartItem, CartQuote, CartQuoteRequest, Checkout, CheckoutRequest, CodeSent, Me, NotificationPage, Offer,
  OrderReview, OrderSummary, ProductDetail, ProductPage, ProductQuery, Review, ReturnRecord, ServerCart, Serviceability,
  SessionInfo, SignedIn, Wishlist, Address,
  AiAllowance, BackgroundRemoval, Catalogue, Quote, QuoteRequest, Design, FromImageRequest, FromImageResponse, DesignSpec, GenerateRequest, GenerateResponse, Health, Language, LogoSuggestResponse,
  Meta, Order, OrderItem, OrderRequest, Palette, PanelsResponse, Preview, RefineResponse, Size, UnderstandRequest, Understanding,
} from './types';

const LONG = 90_000; // generation with an LLM provider can take a while

const enc = encodeURIComponent;

/** ?a=1&b=x from the set values only. */
export function queryString(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Who is signing in: exactly one of phone or email. */
export type Identifier = { phone: string } | { email: string };

export const api = {
  health: () => request<Health>('GET', '/api/v1/health', { timeoutMs: 8_000 }),
  fromImage: (body: FromImageRequest) =>
    request<FromImageResponse>('POST', '/api/v1/designs/from-image', { body, timeoutMs: LONG }),
  aiAllowance: () => request<AiAllowance>('GET', '/api/v1/ai/allowance', { timeoutMs: 8_000 }),
  meta: () => withRetry(() => request<Meta>('GET', '/api/v1/meta')),

  understand: (body: UnderstandRequest, signal?: AbortSignal) =>
    request<Understanding>('POST', '/api/v1/brief/understand', { body, signal }),

  generate: (body: GenerateRequest) =>
    request<GenerateResponse>('POST', '/api/v1/designs/generate', { body, timeoutMs: LONG }),

  render: (spec: DesignSpec, sizes: Size[] = [], signal?: AbortSignal) =>
    request<Preview>('POST', '/api/v1/render', { body: { spec, sizes }, signal }),

  panels: (spec: DesignSpec, includeElements: boolean, sizes: Size[] = [], signal?: AbortSignal) =>
    request<PanelsResponse>('POST', '/api/v1/render/panels',
      { body: { spec, include_elements: includeElements, sizes }, signal }),

  refine: (spec: DesignSpec, instruction: string, language: Language) =>
    request<RefineResponse>('POST', '/api/v1/designs/refine', { body: { spec, instruction, language } }),

  suggestLogos: (body: { team_name: string; sport: string; prompt: string; palette: Palette; offset: number }) =>
    request<LogoSuggestResponse>('POST', '/api/v1/logos/suggest', { body: { ...body, limit: 8 } }),

  removeBackground: (dataUrl: string) =>
    request<BackgroundRemoval>('POST', '/api/v1/logos/remove-background', { body: { data_url: dataUrl }, timeoutMs: 60_000 }),

  design: (id: string) => request<Design & { rating: number | null }>('GET', `/api/v1/designs/${encodeURIComponent(id)}`),

  feedback: (id: string, body: { rating?: number; selected?: boolean; edited_spec?: DesignSpec; spec?: DesignSpec }) =>
    request<{ ok: boolean }>('POST', `/api/v1/designs/${encodeURIComponent(id)}/feedback`, { body }),

  /** Safe to retry: the server returns the same order for the same idempotency key. */
  createOrder: (body: OrderRequest) =>
    withRetry(() => request<Order>('POST', '/api/v1/orders', { body, timeoutMs: 60_000 })),

  catalogue: () => withRetry(() => request<Catalogue>('GET', '/api/v1/shop/catalogue')),

  quote: (body: QuoteRequest, signal?: AbortSignal) =>
    request<Quote>('POST', '/api/v1/shop/quote', { body, signal }),

  invoice: (id: string) =>
    request<string>('GET', `/api/v1/orders/${encodeURIComponent(id)}/invoice`, { text: true }),

  order: (id: string) => request<Order>('GET', `/api/v1/orders/${encodeURIComponent(id)}`),

  /** Also idempotent server-side: a second confirmation returns the first receipt marked duplicate. */
  confirmDemoPayment: (id: string) =>
    withRetry(() => request<Order>('POST', `/api/v1/orders/${encodeURIComponent(id)}/payment-confirmed`,
      { body: { demo: true } })),

  orderFile: (id: string, name: string) =>
    request<string>('POST', `/api/v1/orders/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`,
      { text: true, timeoutMs: 60_000 }),

  printSheet: (spec: DesignSpec, size: Size, designId: string) =>
    request<string>('POST', '/api/v1/print', { body: { spec, size, design_id: designId }, text: true }),

  // ---------------------------------------------------------------- marketplace: delivery, products, offers

  serviceability: (q: { pincode: string; garment?: string; fabric?: string; pieces?: number; rush?: boolean }, signal?: AbortSignal) =>
    request<Serviceability>('GET', `/api/v1/shop/serviceability${queryString(q)}`, { signal, timeoutMs: 15_000 }),

  offers: () => request<{ currency: string; items: Offer[] }>('GET', '/api/v1/shop/offers'),

  products: (q: ProductQuery, signal?: AbortSignal) =>
    request<ProductPage>('GET', `/api/v1/shop/products${queryString({ ...q })}`, { signal }),

  product: (slug: string) => request<ProductDetail>('GET', `/api/v1/shop/products/${enc(slug)}`),

  productReviews: (slug: string, page = 1) =>
    request<{ items: Review[]; total: number; page: number; pages: number }>('GET', `/api/v1/shop/products/${enc(slug)}/reviews?page=${page}`),

  /** SVG pictures (products) fetched with the app's headers, so they work when the server needs a key. */
  svg: (path: string, signal?: AbortSignal) => request<string>('GET', path, { text: true, signal }),

  // ---------------------------------------------------------------- cart and checkout

  cartQuote: (body: CartQuoteRequest, signal?: AbortSignal) =>
    request<CartQuote>('POST', '/api/v1/shop/cart/quote', { body, signal }),

  /** Safe to retry: the same idempotency key and body returns the first checkout. */
  checkout: (body: CheckoutRequest) =>
    withRetry(() => request<Checkout>('POST', '/api/v1/checkout', { body, timeoutMs: 60_000 })),

  getCheckout: (id: string) => request<Checkout>('GET', `/api/v1/checkouts/${enc(id)}`),

  /** Idempotent on the server: paying again changes nothing. */
  payCheckout: (id: string) => withRetry(() => request<Checkout>('POST', `/api/v1/checkouts/${enc(id)}/pay`, { body: {} })),

  getCart: () => request<ServerCart>('GET', '/api/v1/me/cart'),
  putCart: (items: CartItem[]) => request<ServerCart>('PUT', '/api/v1/me/cart', { body: { items } }),
  mergeCart: (items: CartItem[]) => request<ServerCart>('POST', '/api/v1/me/cart/merge', { body: { items } }),

  // ---------------------------------------------------------------- sign-in and account

  requestCode: (who: Identifier) => request<CodeSent>('POST', '/api/v1/auth/otp/request', { body: who, anonymous: true }),
  verifyCode: (who: Identifier, code: string, name = '') =>
    request<SignedIn>('POST', '/api/v1/auth/otp/verify', { body: { ...who, code, name }, anonymous: true }),
  login: (identifier: string, password: string) =>
    request<SignedIn>('POST', '/api/v1/auth/login', { body: { identifier, password }, anonymous: true }),
  logout: () => request<{ ok: boolean }>('POST', '/api/v1/auth/logout', { timeoutMs: 8_000 }),

  me: () => request<Me>('GET', '/api/v1/me'),
  updateMe: (patch: { name?: string; email?: string; addresses?: Address[]; marketing_opt_in?: boolean }) =>
    request<Me>('PATCH', '/api/v1/me', { body: patch }),
  setPassword: (next: string, current?: string) =>
    request<{ ok: boolean; other_sessions_signed_out: number }>('POST', '/api/v1/me/password', { body: { new: next, current: current || null } }),
  requestIdentifierCode: (who: Identifier) => request<CodeSent>('POST', '/api/v1/me/identifiers/request', { body: who }),
  verifyIdentifier: (who: Identifier, code: string) =>
    request<Me>('POST', '/api/v1/me/identifiers/verify', { body: { ...who, code } }),
  sessions: () => request<{ items: SessionInfo[] }>('GET', '/api/v1/me/sessions'),
  endSession: (id: string) => request<{ ok: boolean }>('DELETE', `/api/v1/me/sessions/${enc(id)}`),
  endOtherSessions: () => request<{ ok: boolean; signed_out: number }>('POST', '/api/v1/me/sessions/revoke-others', { body: {} }),

  wishlist: () => request<Wishlist>('GET', '/api/v1/me/wishlist'),
  addToWishlist: (productId: string) => request<Wishlist>('POST', '/api/v1/me/wishlist', { body: { product_id: productId } }),
  removeFromWishlist: (productId: string) => request<Wishlist>('DELETE', `/api/v1/me/wishlist/${enc(productId)}`),

  myOrders: (page = 1) => request<{ orders: OrderSummary[]; total: number; page: number }>('GET', `/api/v1/me/orders?page=${page}`),
  cancelOrder: (id: string, reason: string) => request<Order>('POST', `/api/v1/me/orders/${enc(id)}/cancel`, { body: { reason } }),
  requestReturn: (id: string, body: { reason: string; details: string; lines?: { line: number; quantity: number }[] }) =>
    request<{ return: ReturnRecord; order: Order }>('POST', `/api/v1/me/orders/${enc(id)}/returns`, { body }),
  reviewOrder: (id: string, body: { rating: number; title: string; body: string }) =>
    request<{ review: OrderReview; order: Order }>('POST', `/api/v1/me/orders/${enc(id)}/review`, { body }),
  reorder: (id: string) =>
    request<{ spec: DesignSpec; design_id: string | null; items: OrderItem[]; fabric: string }>('POST', `/api/v1/me/orders/${enc(id)}/reorder`, { body: {} }),

  notifications: (page = 1, unreadOnly = false) =>
    request<NotificationPage>('GET', `/api/v1/me/notifications${queryString({ page, unread_only: unreadOnly || undefined })}`),
  markNotificationsRead: (ids: string[] | 'all') =>
    request<{ ok: boolean; marked: number; unread: number }>('POST', '/api/v1/me/notifications/read',
      { body: ids === 'all' ? { all: true } : { ids } }),
};

export type { AppNotification };
