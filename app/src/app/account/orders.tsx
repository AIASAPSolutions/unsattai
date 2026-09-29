import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { OrderSummary } from '../../api/types';
import { summaryTitle } from '../../features/orders/orders';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { useAuth } from '../../state/auth';
import { Button } from '../../ui/Button';
import { Empty, ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, shadow, space } from '../../ui/theme';

const TONE: Record<string, string> = {
  delivered: colors.pass, cancelled: colors.fail, awaiting_payment: colors.warn, dispatched: colors.info,
};

export default function MyOrdersScreen() {
  const t = useT();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.myOrders(1);
      setItems(res.orders);
      setTotal(res.total);
      setPage(1);
    } catch (e) {
      setError(e);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (signedIn) load();
    else router.replace('/sign-in');
  }, [signedIn, load]));

  const loadMore = async () => {
    if (!items || more || items.length >= total) return;
    setMore(true);
    try {
      const res = await api.myOrders(page + 1);
      setItems([...items, ...res.orders.filter((o) => !items.some((x) => x.id === o.id))]);
      setPage(page + 1);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
  };

  if (!items) {
    return error ? <View style={{ padding: space(4) }}><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={load} /></View>
      : <Loading label={t('loading')} />;
  }

  return (
    <FlatList
      testID="screen-my-orders"
      data={items}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={load} /> : null}
      ListEmptyComponent={
        <View testID="orders-empty">
          <Empty label={t('noOrders')} />
          <Button kind="secondary" label={t('browseShop')} onPress={() => router.navigate('/shop')} />
        </View>
      }
      ListFooterComponent={more ? <Loading label={t('loading')} /> : null}
      renderItem={({ item, index }) => (
        <Pressable testID={`my-order-${index}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/orders/[id]', params: { id: item.id } })}
          style={({ pressed }) => [styles.card, shadow, pressed && { opacity: 0.85 }]}>
          <View style={styles.head}>
            <T variant="label" style={{ flex: 1 }}>{item.number ?? item.id}</T>
            <T variant="label" color={TONE[item.fulfilment_status] ?? colors.ink} testID={`my-order-status-${index}`}>
              {tMaybe(t, `fstatus_${item.fulfilment_status}`, item.fulfilment_status)}
            </T>
          </View>
          <T variant="body">{summaryTitle(item)}</T>
          <T variant="caption">
            {t(`garment_${item.garment}`)} · {t('totalPieces', { n: item.pieces })}{item.seller_name ? ` · ${t('soldBy', { seller: item.seller_name })}` : ''}
          </T>
          <View style={styles.head}>
            <T variant="caption" style={{ flex: 1 }}>
              {t('orderedOn', { date: formatDay(item.created_at) })}
              {item.promised_delivery_date && !['delivered', 'cancelled'].includes(item.fulfilment_status)
                ? ` · ${t('deliveryBy', { date: formatDay(item.promised_delivery_date) })}` : ''}
            </T>
            {item.total !== null ? <T variant="label">{formatMoney(item.total, item.currency ?? 'INR')}</T> : null}
          </View>
          <T variant="caption">{item.payment_method === 'cod' ? t('payCod') : t('payOnline')}</T>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space(4), marginBottom: space(3), gap: space(1) },
  head: { flexDirection: 'row', alignItems: 'center' },
});
