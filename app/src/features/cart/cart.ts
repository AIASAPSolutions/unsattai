import type { CartItem, CartQuote, Garment, OrderItem, SellerRef } from '../../api/types';

// The cart as the app keeps it: server-shaped items plus what the app needs to
// show them (a title and a picture). The server merges the same way on sign-in:
// identical items are skipped and the cart stops at 20.

export const MAX_CART_ITEMS = 20;
export const MAX_LINE_QTY = 500;

export interface CartLine {
  key: string;
  item: CartItem;
  title: string;
  /** Products: the picture path on the API and the slug for the product page. */
  image?: string;
  slug?: string;
  garment?: Garment;
}

/** Stable text for an item, ignoring key order and empty optional fields, as the server compares them. */
export function itemSignature(item: CartItem): string {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
      return Object.keys(v as object).sort().reduce<Record<string, unknown>>((o, k) => {
        const x = (v as Record<string, unknown>)[k];
        if (x === undefined || x === null || x === '') return o;
        o[k] = clean(x);
        return o;
      }, {});
    }
    return v;
  };
  const { logos, ...rest } = item;
  return JSON.stringify(clean({ ...rest, logos: logos || undefined }));
}

export function sameItem(a: CartItem, b: CartItem): boolean {
  return itemSignature(a) === itemSignature(b);
}

export function linePieces(item: CartItem): number {
  return item.lines.reduce((n, l) => n + (Number.isFinite(l.quantity) ? l.quantity : 0), 0);
}

export function cartPieces(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + linePieces(l.item), 0);
}

/** A plain product in one size: adding it again only raises the quantity. */
function mergeableQty(a: CartItem, b: CartItem): boolean {
  if (!a.product_id || a.product_id !== b.product_id) return false;
  if (a.lines.length !== 1 || b.lines.length !== 1) return false;
  const [x, y] = [a.lines[0], b.lines[0]];
  const sameLine = x.size === y.size && x.player_name === y.player_name && x.number === y.number;
  return sameLine && a.fabric === b.fabric && (a.seller_id || '') === (b.seller_id || '');
}

export type AddResult = { lines: CartLine[]; outcome: 'added' | 'merged' | 'full'; key: string | null };

export function addLine(lines: CartLine[], line: CartLine): AddResult {
  const i = lines.findIndex((l) => mergeableQty(l.item, line.item));
  if (i >= 0) {
    const cur = lines[i];
    const qty = Math.min(MAX_LINE_QTY, cur.item.lines[0].quantity + line.item.lines[0].quantity);
    const next = { ...cur, item: { ...cur.item, lines: [{ ...cur.item.lines[0], quantity: qty }] } };
    return { lines: lines.map((l, j) => (j === i ? next : l)), outcome: 'merged', key: cur.key };
  }
  if (lines.length >= MAX_CART_ITEMS) return { lines, outcome: 'full', key: null };
  return { lines: [...lines, line], outcome: 'added', key: line.key };
}

/** Change the quantity of a one-line item (product or single custom piece). */
export function setLineQuantity(line: CartLine, quantity: number): CartLine {
  if (line.item.lines.length !== 1) return line;
  const q = Math.max(1, Math.min(MAX_LINE_QTY, Math.round(quantity) || 1));
  return { ...line, item: { ...line.item, lines: [{ ...line.item.lines[0], quantity: q }] } };
}

/** The same rule as POST /me/cart/merge: saved items first, then device items not already there, up to 20. */
export function mergeLines(saved: CartLine[], device: CartLine[]): CartLine[] {
  const out = [...saved];
  const seen = new Set(saved.map((l) => itemSignature(l.item)));
  for (const l of device) {
    const sig = itemSignature(l.item);
    if (!seen.has(sig) && out.length < MAX_CART_ITEMS) {
      out.push(l);
      seen.add(sig);
    }
  }
  return out;
}

export function toServerItems(lines: CartLine[]): CartItem[] {
  return lines.map((l) => l.item);
}

/**
 * Lines for items the server sent back. Titles and pictures are kept from the
 * device's own copy of the same item where there is one; otherwise the next
 * cart quote fills in the title.
 */
export function fromServerItems(items: CartItem[], known: CartLine[], newKey: () => string): CartLine[] {
  const pool = [...known];
  return items.map((item) => {
    const i = pool.findIndex((l) => sameItem(l.item, item));
    const prev = i >= 0 ? pool.splice(i, 1)[0] : undefined;
    return {
      key: prev?.key ?? newKey(),
      item,
      title: prev?.title ?? '',
      image: prev?.image,
      slug: prev?.slug,
      garment: prev?.garment ?? item.garment ?? item.spec?.garment,
    };
  });
}

export interface SellerGroup {
  seller: SellerRef | null;
  deliveryDate: string | null;
  indexes: number[];
}

/** Items grouped by who makes and ships them, in cart order: one delivery charge and one date per seller. */
export function groupBySeller(quote: CartQuote): SellerGroup[] {
  const groups: SellerGroup[] = [];
  for (const it of quote.items) {
    const id = it.seller?.id ?? '';
    let g = groups.find((x) => (x.seller?.id ?? '') === id);
    if (!g) {
      g = { seller: it.seller, deliveryDate: it.delivery_date, indexes: [] };
      groups.push(g);
    }
    g.indexes.push(it.index);
    if (it.delivery_date && (!g.deliveryDate || it.delivery_date > g.deliveryDate)) g.deliveryDate = it.delivery_date;
  }
  return groups;
}

/** "Priya 10 · S × 1, Arul 7 · XL × 2" for a roster, "M × 2" for a plain piece. */
export function linesSummary(lines: OrderItem[], max = 3): string {
  const parts = lines.slice(0, max).map((l) => {
    const who = [l.player_name, l.number].filter(Boolean).join(' ');
    return `${who ? `${who} · ` : ''}${l.size} × ${l.quantity}`;
  });
  return lines.length > max ? `${parts.join(', ')} …` : parts.join(', ');
}
