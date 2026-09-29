import { normalizeDigits } from './digits';
import { FIT_SIZES, SIZES, TEXT_LIMITS, type Fit, type OrderItem, type Size } from '../api/types';

// Parses a pasted roster, one player per line, in any of these shapes:
//   Arul, 7, M, 2          (name, number, size, quantity)
//   Priya Sharma - 10 - XL
//   7 Arul L x3
//   Name<TAB>No<TAB>Size   (copied from a spreadsheet; a header row is skipped)
//   Kavin, 4, 8Y           (kids sizes 4Y-14Y are kids' fit)
//   Priya, 10, women, S    (a fit word: men / women / kids)
// Names keep their exact spelling and script. Quantity defaults to 1, fit to men's.

export type RosterIssue = 'size' | 'nameTooLong' | 'number' | 'quantity' | 'empty';

export interface RosterError {
  line: number;
  text: string;
  issue: RosterIssue;
}

export type RosterRow = OrderItem & { fit: Fit };

export interface RosterResult {
  rows: RosterRow[];
  errors: RosterError[];
}

const SIZE_ALIASES: Record<string, Size> = {
  XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL', '2XL': 'XXL', '3XL': '3XL', XXXL: '3XL',
  SMALL: 'S', MEDIUM: 'M', LARGE: 'L', 'X-LARGE': 'XL', 'XX-LARGE': 'XXL', 'EXTRA SMALL': 'XS',
};
const FIT_WORDS: Record<string, Fit> = {
  MEN: 'men', MENS: 'men', "MEN'S": 'men', UNISEX: 'men', MALE: 'men',
  WOMEN: 'women', WOMENS: 'women', "WOMEN'S": 'women', LADIES: 'women', FEMALE: 'women',
  KID: 'kids', KIDS: 'kids', CHILD: 'kids', CHILDREN: 'kids', YOUTH: 'kids', BOYS: 'kids', GIRLS: 'kids',
};
const HEADER = /^(name|player|player name|नाम|పేరు|பெயர்)\b.*\b(size|no|number|#)/i;

function toSize(token: string): Size | null {
  const up = token.trim().toUpperCase();
  const kid = /^(4|6|8|10|12|14)\s*(?:Y|YR|YRS|YEARS?)$/.exec(up);
  if (kid) return `${kid[1]}Y` as Size;
  return SIZE_ALIASES[up] ?? null;
}

function toFit(token: string): Fit | null {
  return FIT_WORDS[token.trim().toUpperCase()] ?? null;
}

function toQuantity(token: string): number | null {
  const m = /^(?:x|×|qty:?|quantity:?)\s*(\d{1,4})$|^(\d{1,4})\s*(?:x|×|pcs?|pieces?)$/i.exec(token.trim());
  if (!m) return null;
  return Number(m[1] ?? m[2]);
}

export function parseRosterLine(text: string, defaultSize?: Size, defaultFit: Fit = 'men'): RosterRow | RosterIssue {
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
    // "10 yrs" written with a space is a kids size
    else if (prev && /^(4|6|8|10|12|14)$/.test(prev) && /^(y|yr|yrs|years?)$/i.test(t)) acc[acc.length - 1] = `${prev}Y`;
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
  // A kids size is the kids' fit; otherwise the fit written on the line, the default, or men's.
  if (!fit) fit = size && FIT_SIZES.kids.includes(size) ? 'kids' : size && !FIT_SIZES[defaultFit].includes(size) ? 'men' : defaultFit;
  if (!size && defaultSize && FIT_SIZES[fit].includes(defaultSize)) size = defaultSize;
  if (!size || !FIT_SIZES[fit].includes(size)) return 'size';
  if (player_name.length > TEXT_LIMITS.player_name) return 'nameTooLong';
  if (number !== null && !/^\d{1,3}$/.test(number)) return 'number';
  const qty = quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 500) return 'quantity';
  return { player_name, number: number ?? '', fit, size, quantity: qty };
}

export function parseRoster(text: string, defaultSize?: Size, defaultFit: Fit = 'men'): RosterResult {
  const rows: RosterRow[] = [];
  const errors: RosterError[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    if (i === 0 && HEADER.test(line.trim())) return;
    const r = parseRosterLine(line, defaultSize, defaultFit);
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

export const ALL_SIZES = SIZES;
