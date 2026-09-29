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

const REASON_KEYS: Record<string, StringKey> = {
  not_serviceable: 'errNotServiceable', invalid_pincode: 'errInvalidPincode', garment_unavailable: 'errGarmentUnavailable',
  pieces_out_of_range: 'errPiecesOutOfRange', seller_unavailable: 'errSellerUnavailable', cod_unavailable: 'errCodUnavailable',
};

/**
 * Words for a failed request. Sign-in answers are told apart by status and the
 * server's (stable, English) message so each gets its own translated text.
 */
export function errorMessage(t: T, e: unknown): string {
  if (e instanceof ApiError) {
    const m = e.message;
    switch (e.kind) {
      case 'network': return t('errNetwork');
      case 'timeout': return t('errTimeout');
      case 'auth':
        if (e.sessionExpired) return t('errSessionExpired');
        if (/X-API-Key/i.test(m)) return t('errAuth');
        if (/please sign in/i.test(m)) return t('errSignInNeeded');
        if (/current password/i.test(m)) return t('errCurrentPassword');
        if (/expired/i.test(m)) return t('errCodeExpired');
        if (/code/i.test(m)) return t('errWrongCode');
        if (/password/i.test(m)) return t('errWrongPassword');
        return t('errAuth');
      case 'forbidden': return t('errBlocked');
      case 'locked': return t('errLocked');
      case 'validation': {
        const code = e.code;
        if (code && REASON_KEYS[code]) return t(REASON_KEYS[code]);
        if (/password/i.test(m) && e.status === 422 && !e.fields.length) return t('errWeakPassword', { detail: m });
        return t('errValidation', { detail: m });
      }
      case 'blocked': return t('orderBlockedServer');
      case 'not_found': return t('errNotFound');
      case 'conflict':
        if (/belongs to another account/i.test(m)) return t('errIdentifierTaken');
        if (/idempotency|different body/i.test(m)) return t('errConflict', { detail: m });
        return t('errCannotChange', { detail: m });
      case 'too_large': return t('errTooLarge');
      case 'quota': {
        const code = e.code;
        if (code === 'ai_rate') return t('errAiRate');
        if (code === 'ai_busy') return t('errAiBusy');
        if (code) return t('errAiQuota');
        if (/wrong passwords/i.test(m)) return t('errLocked');
        if (/wrong codes/i.test(m)) return t('errTooManyCodes');
        if (/few seconds|another code/i.test(m)) return t('errCodeWait');
        return t('errTooMany');
      }
      case 'server': return t('errServer');
      default: return t('errUnknown', { detail: m });
    }
  }
  return t('errUnknown', { detail: e instanceof Error ? e.message : String(e) });
}

export type { StringKey, Strings };
