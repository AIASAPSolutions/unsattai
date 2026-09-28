import { request, withRetry } from './client';
import type {
  AiAllowance, BackgroundRemoval, Design, FromImageRequest, FromImageResponse, DesignSpec, GenerateRequest, GenerateResponse, Health, Language, LogoSuggestResponse,
  Meta, Order, OrderRequest, Palette, PanelsResponse, Preview, RefineResponse, Size, UnderstandRequest, Understanding,
} from './types';

const LONG = 90_000; // generation with an LLM provider can take a while

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
};
