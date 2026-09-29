import type { ApiCartItem, Collar, DesignSpec, Fit, Garment, OrderItem, Sleeves } from './api/types';
import { fitSizeSummary, normaliseFit } from './sizing';

// Cart items: a ready-made product or the customer's own design, each with its fabric,
// seller choice and roster lines. Pure helpers (no React, no storage) so they are easy
// to test; the store and server sync live in lib/cartStore.ts.

export const MAX_CART_ITEMS = 20;
export const MAX_ITEM_PIECES = 5000;

export interface CartEntry {
  /** Local key for React lists and edits; never sent to the server. */
  key: string;
  product_id: string;
  spec: DesignSpec | null;
  design_id: string;
  garment: Garment | null;
  fabric: string;
  logos: number;
  lines: OrderItem[];
  seller_id: string;
  /** Products only: the colourway and sleeve and collar choices (empty = the product's own). */
  colourway?: string;
  sleeves?: Sleeves | '';
  collar?: Collar | '';
}

export type NewEntry = Omit<CartEntry, 'key'>;

let counter = 0;
export function entryKey(): string {
  counter += 1;
  return `c${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function productEntry(productId: string, fabric: string, lines: OrderItem[], sellerId = '',
  choice: { colourway?: string; sleeves?: Sleeves | ''; collar?: Collar | '' } = {}): NewEntry {
  return {
    product_id: productId, spec: null, design_id: '', garment: null, fabric, logos: 0, lines, seller_id: sellerId,
    colourway: choice.colourway && choice.colourway !== 'original' ? choice.colourway : '',
    sleeves: choice.sleeves ?? '', collar: choice.collar ?? '',
  };
}

/** A line as the API takes it; lines saved before fits existed are men / unisex. */
export function apiLine({ player_name, number, fit, size, quantity }: OrderItem): OrderItem {
  return { player_name, number, fit: normaliseFit(fit), size, quantity };
}

export function designEntry(spec: DesignSpec, designId: string, fabric: string, lines: OrderItem[]): NewEntry {
  return { product_id: '', spec, design_id: (designId || '').slice(0, 40), garment: null, fabric, logos: 0, lines, seller_id: '' };
}

/** The item as POST /shop/cart/quote, PUT /me/cart and POST /checkout take it. */
export function toApiItem(e: NewEntry | CartEntry): ApiCartItem {
  const base: ApiCartItem = {
    fabric: e.fabric, logos: e.logos,
    lines: e.lines.map(apiLine),
    seller_id: e.seller_id,
  };
  if (e.garment) base.garment = e.garment;
  if (e.product_id) {
    return {
      product_id: e.product_id, ...base,
      ...(e.colourway ? { colourway: e.colourway } : {}), ...(e.sleeves ? { sleeves: e.sleeves } : {}), ...(e.collar ? { collar: e.collar } : {}),
    };
  }
  return { spec: e.spec, design_id: e.design_id, ...base };
}

/** Rebuild local entries from the server cart, keeping the keys of items that did not change. */
export function fromApiItems(items: ApiCartItem[], prev: CartEntry[] = []): CartEntry[] {
  const unused = [...prev];
  return items.map((it) => {
    const entry: NewEntry = {
      product_id: it.product_id ?? '', spec: it.spec ?? null, design_id: it.design_id ?? '', garment: it.garment ?? null,
      fabric: it.fabric || 'standard', logos: it.logos ?? 0,
      lines: (it.lines ?? []).map(({ player_name, number, fit, size, quantity }) => ({
        player_name: player_name ?? '', number: number ?? '', fit: normaliseFit(fit), size, quantity,
      })),
      seller_id: it.seller_id ?? '',
      colourway: it.colourway ?? '', sleeves: it.sleeves ?? '', collar: it.collar ?? '',
    };
    const i = unused.findIndex((p) => sameItem(p, entry));
    const key = i >= 0 ? unused.splice(i, 1)[0].key : entryKey();
    return { ...entry, key };
  });
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Identical items (same design, fabric, seller and lines); the server skips these on merge. */
export function sameItem(a: NewEntry | CartEntry, b: NewEntry | CartEntry): boolean {
  return stable(toApiItem(a)) === stable(toApiItem(b));
}

/** Same thing to make (design, garment, fabric, seller) regardless of the lines. */
export function sameProduct(a: NewEntry | CartEntry, b: NewEntry | CartEntry): boolean {
  const strip = (e: NewEntry | CartEntry) => ({ ...toApiItem(e), lines: [] });
  return stable(strip(a)) === stable(strip(b));
}

export const itemPieces = (e: Pick<CartEntry, 'lines'>) => e.lines.reduce((n, l) => n + (l.quantity || 0), 0);
export const cartPieces = (items: Pick<CartEntry, 'lines'>[]) => items.reduce((n, e) => n + itemPieces(e), 0);

/** Lines with the same name, number, fit and size are one line with the quantities added up. */
export function mergeLines(a: OrderItem[], b: OrderItem[]): OrderItem[] {
  const out = a.map((l) => ({ ...l }));
  for (const l of b) {
    const hit = out.find((x) => x.player_name === l.player_name && x.number === l.number && x.size === l.size
      && normaliseFit(x.fit) === normaliseFit(l.fit));
    if (hit) hit.quantity = Math.min(500, hit.quantity + l.quantity);
    else out.push({ ...l });
  }
  return out;
}

export type AddResult = { items: CartEntry[]; key: string; outcome: 'added' | 'combined' } | { items: CartEntry[]; outcome: 'full' | 'too_many' };

/**
 * Add to cart the way big stores do: the same product (same fabric and seller) again adds
 * to its quantities instead of making a second row. A full cart refuses the item.
 */
export function addToCart(items: CartEntry[], entry: NewEntry): AddResult {
  const same = entry.product_id ? items.find((e) => sameProduct(e, entry)) : undefined;
  if (same) {
    const lines = mergeLines(same.lines, entry.lines);
    if (itemPieces({ lines }) > MAX_ITEM_PIECES || lines.length > 200) return { items, outcome: 'too_many' };
    return { items: items.map((e) => (e === same ? { ...e, lines } : e)), key: same.key, outcome: 'combined' };
  }
  if (items.length >= MAX_CART_ITEMS) return { items, outcome: 'full' };
  const key = entryKey();
  return { items: [...items, { ...entry, key }], key, outcome: 'added' };
}

/**
 * What a guest's device cart looks like after signing in, the way POST /me/cart/merge
 * works: saved items first, then device items that are not already there, up to the limit.
 * Used to show the result straight away and as the fallback when the server is unreachable.
 */
export function mergeCarts(saved: CartEntry[], device: CartEntry[], max = MAX_CART_ITEMS): { items: CartEntry[]; skipped: number } {
  const out = [...saved];
  let skipped = 0;
  for (const d of device) {
    if (out.some((s) => sameItem(s, d))) continue;
    if (out.length >= max) {
      skipped += 1;
      continue;
    }
    out.push(d);
  }
  return { items: out, skipped };
}

/**
 * One-line description of an item's pieces: "M × 2, L × 1" (sizes in chart order). When
 * any line is not men / unisex, each size says its fit: "Women S × 1, Kids 8Y × 2".
 */
export function linesSummary(lines: OrderItem[], fitLabel: (f: Fit) => string = (f) => f): string {
  return fitSizeSummary(lines, fitLabel);
}

/** Change the quantity of a one-line item (products bought by size). */
export function setSingleQuantity(e: CartEntry, quantity: number): CartEntry {
  if (e.lines.length !== 1) return e;
  return { ...e, lines: [{ ...e.lines[0], quantity: Math.max(1, Math.min(500, Math.floor(quantity) || 1)) }] };
}
