import {
  NotoSans_400Regular, NotoSans_700Bold,
} from '@expo-google-fonts/noto-sans';
import { NotoSansDevanagari_400Regular, NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari';
import { NotoSansTamil_400Regular, NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil';
import { NotoSansTelugu_400Regular, NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu';
import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadApiUrl } from '../api/config';
import { useT } from '../i18n';
import { usePrefs } from '../state/prefs';
import { Loading } from '../ui/States';
import { T } from '../ui/Text';
import { colors, FONT_FAMILY } from '../ui/theme';

function HeaderActions() {
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

export default function RootLayout() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const [ready, setReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    NotoSans_400Regular, NotoSans_700Bold,
    NotoSansDevanagari_400Regular, NotoSansDevanagari_700Bold,
    NotoSansTelugu_400Regular, NotoSansTelugu_700Bold,
    NotoSansTamil_400Regular, NotoSansTamil_700Bold,
  });

  useEffect(() => {
    loadApiUrl().finally(() => setReady(true));
  }, []);

  const fontsReady = fontsLoaded || !!fontError; // system fonts still render every script if loading fails
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {!ready || !fontsReady ? (
          <Loading label={t('loading')} />
        ) : (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.navy },
              headerTintColor: '#fff',
              headerTitleStyle: { fontFamily: FONT_FAMILY[lang].bold },
              headerRight: () => <HeaderActions />,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ title: t('appName') }} />
            <Stack.Screen name="confirm" options={{ title: t('confirmTitle') }} />
            <Stack.Screen name="designs" options={{ title: t('designsTitle') }} />
            <Stack.Screen name="from-picture" options={{ title: t('pictureTitle') }} />
            <Stack.Screen name="studio" options={{ title: t('studioTitle'), gestureEnabled: false }} />
            <Stack.Screen name="order" options={{ title: t('orderTitle') }} />
            <Stack.Screen name="orders/[id]" options={{ title: t('orderTitle') }} />
            <Stack.Screen name="settings" options={{ title: t('settingsTitle'), headerRight: () => null }} />
            <Stack.Screen name="design" options={{ title: t('appName') }} />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center' },
  action: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
