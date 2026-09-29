/** Production details of an order: print files, the measurement sheet, measurements and piece sizes. Pure: unit tested. */
import { FIT_LABEL, SLEEVE_LABEL, COLLAR_LABEL, type Fit, type Measurements, type Order, type OrderLine } from './types';

/** The vector sheet with every line's fit, size, quantity, measurements and piece sizes (server orders.SHEET_NAME). */
export const MEASUREMENT_SHEET = 'measurements.svg';

/**
 * Where a print file or sheet comes from. Production staff and seller logins use the ops route (GET, bearer token);
 * other roles keep the design route (POST), like the existing print-file downloads.
 */
export function printFileRequest(orderId: string, name: string, canProduction: boolean): { path: string; method: 'GET' | 'POST' } {
  const n = encodeURIComponent(name);
  return canProduction
    ? { path: `/ops/orders/${orderId}/print-files/${n}`, method: 'GET' }
    : { path: `/orders/${orderId}/files/${n}`, method: 'POST' };
}

export const fitOf = (l: { fit?: Fit }): Fit => l.fit ?? 'men';
/** "Kids 8Y", "Women S", "M" (men / unisex is the default and not repeated). */
export function fitSize(l: { fit?: Fit; size: string }, always = false): string {
  const f = fitOf(l);
  return f === 'men' && !always ? l.size : `${FIT_LABEL[f].split(' /')[0]} ${l.size}`;
}

const MEASURE_ORDER: [keyof Measurements, string][] = [
  ['chest', 'Chest'], ['length', 'Length'], ['shoulder', 'Shoulder'], ['sleeve', 'Sleeve'], ['waist', 'Waist'], ['hip', 'Hip'],
];
/** Measurement columns present in any of the lines, in sheet order. */
export function measureColumns(lines: Pick<OrderLine, 'measurements'>[]): [keyof Measurements, string][] {
  return MEASURE_ORDER.filter(([k]) => lines.some((l) => l.measurements?.[k] !== undefined));
}

const PIECE_LABEL: Record<string, string> = { front: 'Front', back: 'Back', sleeve_left: 'Left sleeve', sleeve_right: 'Right sleeve' };
export const pieceLabel = (p: string) => PIECE_LABEL[p] ?? p.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** {front:[600,760], back:[600,760], sleeve_left:[511,650], sleeve_right:[511,650]} -> [["Front, back", "600 × 760"], ["Sleeves (2)", "511 × 650"]]. */
export function piecesParts(pieces: Record<string, [number, number]> | undefined): [string, string][] {
  if (!pieces) return [];
  const groups = new Map<string, string[]>();
  for (const [name, [w, h]] of Object.entries(pieces)) {
    const k = `${w}\u00a0×\u00a0${h}`; // no-break spaces: a size never wraps inside itself
    groups.set(k, [...(groups.get(k) ?? []), name]);
  }
  return [...groups.entries()].map(([size, names]) => {
    const label = names.length === 2 && names.every((n) => n.startsWith('sleeve_')) ? 'Sleeves (2)'
      : names.map((n, i) => (i ? pieceLabel(n).toLowerCase() : pieceLabel(n))).join(', ');
    return [label, size];
  });
}
/** Same as piecesParts, one string per group: "Front, back 600 × 760". */
export function piecesText(pieces: Record<string, [number, number]> | undefined): string[] {
  return piecesParts(pieces).map(([label, size]) => `${label} ${size}`);
}

export interface LineFiles { line: OrderLine | undefined; lineNo: number; files: Order['files'] }
/** Print files grouped by order line, in line order. */
export function filesByLine(o: Pick<Order, 'files' | 'lines'>): LineFiles[] {
  const by = new Map<number, Order['files']>();
  for (const f of o.files) by.set(f.line, [...(by.get(f.line) ?? []), f]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([lineNo, files]) => ({ lineNo, files, line: o.lines.find((l) => l.line === lineNo) }));
}

/** "Long sleeves · Polo collar" from order.options (falling back to the spec for older orders). */
export function optionsText(o: Pick<Order, 'options' | 'garment' | 'spec'>): string[] {
  if (o.garment === 'shorts') return [];
  const sleeves = o.options?.sleeves ?? (o.spec?.sleeves as keyof typeof SLEEVE_LABEL | undefined) ?? 'short';
  const out = [SLEEVE_LABEL[sleeves] ?? sleeves];
  if (o.garment === 'jersey') {
    const collar = o.options?.collar ?? (o.spec?.collar as keyof typeof COLLAR_LABEL | undefined) ?? 'crew';
    out.push(COLLAR_LABEL[collar] ?? collar);
  }
  return out;
}
