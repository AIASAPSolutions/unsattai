import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/endpoints';
import type {
  Address,
  Design, DesignSpec, Fit, Garment, GarmentOptions, GenerateResponse, Language, Order, OrderItem, Question, Size, Understanding,
} from '../api/types';
import { canRedo, canUndo, commitFrom, createHistory, push, redo, replace, undo, type History } from '../lib/history';
import { newIdempotencyKey } from '../lib/ids';
import { pickedOptions } from '../lib/sizing';
import { draftStorage } from './storage';

// The customer journey as one store: brief -> understanding -> confirmed brief ->
// designs -> studio (spec with undo history) -> order draft -> placed order.
// Persisted parts let a customer come back after the app is killed.

export interface Brief {
  prompt: string;
  garment: Garment;
  locked_colors: string[];
  team_name: string;
  player_name: string;
  number: string;
  /** Sleeves and collar the customer picked on the confirm screen (missing in older drafts). */
  options?: GarmentOptions;
}

export interface Confirmed extends Brief {
  sport: string | null;
}

export type OrderMode = 'single' | 'team';

export interface RosterRow extends OrderItem {
  key: string;
}

export interface Commerce {
  fabric: string;
  method: 'ship' | 'pickup';
  address: Address;
  rush: boolean;
  coupon: string;
}

export const EMPTY_ADDRESS: Address = { line1: '', line2: '', city: '', state: '', pincode: '' };
export const EMPTY_COMMERCE: Commerce = { fabric: 'standard', method: 'ship', address: EMPTY_ADDRESS, rush: false, coupon: '' };

export interface OrderDraft {
  mode: OrderMode;
  commerce: Commerce;
  /** fit is missing in drafts saved before fits existed: men's. */
  single: { fit?: Fit; size: Size; quantity: number };
  rows: RosterRow[];
  customer: { name: string; phone: string; email: string };
  idempotencyKey: string | null;
  /** Payload the key was issued for: a changed order gets a new key, a retry reuses it. */
  keyFor: string | null;
}

export const EMPTY_BRIEF: Brief = {
  prompt: '', garment: 'jersey', locked_colors: [], team_name: '', player_name: '', number: '',
};

const EMPTY_ORDER: OrderDraft = {
  mode: 'single',
  commerce: EMPTY_COMMERCE,
  single: { fit: 'men', size: 'M', quantity: 1 },
  rows: [],
  customer: { name: '', phone: '', email: '' },
  idempotencyKey: null,
  keyFor: null,
};

/** Drafts saved by older versions have no commerce options yet: fill them with defaults. */
export function mergePersisted<S extends { order: OrderDraft }>(persisted: unknown, current: S): S {
  const p = (persisted ?? {}) as Partial<S>;
  const order = { ...EMPTY_ORDER, ...p.order } as OrderDraft;
  return { ...current, ...p, order: { ...order, commerce: { ...EMPTY_COMMERCE, ...order.commerce } } };
}

interface FlowState {
  brief: Brief;
  understanding: Understanding | null;
  answers: Record<string, string>;
  confirmed: Confirmed | null;
  generation: Omit<GenerateResponse, 'designs'> | null;
  designs: Design[];
  ratings: Record<string, number>;

  designId: string | null;
  /** Set when the design being edited started from a shop product. */
  product: { id: string; slug: string; title: string } | null;
  history: History<DesignSpec> | null;
  gestureBase: DesignSpec | null;

  order: OrderDraft;
  lastOrder: Order | null;

  // brief
  setBrief: (patch: Partial<Brief>) => void;
  understand: (language: Language, signal?: AbortSignal) => Promise<Understanding>;
  answer: (q: Question, value: string) => void;
  editConfirmed: (patch: Partial<Confirmed>) => void;
  // designs
  generate: (language: Language, more?: boolean) => Promise<Design[]>;
  rate: (designId: string, rating: number) => Promise<void>;
  /** Designs rebuilt from an uploaded picture replace the current list. */
  showDesigns: (res: GenerateResponse) => void;
  // studio
  openDesign: (design: Design) => void;
  /** Customise a ready-made product in the studio. */
  openProduct: (p: { id: string; slug: string; title: string; spec: DesignSpec }) => void;
  edit: (spec: DesignSpec) => void;
  live: (spec: DesignSpec) => void;
  beginGesture: () => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  // order
  setOrder: (patch: Partial<OrderDraft>) => void;
  keyForPayload: (payloadHash: string) => string;
  setLastOrder: (o: Order | null) => void;
  reset: () => void;
}

export function unansweredQuestions(u: Understanding | null, answers: Record<string, string>): Question[] {
  return (u?.questions ?? []).filter((q) => !(q.id in answers));
}

export function canGenerate(s: Pick<FlowState, 'understanding' | 'answers' | 'confirmed'>): boolean {
  return !!s.confirmed && !!s.confirmed.sport && unansweredQuestions(s.understanding, s.answers).length === 0
    && s.confirmed.prompt.trim().length >= 3;
}

function confirmedFrom(u: Understanding, brief: Brief): Confirmed {
  return {
    prompt: brief.prompt,
    garment: u.garment,
    sport: u.sport,
    locked_colors: brief.locked_colors,
    // Where the prompt and form disagree the form value is kept until the customer answers.
    team_name: u.team_name.value,
    player_name: u.player_name.value,
    number: u.number.value,
    options: brief.options,
  };
}

export const useFlow = create<FlowState>()(
  persist(
    (set, get) => ({
      brief: EMPTY_BRIEF,
      understanding: null,
      answers: {},
      confirmed: null,
      generation: null,
      designs: [],
      ratings: {},
      designId: null,
      product: null,
      history: null,
      gestureBase: null,
      order: EMPTY_ORDER,
      lastOrder: null,

      setBrief: (patch) => set({ brief: { ...get().brief, ...patch } }),

      understand: async (language, signal) => {
        const { brief } = get();
        const u = await api.understand({
          prompt: brief.prompt, garment: brief.garment, team_name: brief.team_name,
          player_name: brief.player_name, number: brief.number, locked_colors: brief.locked_colors, language,
        }, signal);
        set({ understanding: u, answers: {}, confirmed: confirmedFrom(u, brief) });
        return u;
      },

      answer: (q, value) => {
        const confirmed = get().confirmed;
        if (!confirmed) return;
        set({
          answers: { ...get().answers, [q.id]: value },
          confirmed: { ...confirmed, [q.field]: value },
        });
      },

      editConfirmed: (patch) => {
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

      generate: async (language, more = false) => {
        const s = get();
        if (!canGenerate(s)) throw new Error('brief not confirmed');
        const c = s.confirmed!;
        const res = await api.generate({
          prompt: c.prompt, garment: c.garment, sport: c.sport, team_name: c.team_name, player_name: c.player_name,
          number: c.number, locked_colors: c.locked_colors, variants: 4, language,
          ...(pickedOptions(c.garment, c.options) ? { options: pickedOptions(c.garment, c.options) } : {}),
        });
        const { designs, ...meta } = res;
        set({ generation: meta, designs: more ? [...get().designs, ...designs] : designs });
        return designs;
      },

      showDesigns: (res) => {
        const { designs, ...meta } = res;
        set({ generation: meta, designs });
      },

      rate: async (designId, rating) => {
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

      openDesign: (design) => set({
        designId: design.id, product: null, history: createHistory(design.spec), gestureBase: null,
        order: { ...get().order, idempotencyKey: null, keyFor: null },
      }),

      openProduct: (p) => set({
        // The product id keys the studio's one-time layer set-up; orders send it as a custom design.
        designId: p.id, product: { id: p.id, slug: p.slug, title: p.title }, history: createHistory(p.spec), gestureBase: null,
        order: { ...get().order, idempotencyKey: null, keyFor: null },
      }),

      edit: (spec) => {
        const h = get().history;
        if (h) set({ history: push(h, spec) });
      },

      live: (spec) => {
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
        if (h && canUndo(h)) set({ history: undo(h) });
      },

      redo: () => {
        const h = get().history;
        if (h && canRedo(h)) set({ history: redo(h) });
      },

      setOrder: (patch) => set({ order: { ...get().order, ...patch } }),

      keyForPayload: (payloadHash) => {
        const o = get().order;
        if (o.idempotencyKey && o.keyFor === payloadHash) return o.idempotencyKey;
        const key = newIdempotencyKey();
        set({ order: { ...o, idempotencyKey: key, keyFor: payloadHash } });
        return key;
      },

      setLastOrder: (lastOrder) => set({ lastOrder }),

      reset: () => set({
        brief: { ...EMPTY_BRIEF, garment: get().brief.garment }, understanding: null, answers: {}, confirmed: null,
        generation: null, designs: [], ratings: {}, designId: null, product: null, history: null, gestureBase: null,
        order: { ...EMPTY_ORDER, customer: get().order.customer }, lastOrder: null,
      }),
    }),
    {
      name: 'urjersey.flow',
      storage: draftStorage,
      version: 1,
      // History is rebuilt from the current spec on restore: 60 steps of multi-MB logos is too much to store.
      partialize: (s) => ({
        brief: s.brief, understanding: s.understanding, answers: s.answers, confirmed: s.confirmed,
        generation: s.generation, designs: s.designs, ratings: s.ratings, designId: s.designId, product: s.product,
        history: s.history ? { past: [], present: s.history.present, future: [] } : null,
        // Contact details are only kept when the customer opts in (prefs.customer), never in the draft.
        // The delivery address is personal too: it is re-typed (or remembered with the contact details).
        order: { ...s.order, customer: { name: '', phone: '', email: '' }, commerce: { ...s.order.commerce, address: EMPTY_ADDRESS } },
        lastOrder: s.lastOrder,
      }),
      merge: mergePersisted,
    },
  ),
);

export const currentSpec = (s: FlowState): DesignSpec | null => s.history?.present ?? null;
