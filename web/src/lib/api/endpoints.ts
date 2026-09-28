import { parseErrorBody, request, withRetry } from './client';
import type {
  Address, AiAllowance, BackgroundRemoval, Catalogue, Collection, CollectionEntry, Design, DesignSpec, Estimate,
  FromImageRequest, FromImageResponse, GenerateRequest, GenerateResponse, Language, LogoSuggestResponse, Me, Meta,
  Order, OrderRequest, OrderSummary, OtpRequestResponse, Palette, PanelsResponse, Preview, PublicCollection,
  PublicQuote, Quote, QuoteRequest, RefineResponse, Reorder, SavedDesign, Size, Ticket, UnderstandRequest,
  Understanding,
} from './types';

const LONG = 90_000;
const enc = encodeURIComponent;

export const api = {
  // design engine
  meta: () => withRetry(() => request<Meta>('GET', 'meta')),
  understand: (body: UnderstandRequest, signal?: AbortSignal) => request<Understanding>('POST', 'brief/understand', { body, signal }),
  generate: (body: GenerateRequest) => request<GenerateResponse>('POST', 'designs/generate', { body, timeoutMs: LONG }),
  render: (spec: DesignSpec, sizes: Size[] = [], signal?: AbortSignal) =>
    request<Preview>('POST', 'render', { body: { spec, sizes }, signal }),
  panels: (spec: DesignSpec, includeElements: boolean, sizes: Size[] = [], signal?: AbortSignal) =>
    request<PanelsResponse>('POST', 'render/panels', { body: { spec, include_elements: includeElements, sizes }, signal }),
  refine: (spec: DesignSpec, instruction: string, language: Language) =>
    request<RefineResponse>('POST', 'designs/refine', { body: { spec, instruction, language } }),
  fromImage: (body: FromImageRequest) => request<FromImageResponse>('POST', 'designs/from-image', { body, timeoutMs: LONG }),
  aiAllowance: () => request<AiAllowance>('GET', 'ai/allowance', { timeoutMs: 8_000 }),
  suggestLogos: (body: { team_name: string; sport: string; prompt: string; palette: Palette; offset: number }) =>
    request<LogoSuggestResponse>('POST', 'logos/suggest', { body: { ...body, limit: 8 } }),
  removeBackground: (dataUrl: string) =>
    request<BackgroundRemoval>('POST', 'logos/remove-background', { body: { data_url: dataUrl }, timeoutMs: 60_000 }),
  design: (id: string) => request<Design & { rating: number | null }>('GET', `designs/${enc(id)}`),
  feedback: (id: string, body: { rating?: number; selected?: boolean; edited_spec?: DesignSpec; spec?: DesignSpec }) =>
    request<{ ok: boolean }>('POST', `designs/${enc(id)}/feedback`, { body }),

  // orders
  createOrder: (body: OrderRequest) => withRetry(() => request<Order>('POST', 'orders', { body, timeoutMs: 60_000 })),
  order: (id: string) => request<Order>('GET', `orders/${enc(id)}`),
  confirmDemoPayment: (id: string) =>
    withRetry(() => request<Order>('POST', `orders/${enc(id)}/payment-confirmed`, { body: { demo: true } })),
  track: (id: string, phone: string) => request<Order>('GET', `orders/${enc(id)}/track`, { query: { phone } }),

  // shop
  catalogue: () => withRetry(() => request<Catalogue>('GET', 'shop/catalogue')),
  quote: (body: QuoteRequest, signal?: AbortSignal) => request<Quote>('POST', 'shop/quote', { body, signal }),
  deliveryEstimate: (pieces: number, pincode: string, rush: boolean, signal?: AbortSignal) =>
    request<Estimate & { zone: string }>('GET', 'shop/delivery-estimate', { query: { pieces, pincode, rush }, signal }),
  enquiry: (body: {
    name: string; phone: string; email: string; organisation: string; pieces: number; needed_by: string | null;
    message: string; spec?: DesignSpec | null;
  }) => request<{ ok: boolean; reference: string }>('POST', 'shop/enquiries', { body }),

  // sign-in and account
  requestOtp: (phone: string) => request<OtpRequestResponse>('POST', 'auth/otp/request', { body: { phone } }),
  me: () => request<Me>('GET', 'me'),
  updateMe: (body: Partial<Pick<Me, 'name' | 'email' | 'marketing_opt_in'>> & { addresses?: Address[] }) =>
    request<Me>('PATCH', 'me', { body }),
  myOrders: (page = 1) => request<{ orders: OrderSummary[]; total: number; page: number }>('GET', 'me/orders', { query: { page } }),
  myOrder: (id: string) => request<Order>('GET', `me/orders/${enc(id)}`),
  reorder: (id: string) => request<Reorder>('POST', `me/orders/${enc(id)}/reorder`),
  myDesigns: () => request<{ designs: SavedDesign[]; total: number }>('GET', 'me/designs'),
  saveDesign: (body: { name: string; spec: DesignSpec; design_id: string }) =>
    request<SavedDesign>('POST', 'me/designs', { body }),
  deleteDesign: (id: string) => request<{ ok: boolean }>('DELETE', `me/designs/${enc(id)}`),

  // team collections
  createCollection: (body: {
    title: string; spec: DesignSpec; design_id: string; fabric: string; deadline: string | null; message: string;
    unique_numbers: boolean;
  }) => request<Collection>('POST', 'collections', { body }),
  myCollections: () => request<{ collections: Collection[] }>('GET', 'me/collections'),
  myCollection: (id: string) => request<Collection & { entries: CollectionEntry[] }>('GET', `me/collections/${enc(id)}`),
  setCollectionStatus: (id: string, status: 'open' | 'locked' | 'cancelled') =>
    request<Collection>('POST', `me/collections/${enc(id)}/status`, { query: { status } }),
  removeEntry: (id: string, entryId: string) =>
    request<{ ok: boolean }>('DELETE', `me/collections/${enc(id)}/entries/${enc(entryId)}`),
  publicCollection: (token: string) => request<PublicCollection>('GET', `collections/${enc(token)}`),
  addEntry: (token: string, body: Omit<CollectionEntry, 'id' | 'edit_key' | 'created_at'>) =>
    request<CollectionEntry>('POST', `collections/${enc(token)}/entries`, { body }),
  editEntry: (token: string, id: string, key: string, body: Omit<CollectionEntry, 'id' | 'edit_key' | 'created_at'>) =>
    request<CollectionEntry>('PUT', `collections/${enc(token)}/entries/${enc(id)}`, { body, query: { key } }),

  // sales quotes
  publicQuote: (token: string) => request<PublicQuote>('GET', `quotes/${enc(token)}`),
  acceptQuote: (token: string, address: Address | null) =>
    request<{ order_id: string; order: Order }>('POST', `quotes/${enc(token)}/accept`, { body: { address } }),

  // support
  tickets: () => request<{ tickets: Ticket[] }>('GET', 'me/tickets'),
  newTicket: (body: { subject: string; body: string; category: string; order_id: string; priority?: string }) =>
    request<Ticket>('POST', 'me/tickets', { body }),
  replyTicket: (id: string, body: string) => request<Ticket>('POST', `me/tickets/${enc(id)}/reply`, { body: { body } }),
};

/** Our own session routes (httpOnly cookie), not the API proxy. */
export async function verifyOtp(phone: string, code: string, name: string): Promise<{ customer: Me }> {
  const res = await fetch('/api/session/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ phone, code, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw parseErrorBody(res.status, data);
  return data as { customer: Me };
}

export async function signOut(): Promise<void> {
  await fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}
