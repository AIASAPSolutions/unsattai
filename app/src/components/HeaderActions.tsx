import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { usePrefs } from '../state/prefs';
import { T } from '../ui/Text';

export function HeaderActions() {
  const t = useT();
  const voiceGuide = usePrefs((s) => s.voiceGuide);
  const setVoiceGuide = usePrefs((s) => s.setVoiceGuide);
  return (
    <View style={styles.actions}>
      <Pressable
        testID="voice-toggle"
        accessibilityRole="switch"
        accessibilityState={{ checked: voiceGuide }}
        accessibilityLabel={t('voiceGuide')}
        onPress={() => setVoiceGuide(!voiceGuide)}
        hitSlop={8}
        style={styles.action}
      >
        <T variant="heading" color="#fff">{voiceGuide ? '🔊' : '🔈'}</T>
      </Pressable>
      <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={t('settings')}
        onPress={() => router.push('/settings')} hitSlop={8} style={styles.action}>
        <T variant="heading" color="#fff">⚙︎</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
  action: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
