import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { AppNotification } from '../../api/types';
import { errorMessage, useT } from '../../i18n';
import { useAuth } from '../../state/auth';
import { Button } from '../../ui/Button';
import { Empty, ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function NotificationsScreen() {
  const t = useT();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const setUnread = useAuth((s) => s.setUnread);
  const unread = useAuth((s) => s.unread);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.notifications(1);
      setItems(res.items);
      setUnread(res.unread);
    } catch (e) {
      setError(e);
    }
  }, [setUnread]);

  useFocusEffect(useCallback(() => {
    if (signedIn) load();
    else router.replace('/sign-in');
  }, [signedIn, load]));

  const open = async (n: AppNotification) => {
    if (!n.read) {
      setItems((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
      api.markNotificationsRead([n.id]).then((r) => setUnread(r.unread)).catch(() => undefined);
    }
    if (n.order_id) router.push({ pathname: '/orders/[id]', params: { id: n.order_id } });
  };

  const readAll = async () => {
    try {
      const r = await api.markNotificationsRead('all');
      setUnread(r.unread);
      setItems((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    } catch (e) {
      setError(e);
    }
  };

  if (!items) {
    return error ? <View style={{ padding: space(4) }}><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={load} /></View>
      : <Loading label={t('loading')} />;
  }
  return (
    <FlatList
      testID="screen-notifications"
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View>
          {error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={load} /> : null}
          {unread ? <Button testID="read-all" compact kind="ghost" label={t('markAllRead')} onPress={readAll} style={{ alignSelf: 'flex-end' }} /> : null}
        </View>
      }
      ListEmptyComponent={<Empty label={t('noNotifications')} />}
      renderItem={({ item, index }) => (
        <Pressable testID={`notification-${index}`} onPress={() => open(item)} accessibilityRole="button"
          accessibilityLabel={`${item.read ? '' : `${t('unread')}, `}${item.title}. ${item.body}`}
          style={[styles.item, !item.read && styles.unread]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {!item.read ? <View style={styles.dot} /> : null}
            <T variant="label" style={{ flex: 1 }}>{item.title}</T>
          </View>
          <T variant="body" style={{ fontSize: 14 }}>{item.body}</T>
          <T variant="caption">{formatTime(item.created_at)}</T>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space(3), marginBottom: space(2), gap: space(1), minHeight: 56 },
  unread: { backgroundColor: colors.infoSoft },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand, marginRight: space(2) },
});
