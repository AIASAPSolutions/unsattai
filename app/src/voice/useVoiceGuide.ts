import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { usePrefs } from '../state/prefs';
import { hush, say, voiceSupport, type VoiceSupport } from './tts';

/** Speaks important prompts and results when the voice guide is on. */
export function useVoiceGuide() {
  const t = useT();
  const on = usePrefs((s) => s.voiceGuide);
  const lang = usePrefs((s) => s.language);
  const setVoiceGuide = usePrefs((s) => s.setVoiceGuide);
  const [support, setSupport] = useState<VoiceSupport | null>(null);

  useEffect(() => {
    if (!on) {
      hush();
      return;
    }
    let live = true;
    voiceSupport(lang).then((s) => {
      if (!live) return;
      setSupport(s);
      if (s === 'none') setVoiceGuide(false);
    });
    return () => {
      live = false;
    };
  }, [on, lang, setVoiceGuide]);

  const speak = useCallback((text: string) => {
    if (on) say(text, lang);
  }, [on, lang]);

  const notice = support === 'fallback' && on ? t('ttsUnavailable') : support === 'none' ? t('ttsNone') : null;
  return { on, speak, notice };
}
