import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorMessage, useT } from '../i18n';
import { usePrefs } from '../state/prefs';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';
import { listen, prepare, type Session } from '../voice/stt';

/**
 * Mic button that appends dictated text to a field. When speech input is not
 * available it explains why and points at the keyboard's own dictation key.
 */
export function VoiceInput({ onText, testID }: { onText: (text: string, final: boolean) => void; testID?: string }) {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const [active, setActive] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(() => () => session.current?.stop(), []);

  const toggle = async () => {
    if (active) {
      session.current?.stop();
      return;
    }
    setNote(null);
    try {
      const problem = await prepare(lang);
      if (problem) {
        setNote(problem === 'permission' ? t('sttNoPermission') : problem === 'language' ? t('sttLanguageMissing') : t('sttUnavailable'));
        return;
      }
    } catch (e) {
      setNote(errorMessage(t, e));
      return;
    }
    const s = listen(lang, {
      onText,
      onEnd: () => {
        session.current = null;
        setActive(false);
      },
      onError: (reason) => setNote(t('sttError', { reason })),
    });
    if (s) {
      session.current = s;
      setActive(true);
    } else {
      setNote(t('sttUnavailable'));
    }
  };

  return (
    <View>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={active ? t('listening') : t('speak')}
        accessibilityState={{ busy: active }}
        onPress={toggle}
        style={({ pressed }) => [styles.btn, active && styles.on, { opacity: pressed ? 0.8 : 1 }]}
      >
        <T variant="label" color={active ? '#fff' : colors.ink}>🎙 {active ? t('listening') : t('speak')}</T>
      </Pressable>
      {note ? <T variant="caption" color={colors.warn} accessibilityLiveRegion="polite" style={{ marginTop: space(1) }}>{note}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: space(3.5), borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: 'center',
  },
  on: { backgroundColor: colors.brand, borderColor: colors.brand },
});
