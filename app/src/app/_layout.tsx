import {
  NotoSans_400Regular, NotoSans_700Bold,
} from '@expo-google-fonts/noto-sans';
import { NotoSansDevanagari_400Regular, NotoSansDevanagari_700Bold } from '@expo-google-fonts/noto-sans-devanagari';
import { NotoSansTamil_400Regular, NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil';
import { NotoSansTelugu_400Regular, NotoSansTelugu_700Bold } from '@expo-google-fonts/noto-sans-telugu';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadApiUrl } from '../api/config';
import { HeaderActions } from '../components/HeaderActions';
import { useT } from '../i18n';
import { useAuth } from '../state/auth';
import { usePrefs } from '../state/prefs';
import { Loading } from '../ui/States';
import { colors, FONT_FAMILY } from '../ui/theme';

export default function RootLayout() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const restore = useAuth((s) => s.restore);
  const [ready, setReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    NotoSans_400Regular, NotoSans_700Bold,
    NotoSansDevanagari_400Regular, NotoSansDevanagari_700Bold,
    NotoSansTelugu_400Regular, NotoSansTelugu_700Bold,
    NotoSansTamil_400Regular, NotoSansTamil_700Bold,
  });

  useEffect(() => {
    // The server address first, then the saved sign-in (checked against the server in the background).
    loadApiUrl().finally(() => {
      setReady(true);
      restore().catch(() => undefined);
    });
  }, [restore]);

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
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('appName') }} />
            <Stack.Screen name="confirm" options={{ title: t('confirmTitle') }} />
            <Stack.Screen name="designs" options={{ title: t('designsTitle') }} />
            <Stack.Screen name="from-picture" options={{ title: t('pictureTitle') }} />
            <Stack.Screen name="studio" options={{ title: t('studioTitle'), gestureEnabled: false }} />
            <Stack.Screen name="order" options={{ title: t('orderTitle') }} />
            <Stack.Screen name="orders/[id]" options={{ title: t('orderTitle') }} />
            <Stack.Screen name="product/[slug]" options={{ title: t('productTitle') }} />
            <Stack.Screen name="wishlist" options={{ title: t('wishlistTitle') }} />
            <Stack.Screen name="checkout" options={{ title: t('checkoutTitle') }} />
            <Stack.Screen name="checkouts/[id]" options={{ title: t('confirmationTitle') }} />
            <Stack.Screen name="sign-in" options={{ title: t('signInTitle'), headerRight: () => null }} />
            <Stack.Screen name="account/profile" options={{ title: t('profileTitle') }} />
            <Stack.Screen name="account/addresses" options={{ title: t('addressesTitle') }} />
            <Stack.Screen name="account/security" options={{ title: t('securityTitle') }} />
            <Stack.Screen name="account/orders" options={{ title: t('myOrdersTitle') }} />
            <Stack.Screen name="account/notifications" options={{ title: t('notificationsTitle') }} />
            <Stack.Screen name="settings" options={{ title: t('settingsTitle'), headerRight: () => null }} />
            <Stack.Screen name="design" options={{ title: t('appName') }} />
          </Stack>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
