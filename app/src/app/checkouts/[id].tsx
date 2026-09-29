import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { Checkout, Order } from '../../api/types';
import { orderTitle } from '../../features/orders/orders';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { useAuth } from '../../state/auth';
import { useDemoPayments } from '../../state/shopInfo';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { useVoiceGuide } from '../../voice/useVoiceGuide';

/** After placing: the checkout number, each seller's orders with dates, and "Pay now" if an online payment is still open. */
export default function ConfirmationScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const { speak } = useVoiceGuide();
  const [ck, setCk] = useState<Checkout | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const demo = useDemoPayments();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setCk(await api.getCheckout(id));
    } catch (e) {
      setLoadError(e);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!ck) {
    return (
      <Screen testID="screen-confirmation">
        {loadError ? <ErrorState message={errorMessage(t, loadError)} retryLabel={t('retry')} onRetry={load} /> : <Loading label={t('loading')} />}
      </Screen>
    );
  }

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.payCheckout(ck.id);
      setCk(next);
      speak(t('orderPlaced', { number: next.number }));
    } catch (e) {
      setError(demo.markOff(e) ? null : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const orders = ck.orders ?? [];
  const bySeller = new Map<string, { name: string; orders: Order[] }>();
  for (const o of orders) {
    const key = o.seller?.id ?? '';
    if (!bySeller.has(key)) bySeller.set(key, { name: o.seller?.name ?? '', orders: [] });
    bySeller.get(key)!.orders.push(o);
  }
  const open = ck.status !== 'paid';
  const cod = ck.payment_method === 'cod';
  return (
    <Screen testID="screen-confirmation" footer={
      <View style={{ gap: space(2) }}>
        {signedIn ? <Button testID="view-orders" kind="secondary" label={t('myOrdersTitle')} onPress={() => router.push('/account/orders')} /> : null}
        <Button testID="continue-shopping" label={t('continueShopping')} onPress={() => router.navigate('/shop')} />
      </View>
    }>
      <View style={[styles.hero, { backgroundColor: open ? colors.warnSoft : colors.passSoft }]}>
        <T variant="title" accessibilityRole="header" color={open ? colors.warn : colors.pass} testID="confirmation-title">
          {open ? t('paymentPendingTitle') : t('orderPlacedTitle')}
        </T>
        <T variant="label" testID="checkout-number">{t('checkoutNumber', { number: ck.number })}</T>
        <T variant="body">
          {cod ? t('codConfirmed', { total: formatMoney(ck.totals.total, ck.currency) })
            : open ? t('onlineNotPaid', { total: formatMoney(ck.totals.total, ck.currency) })
            : t('onlinePaid', { total: formatMoney(ck.totals.total, ck.currency) })}
        </T>
        <T variant="caption" testID="checkout-status">{t(cod ? 'payCod' : 'payOnline')} · {cod ? t('codNote') : open ? t('status_awaiting_payment') : t('paid')}</T>
      </View>

      {open && !cod ? (
        <Card title={t('payment')}>
          {demo.enabled ? (
            <>
              <T variant="caption" style={{ marginBottom: space(3) }}>{t('demoPayNote')}</T>
              <Button testID="pay-now" label={t('payNow', { total: formatMoney(ck.totals.total, ck.currency) })} onPress={pay} busy={busy} />
            </>
          ) : <Banner tone="info" text={t('demoPaymentsOffOrder')} testID="demo-pay-off" />}
          {error ? <Banner tone="fail" text={error} testID="pay-error" /> : null}
        </Card>
      ) : null}

      {[...bySeller.values()].map((g, gi) => (
        <Card key={gi} title={t('soldBy', { seller: g.name || t('noSeller') })} testID={`confirm-seller-${gi}`}>
          {g.orders.map((o) => {
            const f = o.fulfilment;
            const eta = f?.promised_delivery_date ?? f?.estimate?.delivery_date;
            return (
              <Pressable key={o.id} testID={`confirm-order-${o.id}`} accessibilityRole="button" style={styles.order}
                onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}>
                <View style={{ flex: 1 }}>
                  <T variant="label">{o.number ?? o.id} · {orderTitle(o)}</T>
                  <T variant="caption">{t('totalPieces', { n: o.total_pieces })} · {f ? tMaybe(t, `fstatus_${f.status}`, f.status) : ''}</T>
                  {eta ? <T variant="caption" color={colors.pass}>{t('deliveryBy', { date: formatDay(eta) })}</T> : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {o.pricing ? <T variant="label">{formatMoney(o.pricing.total, o.pricing.currency)}</T> : null}
                  <T variant="caption" color={colors.blue}>{t('viewOrder')} ›</T>
                </View>
              </Pressable>
            );
          })}
        </Card>
      ))}
      {!signedIn ? <Banner tone="info" text={t('guestOrdersHint')} action={t('signIn')} onAction={() => router.push('/sign-in')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: space(4), marginBottom: space(4), gap: space(1) },
  order: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line, minHeight: 56,
  },
});
