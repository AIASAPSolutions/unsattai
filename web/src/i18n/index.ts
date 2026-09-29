import { ApiError } from '@/lib/api/client';
import type { Language } from '@/lib/api/types';
import appEn, { type Strings as AppStrings } from './app/en';
import appHi from './app/hi';
import appTa from './app/ta';
import appTe from './app/te';
import webEn, { type WebStrings } from './web/en';
import webHi from './web/hi';
import webTa from './web/ta';
import webTe from './web/te';
import marketEn, { type MarketStrings } from './market/en';
import marketHi from './market/hi';
import marketTa from './market/ta';
import marketTe from './market/te';
import sizingEn, { type SizingStrings } from './sizing/en';
import sizingHi from './sizing/hi';
import sizingTa from './sizing/ta';
import sizingTe from './sizing/te';

// Customer-facing text in English, Hindi, Telugu and Tamil. The mobile app's strings
// (./app, copied from app/src/i18n) are reused as they are; web-only strings live in ./web and
// marketplace strings (shop, cart, checkout, accounts, after-sales) in ./market, and garment
// options, fits, the size guide and payment availability in ./sizing.

export type Strings = AppStrings & WebStrings & MarketStrings & SizingStrings;
export type StringKey = keyof Strings;

const en: Strings = { ...appEn, ...webEn, ...marketEn, ...sizingEn };
export const DICTS: Record<Language, Strings> = {
  en,
  hi: { ...appHi, ...webHi, ...marketHi, ...sizingHi },
  te: { ...appTe, ...webTe, ...marketTe, ...sizingTe },
  ta: { ...appTa, ...webTa, ...marketTa, ...sizingTa },
};

export const LANGUAGES: Language[] = ['en', 'hi', 'te', 'ta'];

export const LANGUAGE_OPTIONS: { code: Language; label: string; english: string }[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { code: 'te', label: 'తెలుగు', english: 'Telugu' },
  { code: 'ta', label: 'தமிழ்', english: 'Tamil' },
];

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as string[]).includes(v);
}

export type Params = Record<string, string | number>;
export type T = (key: StringKey, params?: Params) => string;

export function translate(lang: Language, key: StringKey, params?: Params): string {
  const raw = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

/** A dynamic key such as `sport_${sport}` that may not exist (unknown server value). */
export function tMaybe(t: T, key: string, fallback: string): string {
  return key in en ? t(key as StringKey) : fallback;
}

export function errorMessage(t: T, e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case 'network': return t('errNetworkWeb');
      case 'timeout': return t('errTimeout');
      case 'auth': return e.status === 401 && /sign in/i.test(e.message) ? t('signInNeeded') : t('errAuthWeb', { detail: e.message });
      case 'validation': return t('errValidation', { detail: e.message });
      case 'blocked': return t('orderBlockedServer');
      case 'not_found': return e.message && !/^Request failed/.test(e.message) ? e.message : t('errNotFound');
      case 'conflict': return e.message;
      case 'too_large': return t('errTooLarge');
      case 'quota': {
        const code = (e.data as { code?: string } | null)?.code;
        if (code === 'ai_rate') return t('errAiRate');
        if (code === 'ai_busy') return t('errAiBusy');
        if (code === 'ai_quota') return t('errAiQuota');
        return e.message;
      }
      case 'server': return t('errServer');
      default: return t('errUnknown', { detail: e.message });
    }
  }
  return t('errUnknown', { detail: e instanceof Error ? e.message : String(e) });
}
