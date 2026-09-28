import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { Order } from '../../api/types';
import { ChecksList } from '../../components/ChecksList';
import { PriceSummary } from '../../components/PriceSummary';
import { saveTextFile } from '../../features/share/saveFile';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatDay } from '../../lib/money';
import { useFlow } from '../../state/flow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { useVoiceGuide } from '../../voice/useVoiceGuide';

// Optional hand-off to a real checkout page. Only the order id travels in the link: never an API key.
const CHECKOUT_URL = process.env.EXPO_PUBLIC_CHECKOUT_URL;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function OrderStatusScreen() {
  const t = useT();
  const { id, duplicate } = useLocalSearchParams<{ id: string; duplicate?: string }>();
  const lastOrder = useFlow((s) => s.lastOrder);
  const setLastOrder = useFlow((s) => s.setLastOrder);
  const reset = useFlow((s) => s.reset);
  const { speak } = useVoiceGuide();
  const [order, setOrder] = useState<Order | null>(lastOrder?.id === id ? lastOrder : null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const o = await api.order(id);
      setOrder(o);
      setLastOrder(o);
    } catch (e) {
      setLoadError(e);
    }
  }, [id, setLastOrder]);

  useEffect(() => {
    load();
  }, [load]);

  if (!order) {
    return (
      <Screen>
        {loadError ? <ErrorState message={errorMessage(t, loadError)} retryLabel={t('retry')} onRetry={load} /> : <Loading label={t('loading')} />}
      </Screen>
    );
  }

  const pay = async () => {
    setBusy('pay');
    setError(null);
    try {
      const o = await api.confirmDemoPayment(order.id);
      setOrder(o);
      setLastOrder(o);
      speak(t(`status_${o.status}`));
    } catch (e) {
      const msg = errorMessage(t, e);
      setError(msg);
      speak(msg);
      load();
    } finally {
      setBusy(null);
    }
  };

  const download = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const svg = await api.orderFile(order.id, name);
      const out = await saveTextFile(name, svg, 'image/svg+xml');
      if (out === 'unavailable') setError(t('shareFailed'));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const saveInvoice = async () => {
    setBusy('invoice');
    setError(null);
    try {
      const html = await api.invoice(order.id);
      const out = await saveTextFile(`invoice-${order.number ?? order.id}.html`, html, 'text/html');
      if (out === 'unavailable') setError(t('shareFailed'));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const f = order.fulfilment;
  const eta = f?.promised_delivery_date ?? f?.estimate?.delivery_date ?? null;
  const pickup = order.delivery?.method === 'pickup';
  const stages = f?.stages ?? [];
  const receipt = order.factory;
  const paid = order.status !== 'awaiting_payment';
  const statusTone = order.status === 'paid_release_failed' ? colors.fail : paid ? colors.pass : colors.warn;

  return (
    <Screen testID="screen-order-status">
      <T variant="title" accessibilityRole="header">{t('orderStatus', { id: order.number ?? order.id })}</T>
      <View style={[styles.badge, { borderColor: statusTone }]}>
        <T variant="label" color={statusTone} testID="order-status">{t(`status_${order.status}`)}</T>
      </View>
      {duplicate === '1' || order.duplicate ? <Banner tone="info" text={t('duplicateOrder')} testID="duplicate-order" /> : null}

      {f ? (
        <Card title={t('progress')}>
          <T variant="label" testID="fulfilment-status">{tMaybe(t, `fstatus_${f.status}`, f.status)}</T>
          {f.hold ? <Banner tone="warn" text={t('onHold')} testID="on-hold" /> : null}
          {eta && f.status !== 'delivered' && f.status !== 'cancelled' ? (
            <T variant="body" style={{ marginTop: space(1) }} testID="order-eta">
              {t(f.promised_delivery_date ? (pickup ? 'promisedPickup' : 'promisedDelivery') : (pickup ? 'estimatedPickup' : 'estimatedDelivery'),
                { date: formatDay(pickup ? (f.promised_ship_date ?? f.estimate?.ship_date) : eta) })}
            </T>
          ) : null}
          {f.rush ? <T variant="caption">{t('expressChosen')}</T> : null}
          {stages.length ? (
            <View style={styles.stages} testID="stages">
              {stages.map((st) => (
                <View key={st.id} style={styles.stage}>
                  <T variant="label" color={st.done_at ? colors.pass : colors.muted}>{st.done_at ? '✓' : '○'}</T>
                  <T variant="body" style={{ flex: 1, marginLeft: space(2) }} color={st.done_at ? colors.ink : colors.muted}>{st.name}</T>
                  {st.done_at ? <T variant="caption">{formatTime(st.done_at)}</T> : null}
                </View>
              ))}
            </View>
          ) : null}
          {order.timeline?.length ? (
            <View style={{ marginTop: space(3) }} testID="timeline">
              <T variant="label" style={{ marginBottom: space(1) }}>{t('updates')}</T>
              {[...order.timeline].reverse().map((e, i) => (
                <View key={`${e.at}-${i}`} style={styles.event}>
                  <T variant="caption">{formatTime(e.at)}</T>
                  <T variant="body">{e.text}</T>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      {order.pricing ? (
        <Card title={t('priceTitle')}>
          <PriceSummary pricing={order.pricing} compact />
          <Button testID="save-invoice" kind="secondary" label={paid ? t('saveInvoice') : t('saveProforma')} style={{ marginTop: space(3) }}
            busy={busy === 'invoice'} disabled={busy !== null} onPress={saveInvoice} />
        </Card>
      ) : null}

      <Card title={t('orderLines')}>
        {order.lines.map((l) => (
          <View key={l.line} style={styles.line}>
            <T variant="body" style={{ flex: 1 }}>{t('line', { n: l.line })}: {[l.player_name, l.number].filter(Boolean).join(' · ') || '—'}</T>
            <T variant="label">{l.size} × {l.quantity}</T>
          </View>
        ))}
        <T variant="label" style={{ marginTop: space(2) }}>{t('totalPieces', { n: order.total_pieces })}</T>
      </Card>

      <Card title={t('checksTitle')}>
        <Banner tone={order.manufacturing_ready ? 'pass' : 'fail'} text={order.manufacturing_ready ? t('checksReady') : t('checksBlocked')} />
        <ChecksList checks={order.checks} compact />
      </Card>

      {!paid ? (
        <Card title={t('payment')}>
          <T variant="caption" style={{ marginBottom: space(3) }}>{t('demoPayNote')}</T>
          <Button testID="demo-pay" label={t('demoPay')} onPress={pay} busy={busy === 'pay'} disabled={busy !== null || !order.manufacturing_ready} />
          {CHECKOUT_URL ? (
            <Button kind="secondary" label={t('checkout')} style={{ marginTop: space(2) }}
              onPress={() => Linking.openURL(`${CHECKOUT_URL}${CHECKOUT_URL.includes('?') ? '&' : '?'}order_id=${encodeURIComponent(order.id)}`)} />
          ) : null}
        </Card>
      ) : (
        <Card title={t('payment')}>
          {order.payment ? <Banner tone="info" text={t('paidDemo', { ref: order.payment.reference })} testID="paid-demo" /> : null}
          {order.status === 'paid_release_failed' ? (
            <Banner tone="fail" text={receipt?.error ?? t('status_paid_release_failed')} action={t('retry')} onAction={pay} />
          ) : null}
          {receipt ? (
            <View testID="receipt">
              <Banner tone={receipt.factory_connected ? 'pass' : 'warn'}
                text={receipt.factory_connected ? t('factoryQueue') : t('testQueue')} testID="queue-note" />
              <View style={styles.kv}><T variant="caption">{t('jobId')}</T><T variant="label" selectable testID="job-id">{receipt.job_id}</T></View>
              <View style={styles.kv}><T variant="caption">{t('queue')}</T><T variant="label">{receipt.queue}</T></View>
              <View style={styles.kv}><T variant="caption">{t('acceptedAt')}</T><T variant="label">{formatTime(receipt.accepted_at)}</T></View>
              <View style={styles.kv}><T variant="caption">{t('duplicateReceipt')}</T><T variant="label">{receipt.duplicate ? t('yes') : t('no')}</T></View>
            </View>
          ) : null}
        </Card>
      )}

      <Card title={t('printFiles')}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('filesNote')}</T>
        {order.files.map((f) => (
          <View key={f.name} style={styles.line}>
            <View style={{ flex: 1 }}>
              <T variant="label" numberOfLines={1}>{f.name}</T>
              <T variant="caption">{t('line', { n: f.line })} · {f.size} · {f.panel}{f.player_name ? ` · ${f.player_name}` : ''}{f.number ? ` ${f.number}` : ''}</T>
            </View>
            <Button compact kind="secondary" label={t('download')} busy={busy === f.name} disabled={busy !== null} onPress={() => download(f.name)} />
          </View>
        ))}
      </Card>

      {order.notes.length ? (
        <Card>
          {order.notes.map((n, i) => <T key={i} variant="caption" style={{ marginBottom: space(1) }}>• {n}</T>)}
        </Card>
      ) : null}

      {error ? <Banner tone="fail" text={error} testID="status-error" /> : null}
      <Button kind="secondary" label={t('refresh')} onPress={load} style={{ marginBottom: space(2) }} />
      <Button testID="new-design" kind="ghost" label={t('newDesign')} onPress={() => {
        reset();
        router.replace('/');
      }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderWidth: 2, borderRadius: radius.pill, paddingHorizontal: space(3), paddingVertical: space(1), marginVertical: space(3) },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  stages: { marginTop: space(3) },
  stage: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(1) },
  event: { paddingVertical: space(1.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space(1.5) },
});
