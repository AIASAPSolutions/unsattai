import { Platform } from 'react-native';
import type { Language } from '../api/types';
import { SPEECH_LOCALE } from '../i18n';

// Speech-to-text via expo-speech-recognition. It is a native module, so it is
// only present in a development/production build of Unsattai, not in Expo Go;
// on web it uses the browser's Web Speech API where available. Everything here
// fails soft: callers get a reason they can show, and typing always works.

type Module = typeof import('expo-speech-recognition');
let mod: Module | null | undefined;

function load(): Module | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-speech-recognition') as Module;
    if (!mod?.ExpoSpeechRecognitionModule) mod = null;
  } catch {
    mod = null;
  }
  return mod;
}

export type SttProblem = 'unavailable' | 'permission' | 'language';

export async function prepare(lang: Language): Promise<SttProblem | null> {
  const m = load();
  if (!m) return 'unavailable';
  const R = m.ExpoSpeechRecognitionModule;
  try {
    if (!R.isRecognitionAvailable()) return 'unavailable';
  } catch {
    return 'unavailable';
  }
  const perm = await R.requestPermissionsAsync().catch(() => ({ granted: false }));
  if (!perm.granted) return 'permission';
  if (Platform.OS === 'android' && lang !== 'en') {
    // Offline language packs are optional; network recognition usually covers Indic languages.
    try {
      const { locales, installedLocales } = await R.getSupportedLocales({});
      const all = [...(locales ?? []), ...(installedLocales ?? [])].map((l) => l.toLowerCase());
      if (all.length && !all.some((l) => l.startsWith(lang))) return 'language';
    } catch {
      /* unknown: try anyway */
    }
  }
  return null;
}

export interface Session {
  stop: () => void;
}

export function listen(
  lang: Language,
  handlers: { onText: (text: string, final: boolean) => void; onEnd: () => void; onError: (reason: string) => void },
): Session | null {
  const m = load();
  if (!m) return null;
  const R = m.ExpoSpeechRecognitionModule;
  const subs = [
    R.addListener('result', (e) => {
      const text = e.results?.[0]?.transcript ?? '';
      if (text) handlers.onText(text, e.isFinal);
    }),
    R.addListener('error', (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') handlers.onError(e.message || e.error);
    }),
    R.addListener('end', () => {
      subs.forEach((s) => s.remove());
      handlers.onEnd();
    }),
  ];
  try {
    R.start({ lang: SPEECH_LOCALE[lang], interimResults: true, continuous: false, addsPunctuation: true });
  } catch (e) {
    subs.forEach((s) => s.remove());
    handlers.onError(e instanceof Error ? e.message : String(e));
    return null;
  }
  return { stop: () => R.stop() };
}
