import { Tabs } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { HeaderActions } from '../../components/HeaderActions';
import { useT } from '../../i18n';
import { useAuth } from '../../state/auth';
import { useCart } from '../../state/cart';
import { usePrefs } from '../../state/prefs';
import { T } from '../../ui/Text';
import { colors, FONT_FAMILY } from '../../ui/theme';

function Icon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return <T variant="heading" style={{ fontSize: 20, lineHeight: 24, opacity: focused ? 1 : 0.55 }}>{glyph}</T>;
}

export default function TabsLayout() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const cartCount = useCart((s) => s.lines.length);
  const unread = useAuth((s) => s.unread);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const refreshUnread = useAuth((s) => s.refreshUnread);

  // The unread count is checked when the app comes back to the front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && signedIn) refreshUnread().catch(() => undefined);
    });
    return () => sub.remove();
  }, [signedIn, refreshUnread]);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: '#fff',
        headerTitleStyle: { fontFamily: FONT_FAMILY[lang].bold },
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: FONT_FAMILY[lang].bold, fontSize: 12 },
        tabBarStyle: { minHeight: 60 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{
        title: t('appName'), tabBarLabel: t('tabCreate'), tabBarButtonTestID: 'tab-create',
        tabBarIcon: ({ focused }) => <Icon glyph="✎" focused={focused} />,
      }} />
      <Tabs.Screen name="shop" options={{
        title: t('shopTitle'), tabBarLabel: t('tabShop'), tabBarButtonTestID: 'tab-shop',
        tabBarIcon: ({ focused }) => <Icon glyph="🛍" focused={focused} />,
      }} />
      <Tabs.Screen name="cart" options={{
        title: t('cartTitle'), tabBarLabel: t('tabCart'), tabBarButtonTestID: 'tab-cart',
        tabBarBadge: cartCount || undefined, tabBarAccessibilityLabel: t('cartA11y', { n: cartCount }),
        tabBarIcon: ({ focused }) => <Icon glyph="🛒" focused={focused} />,
      }} />
      <Tabs.Screen name="account" options={{
        title: t('accountTitle'), tabBarLabel: t('tabAccount'), tabBarButtonTestID: 'tab-account',
        tabBarBadge: unread || undefined, tabBarAccessibilityLabel: unread ? t('accountA11yUnread', { n: unread }) : t('tabAccount'),
        tabBarIcon: ({ focused }) => <Icon glyph="👤" focused={focused} />,
      }} />
    </Tabs>
  );
}
