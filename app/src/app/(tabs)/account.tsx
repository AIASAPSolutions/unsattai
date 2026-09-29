import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { displayIdentifier } from '../../features/account/identifier';
import { useT } from '../../i18n';
import { useAuth } from '../../state/auth';
import { useWishlist } from '../../state/wishlist';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ListRow } from '../../ui/ListRow';
import { Screen } from '../../ui/Screen';
import { Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { space } from '../../ui/theme';

export default function AccountScreen() {
  const t = useT();
  const status = useAuth((s) => s.status);
  const me = useAuth((s) => s.customer);
  const unread = useAuth((s) => s.unread);
  const expired = useAuth((s) => s.expired);
  const dismissExpired = useAuth((s) => s.dismissExpired);
  const refreshUnread = useAuth((s) => s.refreshUnread);
  const refresh = useAuth((s) => s.refresh);
  const signOut = useAuth((s) => s.signOut);
  const wishCount = useWishlist((s) => s.ids.length);

  useFocusEffect(useCallback(() => {
    if (status === 'signedIn') {
      refreshUnread().catch(() => undefined);
      refresh().catch(() => undefined);
    }
  }, [status, refreshUnread, refresh]));

  if (status === 'unknown') return <Screen testID="screen-account"><Loading label={t('loading')} /></Screen>;

  const common = (
    <>
      <ListRow icon="♡" label={t('wishlistTitle')} note={wishCount ? t('savedCount', { n: wishCount }) : undefined}
        onPress={() => router.push('/wishlist')} testID="account-wishlist" />
      <ListRow icon="⚙︎" label={t('settingsTitle')} note={t('settingsNote')} onPress={() => router.push('/settings')} testID="account-settings" />
    </>
  );

  if (status !== 'signedIn' || !me) {
    return (
      <Screen testID="screen-account">
        {expired ? <Banner tone="warn" text={t('sessionEnded')} action={t('close')} onAction={dismissExpired} testID="session-ended" /> : null}
        <Card>
          <T variant="title" accessibilityRole="header">{t('accountWelcome')}</T>
          <T variant="body" style={{ marginVertical: space(2) }}>{t('accountWelcomeHint')}</T>
          <Button testID="account-sign-in" label={t('signInOrCreate')} onPress={() => router.push('/sign-in')} />
        </Card>
        <Card>
          {common}
        </Card>
      </Screen>
    );
  }

  const id = me.phone ? displayIdentifier({ phone: me.phone }) : me.email;
  return (
    <Screen testID="screen-account">
      <Card>
        <T variant="title" accessibilityRole="header" testID="account-greeting">{t('hello', { name: me.name || t('there') })}</T>
        <T variant="caption">{id}</T>
      </Card>
      <Card>
        <ListRow icon="📦" label={t('myOrdersTitle')} note={me.orders_count ? t('ordersCount', { n: me.orders_count }) : undefined}
          onPress={() => router.push('/account/orders')} testID="account-orders" />
        <ListRow icon="🔔" label={t('notificationsTitle')} badge={unread} onPress={() => router.push('/account/notifications')} testID="account-notifications" />
        {common}
      </Card>
      <Card>
        <ListRow icon="👤" label={t('profileTitle')} note={me.name} onPress={() => router.push('/account/profile')} testID="account-profile" />
        <ListRow icon="🏠" label={t('addressesTitle')} note={t('addressCount', { n: me.addresses.length })}
          onPress={() => router.push('/account/addresses')} testID="account-addresses" />
        <ListRow icon="🔒" label={t('securityTitle')} note={me.has_password ? t('passwordSet') : t('noPasswordYet')}
          onPress={() => router.push('/account/security')} testID="account-security" />
      </Card>
      <View style={{ marginTop: space(2) }}>
        <Button testID="sign-out" kind="secondary" label={t('signOut')} onPress={() => signOut()} />
      </View>
    </Screen>
  );
}
