import type { Garment } from '../../api/types';

// The prompt a customer can paste into any image AI tool to design outside Unsattai.
// It asks for exactly the kind of picture Unsattai recognises best: one flat front
// view on a plain background, bold shapes, and no lettering (names and numbers are
// added later as exact print layers, so the tool's made-up text never reaches print).
// Always English: image tools follow English prompts most reliably.

export interface OutsidePromptInput {
  garment: Garment;
  /** The customer's own words, in any language. */
  idea: string;
  sport?: string | null;
  colors: string[];
  /** Named colours, to write "navy (#14213d)" instead of a bare hex. */
  colorNames?: { name: string; hex: string }[];
}

const GARMENT_WORDS: Record<Garment, string> = {
  jersey: 'short-sleeve crew-neck sports jersey',
  vneck: 'short-sleeve V-neck sports jersey',
  shorts: 'pair of sports shorts',
};

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Nearest named colour when it is close enough to be the same colour to a person. */
export function colorWord(hex: string, names: { name: string; hex: string }[] = []): string {
  const [r, g, b] = hexToRgb(hex.toLowerCase());
  let best: { name: string; d: number } | null = null;
  for (const c of names) {
    const [r2, g2, b2] = hexToRgb(c.hex.toLowerCase());
    const d = Math.hypot(r - r2, g - g2, b - b2);
    if (!best || d < best.d) best = { name: c.name, d };
  }
  return best && best.d < 40 ? `${best.name} (${hex.toLowerCase()})` : hex.toLowerCase();
}

export function buildOutsidePrompt(input: OutsidePromptInput): string {
  const garment = GARMENT_WORDS[input.garment];
  const sport = input.sport ? `${input.sport} ` : '';
  const idea = input.idea.trim().replace(/\s+/g, ' ');
  const colors = input.colors.map((c) => colorWord(c, input.colorNames));
  const lines = [
    `Flat product design of a ${sport}${garment} for full sublimation printing.`,
    'Front view only, centred, laid perfectly flat on a plain white background. No person, no mannequin, no hanger, no folds, no shadows.',
    colors.length ? `Use these colours: ${colors.join(', ')}.` : 'Use two or three strong team colours.',
    idea ? `Style idea: ${idea}.` : 'Style idea: bold, modern and sporty.',
    'Bold, clean graphic shapes with sharp edges, repeated across the garment. Keep the collar and cuffs in one solid colour.',
    'Leave the middle of the chest plain for a name and number. No text, no letters, no numbers, no logos, no brand marks.',
    'Square image, high resolution.',
  ];
  return lines.join('\n');
}
