import type { LogoElement, Size } from './api/types';

// Same grading factors as the server (server/app/engine/garments.py).
export const SIZE_SCALE: Record<Size, number> = { XS: 0.88, S: 0.94, M: 1.0, L: 1.06, XL: 1.12, XXL: 1.18 };
export const TARGET_DPI = 300;
export const MIN_DPI = 72;

export function effectiveDpi(logo: Pick<LogoElement, 'width' | 'pixel_width'>, size: Size = 'M'): number | null {
  if (!logo.pixel_width) return null;
  const inches = (logo.width * SIZE_SCALE[size]) / 25.4;
  return logo.pixel_width / inches;
}

export function worstSize(sizes: Size[]): Size {
  return sizes.length ? sizes.reduce((a, b) => (SIZE_SCALE[b] > SIZE_SCALE[a] ? b : a)) : 'M';
}

export type DpiLevel = 'vector' | 'good' | 'low' | 'unprintable' | 'unknown';

export function dpiLevel(logo: LogoElement, size: Size = 'M'): DpiLevel {
  if (logo.kind === 'vector') return 'vector';
  const dpi = effectiveDpi(logo, size);
  if (dpi === null) return 'unknown';
  if (dpi >= TARGET_DPI) return 'good';
  return dpi >= MIN_DPI ? 'low' : 'unprintable';
}

/** Widest print (mm) that still reaches the target DPI at a size. */
export function maxWidthForDpi(pixelWidth: number, size: Size = 'M', dpi = TARGET_DPI): number {
  return ((pixelWidth / dpi) * 25.4) / SIZE_SCALE[size];
}
