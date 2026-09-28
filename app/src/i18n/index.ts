import { ApiError } from '../api/client';
import type { Language } from '../api/types';
import { usePrefs } from '../state/prefs';
import en, { type StringKey, type Strings } from './en';
import hi from './hi';
import ta from './ta';
import te from './te';

export const DICTS: Record<Language, Strings> = { en, hi, te, ta };

export const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'ta', label: 'தமிழ்' },
];

/** BCP-47 tags for speech recognition and synthesis. */
export const SPEECH_LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN' };

export type Params = Record<string, string | number>;
export type T = (key: StringKey, params?: Params) => string;

export function translate(lang: Language, key: StringKey, params?: Params): string {
  const raw = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

export function useT(): T {
  const lang = usePrefs((s) => s.language);
  return (key, params) => translate(lang, key, params);
}

/** A dynamic key such as `sport_${sport}` that may not exist (unknown server value). */
export function tMaybe(t: T, key: string, fallback: string): string {
  return key in en ? t(key as StringKey) : fallback;
}

export function errorMessage(t: T, e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.kind) {
      case 'network': return t('errNetwork');
      case 'timeout': return t('errTimeout');
      case 'auth': return t('errAuth');
      case 'validation': return t('errValidation', { detail: e.message });
      case 'blocked': return t('orderBlockedServer');
      case 'not_found': return t('errNotFound');
      case 'conflict': return t('errConflict', { detail: e.message });
      case 'too_large': return t('errTooLarge');
      case 'server': return t('errServer');
      default: return t('errUnknown', { detail: e.message });
    }
  }
  return t('errUnknown', { detail: e instanceof Error ? e.message : String(e) });
}

export type { StringKey, Strings };
