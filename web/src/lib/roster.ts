import { normalizeDigits } from './digits';
import { ALL_SIZES, TEXT_LIMITS, type Fit, type OrderItem, type Size } from './api/types';
import { fitSizeBreakdown, isFitSize } from './sizing';

// Ported from the mobile app (app/src/lib/roster.ts), plus CSV import and duplicate checks.
// Parses a pasted roster, one player per line, in any of these shapes:
//   Arul, 7, M, 2          (name, number, size, quantity)
//   Priya Sharma - 10 - XL
//   7 Arul L x3
//   Name<TAB>No<TAB>Size   (copied from a spreadsheet; a header row is skipped)
//   Kavin, 4, 8Y           (kids' sizes are kids' fit)
//   Priya, 10, women, S    (a fit word: men, women/ladies, kids)
// Names keep their exact spelling and script. Quantity defaults to 1, fit to men / unisex.

export type RosterIssue = 'size' | 'nameTooLong' | 'number' | 'quantity' | 'empty';

export interface RosterError {
  line: number;
  text: string;
  issue: RosterIssue;
}

export interface RosterResult {
  rows: OrderItem[];
  errors: RosterError[];
}

const SIZE_ALIASES: Record<string, Size> = {
  XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL', '2XL': 'XXL', '3XL': '3XL', XXXL: '3XL',
  SMALL: 'S', MEDIUM: 'M', LARGE: 'L', 'X-LARGE': 'XL', 'XX-LARGE': 'XXL', 'EXTRA SMALL': 'XS',
  '4Y': '4Y', '6Y': '6Y', '8Y': '8Y', '10Y': '10Y', '12Y': '12Y', '14Y': '14Y',
};
const FIT_WORDS: Record<string, Fit> = {
  MEN: 'men', MENS: 'men', "MEN'S": 'men', UNISEX: 'men', MALE: 'men',
  WOMEN: 'women', WOMENS: 'women', "WOMEN'S": 'women', LADIES: 'women', FEMALE: 'women',
  KIDS: 'kids', KID: 'kids', CHILD: 'kids', CHILDREN: 'kids', YOUTH: 'kids', JUNIOR: 'kids',
};
const HEADER = /^(name|player|player name|नाम|పేరు|பெயர்)\b.*\b(size|no|number|#)/i;

function toSize(token: string): Size | null {
  const t = token.trim().toUpperCase().replace(/\s+/g, '');
  const kid = /^(\d{1,2})(?:Y|YR|YRS|YEARS?)$/.exec(t);
  return SIZE_ALIASES[kid ? `${kid[1]}Y` : t] ?? null;
}

function toFit(token: string): Fit | null {
  return FIT_WORDS[token.trim().toUpperCase()] ?? null;
}

/**
 * Kids' sizes (8Y) mean the kids' fit; otherwise the fit named on the line, else men / unisex.
 * null when the named fit and the size disagree ("women, 8Y" or "kids, M").
 */
function fitFor(size: Size, named: Fit | null): Fit | null {
  const kid = /Y$/.test(size);
  if (named) return (named === 'kids') === kid ? named : null;
  return kid ? 'kids' : 'men';
}

function toQuantity(token: string): number | null {
  const m = /^(?:x|×|qty:?|quantity:?)\s*(\d{1,4})$|^(\d{1,4})\s*(?:x|×|pcs?|pieces?)$/i.exec(token.trim());
  if (!m) return null;
  return Number(m[1] ?? m[2]);
}

export function parseRosterLine(text: string, defaultSize?: Size): OrderItem | RosterIssue {
  const clean = normalizeDigits(text).trim();
  if (!clean) return 'empty';
  const delimited = /[\t,;|]| - /.test(clean);
  let tokens = delimited
    ? clean.split(/\t|,|;|\||\s-\s/).map((t) => t.trim()).filter(Boolean)
    : clean.split(/\s+/);
  // "qty 3" / "x 3" written with a space
  tokens = tokens.reduce<string[]>((acc, t) => {
    const prev = acc[acc.length - 1];
    if (prev && /^(x|×|qty:?|quantity:?)$/i.test(prev) && /^\d+$/.test(t)) acc[acc.length - 1] = `${prev}${t}`;
    else acc.push(t);
    return acc;
  }, []);

  let size: Size | null = null;
  let fit: Fit | null = null;
  let quantity: number | null = null;
  const numbers: string[] = [];
  const nameParts: string[] = [];

  for (const tok of tokens) {
    const q = toQuantity(tok);
    if (q !== null && quantity === null) {
      quantity = q;
      continue;
    }
    const s = toSize(tok);
    if (s && !size) {
      size = s;
      continue;
    }
    const f = toFit(tok);
    if (f && !fit) {
      fit = f;
      continue;
    }
    if (/^#?\d+$/.test(tok)) {
      numbers.push(tok.replace('#', ''));
      continue;
    }
    nameParts.push(tok);
  }
  // First bare number is the shirt number; a second one is the quantity (unless "x3" gave it).
  if (numbers.length > (quantity === null ? 2 : 1)) return 'number';
  const number = numbers[0] ?? null;
  if (quantity === null && numbers.length === 2) quantity = Number(numbers[1]);

  const player_name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  if (!size) size = defaultSize ?? null;
  if (!size) return 'size';
  const rowFit = fitFor(size, fit);
  if (!rowFit || !isFitSize(rowFit, size)) return 'size';
  if (player_name.length > TEXT_LIMITS.player_name) return 'nameTooLong';
  if (number !== null && !/^\d{1,3}$/.test(number)) return 'number';
  const qty = quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 500) return 'quantity';
  return { player_name, number: number ?? '', fit: rowFit, size, quantity: qty };
}

export function parseRoster(text: string, defaultSize?: Size): RosterResult {
  const rows: OrderItem[] = [];
  const errors: RosterError[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (i === 0 && HEADER.test(line.trim())) return;
    const r = parseRosterLine(line, defaultSize);
    if (typeof r === 'string') {
      if (r !== 'empty') errors.push({ line: i + 1, text: line.trim(), issue: r });
    } else {
      rows.push(r);
    }
  });
  return { rows, errors };
}

export function totalPieces(rows: { quantity: number }[]): number {
  return rows.reduce((n, r) => n + (Number.isFinite(r.quantity) ? r.quantity : 0), 0);
}

export { ALL_SIZES };

/** One CSV record per line; quoted fields may contain commas ("Arul, Jr", 7, M). */
export function csvRecords(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',' || ch === ';' || ch === '\t') {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

/**
 * Imports a CSV file (e.g. exported from a spreadsheet). Columns are matched by a
 * header row when there is one (name / number / size / quantity, in any order);
 * otherwise each record is read like a pasted line.
 */
export function parseRosterCsv(text: string, defaultSize?: Size): RosterResult {
  const records = csvRecords(text);
  if (!records.length) return { rows: [], errors: [] };
  const head = records[0].map((h) => h.toLowerCase().replace(/[^a-z#]/g, ''));
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = col(['name', 'player', 'playername']);
  const iNo = col(['number', 'no', 'num', '#', 'shirtnumber', 'jerseynumber']);
  const iSize = col(['size']);
  const iFit = col(['fit', 'cut', 'gender']);
  const iQty = col(['quantity', 'qty', 'pieces', 'count']);
  const hasHeader = iSize >= 0 && (iName >= 0 || iNo >= 0);
  const lines = (hasHeader ? records.slice(1) : records).map((r) => {
    if (!hasHeader) return r.filter((c) => c !== '').map((c) => c.replace(/[,;|\t]/g, ' ')).join(', ');
    // Rebuild a line the pasted-roster parser understands, with the name protected from being read as a size.
    const name = iName >= 0 ? (r[iName] ?? '') : '';
    const no = iNo >= 0 ? (r[iNo] ?? '') : '';
    const size = r[iSize] ?? '';
    const fit = iFit >= 0 ? (r[iFit] ?? '') : '';
    const qty = iQty >= 0 ? (r[iQty] ?? '') : '';
    return JSON.stringify({ name, no, size, fit, qty });
  });
  const rows: OrderItem[] = [];
  const errors: RosterError[] = [];
  lines.forEach((line, i) => {
    const lineNo = i + (hasHeader ? 2 : 1);
    if (!hasHeader) {
      const r = parseRosterLine(line, defaultSize);
      if (typeof r === 'string') {
        if (r !== 'empty') errors.push({ line: lineNo, text: line, issue: r });
      } else rows.push(r);
      return;
    }
    const f = JSON.parse(line) as { name: string; no: string; size: string; fit: string; qty: string };
    const text = [f.name, f.no, f.fit, f.size, f.qty].filter(Boolean).join(', ');
    if (!text.trim()) return;
    const size = f.size.trim() ? toSize(f.size) : defaultSize ?? null;
    const named = f.fit.trim() ? toFit(f.fit) : null;
    const fit = size ? fitFor(size, named) : null;
    const number = normalizeDigits(f.no).replace(/^#/, '').trim();
    const qty = f.qty.trim() ? Number(normalizeDigits(f.qty).replace(/[^\d]/g, '')) : 1;
    const player_name = f.name.replace(/\s+/g, ' ').trim();
    let issue: RosterIssue | null = null;
    if (!size || !fit || (f.fit.trim() && !named) || !isFitSize(fit, size)) issue = 'size';
    else if (player_name.length > TEXT_LIMITS.player_name) issue = 'nameTooLong';
    else if (number && !/^\d{1,3}$/.test(number)) issue = 'number';
    else if (!Number.isInteger(qty) || qty < 1 || qty > 500) issue = 'quantity';
    if (issue) errors.push({ line: lineNo, text, issue });
    else rows.push({ player_name, number, fit: fit!, size: size!, quantity: qty });
  });
  return { rows, errors };
}

/** Shirt numbers used by more than one roster row (blank numbers are ignored). */
export function duplicateNumbers(rows: { number: string }[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const n = r.number.trim();
    if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n);
}

/** Pieces per size, in size order, for the summary line (fits kept apart: a women's S is not a men's S). */
export function sizeBreakdown(rows: { fit?: Fit; size: Size; quantity: number }[]): { fit: Fit; size: Size; quantity: number }[] {
  return fitSizeBreakdown(rows);
}
