import { Platform } from 'react-native';
import type { Language } from '../api/types';

export const colors = {
  navy: '#0b1124',
  ink: '#111827',
  muted: '#5b6472',
  line: '#dde1e8',
  surface: '#ffffff',
  bg: '#f4f5f8',
  brand: '#ff4d2e',      // Unsattai flame
  brandDark: '#d63a1e',
  brandSoft: '#ffe7e1',
  blue: '#1f5fbf',
  pass: '#1f8a3b',
  passSoft: '#e5f4ea',
  info: '#2446a6',
  infoSoft: '#e8edfb',
  warn: '#a86500',
  warnSoft: '#fff3dc',
  fail: '#c0262d',
  failSoft: '#fde8e8',
  overlay: 'rgba(11,17,36,0.55)',
};

export const space = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 };

// Bundled Noto families keep Devanagari, Telugu and Tamil consistent across devices.
export const FONT_FAMILY: Record<Language, { regular: string; bold: string }> = {
  en: { regular: 'NotoSans_400Regular', bold: 'NotoSans_700Bold' },
  hi: { regular: 'NotoSansDevanagari_400Regular', bold: 'NotoSansDevanagari_700Bold' },
  te: { regular: 'NotoSansTelugu_400Regular', bold: 'NotoSansTelugu_700Bold' },
  ta: { regular: 'NotoSansTamil_400Regular', bold: 'NotoSansTamil_700Bold' },
};

/** Indic scripts stack vowel signs above and below the line, so they need taller lines. */
export function lineHeightFor(lang: Language, size: number): number {
  return Math.round(size * (lang === 'en' ? 1.35 : 1.6));
}

export const shadow = Platform.select({
  ios: { shadowColor: '#0b1124', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 14px rgba(11,17,36,0.08)' } as object,
});
