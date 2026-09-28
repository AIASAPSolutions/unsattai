// Devanagari, Telugu and Tamil digits -> ASCII, so "नंबर १०" means 10 everywhere.
const ZEROS = [0x0966, 0x0c66, 0x0be6];

export function normalizeDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const zero = ZEROS.find((z) => code >= z && code <= z + 9);
    out += zero !== undefined ? String(code - zero) : ch;
  }
  return out;
}
