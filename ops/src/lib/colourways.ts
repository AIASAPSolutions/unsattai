/** Product colourways: the same design in other palettes. Pure: unit tested. Rules match server catalog.Colourway. */
import type { FieldError } from './errors';
import { PALETTE_ROLES, type Colourway, type PaletteRole } from './types';

export const MAX_COLOURWAYS = 8;
export const COLOURWAY_ID = /^[a-z0-9][a-z0-9-]{1,30}$/;
const HEX = /^#[0-9a-f]{6}$/i;

export const ROLE_LABEL: Record<PaletteRole, string> = { primary: 'Primary', secondary: 'Secondary', accent: 'Accent', trim: 'Trim', text: 'Text' };

/** "Navy Blue!" -> "navy-blue": a colourway id from its name. */
export function toColourwayId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31);
}

/** Palette with every role as #rrggbb (lower case, as colour inputs need); missing roles fall back. */
export function fullPalette(p: Partial<Record<string, string>> | null | undefined, fallback = '#888888'): Record<PaletteRole, string> {
  const out = {} as Record<PaletteRole, string>;
  for (const r of PALETTE_ROLES) {
    const v = p?.[r];
    out[r] = typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback;
  }
  return out;
}

/** A new colourway to add: the product's palette with primary and secondary swapped, and an unused id. */
export function newColourway(existing: Colourway[], base: Partial<Record<string, string>> | null | undefined): Colourway {
  const pal = fullPalette(base);
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `colourway-${n}`)) n++;
  return { id: `colourway-${n}`, name: `Colourway ${n}`, palette: { ...pal, primary: pal.secondary, secondary: pal.primary } };
}

/** Client-side check with the server's paths ("colourways.1.id"). */
export function validateColourways(list: Colourway[]): FieldError[] {
  const errs: FieldError[] = [];
  if (list.length > MAX_COLOURWAYS) errs.push({ path: 'colourways', message: `At most ${MAX_COLOURWAYS} colourways besides the original.` });
  const seen = new Map<string, number>();
  list.forEach((c, i) => {
    const p = `colourways.${i}`;
    if (!COLOURWAY_ID.test(c.id)) errs.push({ path: `${p}.id`, message: '2 to 31 of a-z, 0-9 and -, starting with a letter or digit.' });
    else if (c.id === 'original') errs.push({ path: `${p}.id`, message: '"original" is the product\'s own colours; choose another id.' });
    else if (seen.has(c.id)) errs.push({ path: `${p}.id`, message: `Used twice (also colourway ${seen.get(c.id)! + 1}).` });
    if (!seen.has(c.id)) seen.set(c.id, i);
    if (!c.name.trim()) errs.push({ path: `${p}.name`, message: 'Required.' });
    else if (c.name.trim().length > 40) errs.push({ path: `${p}.name`, message: 'At most 40 characters.' });
    for (const r of PALETTE_ROLES) if (!HEX.test(c.palette[r] ?? '')) errs.push({ path: `${p}.palette.${r}`, message: 'A colour like #1a2b3c.' });
  });
  return errs;
}

/** What the API gets: trimmed names, lower-case hex. */
export function cleanColourways(list: Colourway[]): Colourway[] {
  return list.map((c) => ({ id: c.id.trim(), name: c.name.trim(), palette: fullPalette(c.palette) }));
}
