import * as Speech from 'expo-speech';
import type { Language } from '../api/types';
import { SPEECH_LOCALE } from '../i18n';

// Text-to-speech for the voice guide. Voices differ per device: a language
// without an installed voice falls back to English (and the UI says so), and a
// device with no voices at all turns the guide off.

export type VoiceSupport = 'native' | 'fallback' | 'none';

let voicesCache: Speech.Voice[] | null = null;

export async function voices(): Promise<Speech.Voice[]> {
  if (voicesCache) return voicesCache;
  try {
    voicesCache = await Speech.getAvailableVoicesAsync();
  } catch {
    voicesCache = [];
  }
  return voicesCache;
}

export function pickVoice(all: Pick<Speech.Voice, 'identifier' | 'language' | 'quality'>[], lang: Language) {
  const prefix = lang.toLowerCase();
  const matches = all.filter((v) => v.language?.toLowerCase().replace('_', '-').startsWith(prefix));
  const inIndia = matches.filter((v) => /-in$/i.test(v.language.replace('_', '-')));
  const pool = inIndia.length ? inIndia : matches;
  return pool.sort((a, b) => Number(b.quality === 'Enhanced') - Number(a.quality === 'Enhanced'))[0] ?? null;
}

export async function voiceSupport(lang: Language): Promise<VoiceSupport> {
  const all = await voices();
  // Some platforms (web, some Androids) report no voice list but still speak the default voice.
  if (!all.length) return lang === 'en' ? 'native' : 'fallback';
  if (pickVoice(all, lang)) return 'native';
  return pickVoice(all, 'en') ? 'fallback' : 'none';
}

export async function say(text: string, lang: Language): Promise<void> {
  if (!text.trim()) return;
  const all = await voices();
  const voice = pickVoice(all, lang) ?? (all.length ? pickVoice(all, 'en') : null);
  const language = voice ? voice.language : all.length ? SPEECH_LOCALE.en : SPEECH_LOCALE[lang];
  try {
    await Speech.stop();
    Speech.speak(text, { language, voice: voice?.identifier, rate: 0.95 });
  } catch {
    /* speech is a convenience; never block the flow */
  }
}

export function hush(): void {
  Speech.stop().catch(() => undefined);
}
