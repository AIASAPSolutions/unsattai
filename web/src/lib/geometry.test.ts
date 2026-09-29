import { describe, expect, it } from 'vitest';
import type { DesignSpec, Element } from './api/types';
import { isSafe, refitLayers, safeZone, zoneCenter } from './geometry';
import { withOption } from './options';

// The server's default layers for a round-neck jersey (server/app/engine/layout.py default_elements).
const LAYERS = [
  { id: 'team_front', type: 'text', bind: 'team_name', panel: 'front', x: 270, y: 187.5, size: 50, max_width: 330 },
  { id: 'number_front', type: 'text', bind: 'number', panel: 'front', x: 270, y: 295.5, size: 120, max_width: 220 },
  { id: 'player_back', type: 'text', bind: 'player_name', panel: 'back', x: 270, y: 140, size: 56, max_width: 390 },
  { id: 'number_back', type: 'text', bind: 'number', panel: 'back', x: 270, y: 369, size: 240, max_width: 400 },
].map((e) => ({ rotation: 0, text: '', font: null, color_role: 'text', color: null, ...e })) as unknown as Element[];

const spec = {
  garment: 'jersey',
  typography: { team_name: 'Chennai Super Strikers', player_name: 'Priya', number: '10' },
  elements: LAYERS,
} as unknown as DesignSpec;

describe('safe zone by sleeves and collar', () => {
  it('matches the server: polo front starts below the placket, sleeveless narrows the shoulders', () => {
    expect(safeZone('jersey', 'front')[0]).toEqual([100, 110]);
    expect(safeZone('jersey', 'front', { collar: 'polo' })[0]).toEqual([100, 162]);
    expect(safeZone('jersey', 'back', { collar: 'polo' })[0]).toEqual([100, 48]);
    expect(safeZone('vneck', 'front', { collar: 'polo' })[0]).toEqual([100, 170]);
    expect(safeZone('jersey', 'back', { sleeves: 'none' })).toEqual([[165, 62], [375, 62], [500, 400], [500, 690], [40, 690], [40, 400]]);
    expect(safeZone('shorts', 'front', { sleeves: 'none', collar: 'polo' })[0]).toEqual([70, 60]);
    expect(zoneCenter('jersey', 'front', { collar: 'polo' })).toEqual([270, 426]);
  });
});

describe('refitting layers when the zone narrows', () => {
  it('leaves a design alone when every layer still fits', () => {
    expect(spec.elements.every((e) => isSafe(spec, e))).toBe(true);
    expect(refitLayers(spec)).toBe(spec);
  });
  it('brings a wide team name back inside a sleeveless zone', () => {
    const narrowed = { ...spec, sleeves: 'none' } as DesignSpec;
    expect(narrowed.elements.some((e) => !isSafe(narrowed, e))).toBe(true);
    const fixed = refitLayers(narrowed);
    expect(fixed.elements.every((e) => isSafe(fixed, e))).toBe(true);
    expect(fixed.elements.map((e) => e.id)).toEqual(spec.elements.map((e) => e.id));
    // Layers that fitted are untouched.
    const unchanged = fixed.elements.filter((e, i) => e === narrowed.elements[i]).map((e) => e.id);
    expect(unchanged).toContain('number_front');
  });
  it('moves a layer that sits in the polo placket below it', () => {
    const high = { ...spec, elements: spec.elements.map((e) => (e.id === 'team_front' ? { ...e, y: 140 } : e)) } as DesignSpec;
    const polo = withOption(high, 'collar', 'polo');
    expect(polo.collar).toBe('polo');
    expect(polo.elements.every((e) => isSafe(polo, e))).toBe(true);
    const team = polo.elements.find((e) => e.id === 'team_front')!;
    expect(team.y).toBeGreaterThan(162);
  });
  it('fits bound names for the longest name any order line may carry', () => {
    const sl = withOption(spec, 'sleeves', 'none');
    for (const player of ['Kiran Kumar', 'Subramaniam Venkatesh']) {
      const line = { ...sl, typography: { ...sl.typography, player_name: player } } as DesignSpec;
      expect(line.elements.every((e) => isSafe(line, e))).toBe(true);
    }
  });
  it('leaves the layers alone when the zone does not narrow', () => {
    expect(withOption(spec, 'sleeves', 'long').elements).toBe(spec.elements);
    const sl = withOption(spec, 'sleeves', 'none');
    expect(withOption(sl, 'sleeves', 'short').elements).toBe(sl.elements);
    expect(withOption(spec, 'collar', 'mandarin').elements).toBe(spec.elements);
  });
  it('refits through withOption for sleeveless too, and ignores shorts', () => {
    const sl = withOption(spec, 'sleeves', 'none');
    expect(sl.sleeves).toBe('none');
    expect(sl.elements.every((e) => isSafe(sl, e))).toBe(true);
    const shorts = { ...spec, garment: 'shorts' } as DesignSpec;
    expect(withOption(shorts, 'sleeves', 'none')).toBe(shorts);
  });
});

describe('turning the classic placement into layers', () => {
  it('fits the default layers to a sleeveless polo', async () => {
    const { materializeLayers } = await import('./spec');
    const classic = { ...spec, sleeves: 'none', collar: 'polo', elements: [] } as unknown as DesignSpec;
    const layered = materializeLayers(classic, LAYERS as never);
    expect(layered.elements).toHaveLength(4);
    expect(layered.elements.every((e) => isSafe(layered, e))).toBe(true);
  });
});
