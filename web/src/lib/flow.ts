'use client';
import { api } from './api/endpoints';
import type {
  Address, Design, DesignSpec, Garment, GenerateResponse, Language, OrderItem, Question, Size, Understanding,
} from './api/types';
import { canRedo, canUndo, commitFrom, createHistory, push, redo, replace, undo, type History } from './history';
import { newId, newIdempotencyKey } from './ids';
import { createStore, useStore } from './store';

// The customer journey as one store, like the mobile app's (app/src/state/flow.ts):
// brief -> understanding -> confirmed brief -> designs -> studio (spec with undo
// history) -> checkout draft. The draft is kept in IndexedDB so a refresh or a
// sign-in round trip never loses a design.

export interface Brief {
  prompt: string;
  garment: Garment;
  locked_colors: string[];
  team_name: string;
  player_name: string;
  number: string;
}

export interface Confirmed extends Brief {
  sport: string | null;
}

export interface RosterRow extends OrderItem {
  key: string;
}

export const EMPTY_ADDRESS: Address = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

export interface CheckoutDraft {
  mode: 'single' | 'team';
  single: { size: Size; quantity: number };
  rows: RosterRow[];
  fabric: string;
  rush: boolean;
  coupon: string;
  method: 'ship' | 'pickup';
  address: Address;
  saveAddress: boolean;
  customer: { name: string; phone: string; email: string };
  collectionId: string;
  collectionTitle: string;
  idempotencyKey: string | null;
  /** Payload the key was issued for: a changed order gets a new key, a retry reuses it. */
  keyFor: string | null;
  /** The cart item being edited (Edit in the cart), or null for a new item. */
  cartKey?: string | null;
}

export type DesignSource = 'generated' | 'picture' | 'saved' | 'reorder' | 'shared' | 'team' | 'product';

export interface FlowState {
  brief: Brief;
  understanding: Understanding | null;
  answers: Record<string, string>;
  confirmed: Confirmed | null;
  generation: Omit<GenerateResponse, 'designs'> | null;
  designs: Design[];
  ratings: Record<string, number>;
  designId: string | null;
  source: DesignSource | null;
  history: History<DesignSpec> | null;
  gestureBase: DesignSpec | null;
  checkout: CheckoutDraft;
}

export const EMPTY_BRIEF: Brief = {
  prompt: '', garment: 'jersey', locked_colors: [], team_name: '', player_name: '', number: '',
};

export const EMPTY_CHECKOUT: CheckoutDraft = {
  mode: 'single',
  single: { size: 'M', quantity: 1 },
  rows: [],
  fabric: 'standard',
  rush: false,
  coupon: '',
  method: 'ship',
  address: EMPTY_ADDRESS,
  saveAddress: true,
  customer: { name: '', phone: '', email: '' },
  collectionId: '',
  collectionTitle: '',
  idempotencyKey: null,
  keyFor: null,
};

const initial: FlowState = {
  brief: EMPTY_BRIEF, understanding: null, answers: {}, confirmed: null, generation: null, designs: [], ratings: {},
  designId: null, source: null, history: null, gestureBase: null, checkout: EMPTY_CHECKOUT,
};

export const flowStore = createStore<FlowState>(initial, {
  key: 'flow.v1',
  // History is rebuilt from the current spec on restore: 60 steps of multi-MB logos is too much to store.
  pick: (s) => ({
    brief: s.brief, understanding: s.understanding, answers: s.answers, confirmed: s.confirmed, generation: s.generation,
    designs: s.designs, ratings: s.ratings, designId: s.designId, source: s.source,
    history: s.history ? { past: [], present: s.history.present, future: [] } : null,
    checkout: s.checkout,
  }),
});

export function useFlow<T>(select: (s: FlowState) => T): T {
  return useStore(flowStore, select);
}

export const currentSpec = (s: FlowState): DesignSpec | null => s.history?.present ?? null;

export function unansweredQuestions(u: Understanding | null, answers: Record<string, string>): Question[] {
  return (u?.questions ?? []).filter((q) => !(q.id in answers));
}

export function canGenerate(s: Pick<FlowState, 'understanding' | 'answers' | 'confirmed'>): boolean {
  return !!s.confirmed && !!s.confirmed.sport && unansweredQuestions(s.understanding, s.answers).length === 0
    && s.confirmed.prompt.trim().length >= 3;
}

function confirmedFrom(u: Understanding, brief: Brief): Confirmed {
  return {
    prompt: brief.prompt, garment: u.garment, sport: u.sport, locked_colors: brief.locked_colors,
    // Where the prompt and form disagree the form value is kept until the customer answers.
    team_name: u.team_name.value, player_name: u.player_name.value, number: u.number.value,
  };
}

const get = flowStore.get;
const set = flowStore.set;

export const flow = {
  setBrief: (patch: Partial<Brief>) => set({ brief: { ...get().brief, ...patch } }),

  understand: async (language: Language, signal?: AbortSignal) => {
    const { brief } = get();
    const u = await api.understand({
      prompt: brief.prompt, garment: brief.garment, team_name: brief.team_name, player_name: brief.player_name,
      number: brief.number, locked_colors: brief.locked_colors, language,
    }, signal);
    set({ understanding: u, answers: {}, confirmed: confirmedFrom(u, brief) });
    return u;
  },

  answer: (q: Question, value: string) => {
    const confirmed = get().confirmed;
    if (!confirmed) return;
    set({ answers: { ...get().answers, [q.id]: value }, confirmed: { ...confirmed, [q.field]: value } });
  },

  editConfirmed: (patch: Partial<Confirmed>) => {
    const { confirmed, understanding, answers } = get();
    if (!confirmed) return;
    // Typing a value directly settles any question about that field.
    const settled = { ...answers };
    for (const q of understanding?.questions ?? []) {
      const v = patch[q.field as keyof Confirmed];
      if (typeof v === 'string' && v) settled[q.id] = v;
    }
    set({ confirmed: { ...confirmed, ...patch }, answers: settled });
  },

  generate: async (language: Language, more = false) => {
    const s = get();
    if (!canGenerate(s)) throw new Error('brief not confirmed');
    const c = s.confirmed!;
    const res = await api.generate({
      prompt: c.prompt, garment: c.garment, sport: c.sport, team_name: c.team_name, player_name: c.player_name,
      number: c.number, locked_colors: c.locked_colors, variants: 4, language,
    });
    const { designs, ...meta } = res;
    set({ generation: meta, designs: more ? [...get().designs, ...designs] : designs });
    return designs;
  },

  showDesigns: (res: GenerateResponse) => {
    const { designs, ...meta } = res;
    set({ generation: meta, designs });
  },

  rate: async (designId: string, rating: number) => {
    const prev = get().ratings[designId];
    set({ ratings: { ...get().ratings, [designId]: rating } });
    const design = get().designs.find((d) => d.id === designId);
    try {
      await api.feedback(designId, { rating, spec: design?.spec });
    } catch (e) {
      const ratings = { ...get().ratings };
      if (prev === undefined) delete ratings[designId];
      else ratings[designId] = prev;
      set({ ratings });
      throw e;
    }
  },

  /** Open a design in the studio. A new design resets the checkout's order key but keeps contact details. */
  openSpec: (spec: DesignSpec, designId: string | null, source: DesignSource) => set({
    designId: designId || null, source, history: createHistory(spec), gestureBase: null,
    checkout: { ...get().checkout, idempotencyKey: null, keyFor: null, collectionId: '', collectionTitle: '', cartKey: null },
  }),

  openDesign: (design: Design, source: DesignSource = 'generated') => flow.openSpec(design.spec, design.id, source),

  /** A stable design id for sharing and saving; designs without one get a fresh id the server can restore. */
  ensureDesignId: () => {
    const id = get().designId;
    if (id) return id;
    const fresh = newId('web');
    set({ designId: fresh });
    return fresh;
  },

  edit: (spec: DesignSpec) => {
    const h = get().history;
    if (h) set({ history: push(h, spec) });
  },
  live: (spec: DesignSpec) => {
    const h = get().history;
    if (h) set({ history: replace(h, spec) });
  },
  beginGesture: () => set({ gestureBase: get().history?.present ?? null }),
  endGesture: () => {
    const { history, gestureBase } = get();
    if (history && gestureBase) set({ history: commitFrom(history, gestureBase), gestureBase: null });
    else set({ gestureBase: null });
  },
  undo: () => {
    const h = get().history;
    if (h && canUndo(h)) set({ history: undo(h), gestureBase: null });
  },
  redo: () => {
    const h = get().history;
    if (h && canRedo(h)) set({ history: redo(h), gestureBase: null });
  },

  setCheckout: (patch: Partial<CheckoutDraft> | ((c: CheckoutDraft) => Partial<CheckoutDraft>)) => {
    const cur = get().checkout;
    const p = typeof patch === 'function' ? patch(cur) : patch;
    set({ checkout: { ...cur, ...p } });
  },

  /** Same payload -> same key (safe retry); a changed order -> a new key. */
  keyForPayload: (payloadHash: string) => {
    const c = get().checkout;
    if (c.idempotencyKey && c.keyFor === payloadHash) return c.idempotencyKey;
    const key = newIdempotencyKey();
    set({ checkout: { ...c, idempotencyKey: key, keyFor: payloadHash } });
    return key;
  },

  /** After a successful order: keep contact details and delivery, clear the roster and key. */
  orderPlaced: () => {
    const c = get().checkout;
    set({ checkout: { ...EMPTY_CHECKOUT, customer: c.customer, address: c.address, method: c.method } });
  },

  resetDesign: () => set({
    brief: { ...EMPTY_BRIEF, garment: get().brief.garment }, understanding: null, answers: {}, confirmed: null,
    generation: null, designs: [], ratings: {}, designId: null, source: null, history: null, gestureBase: null,
  }),
};

export function rowKey(): string {
  return newId('row');
}
