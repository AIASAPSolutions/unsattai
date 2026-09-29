import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { Order } from '../../api/types';
import { CANCEL_REASONS, canReview, orderTitle, returnOpen } from '../../features/orders/orders';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatDay } from '../../lib/money';
import { useCart } from '../../state/cart';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { Sheet } from '../../ui/Sheet';
import { Stars } from '../../ui/Stars';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';

type Note = { tone: 'pass' | 'fail' | 'info'; text: string; cart?: boolean } | null;

/** Cancel, return, review and buy again, shown only when the server says they are allowed. */
export function OrderActions({ order, signedIn, reasons, onChanged }: {
  order: Order; signedIn: boolean; reasons: string[]; onChanged: (o: Order) => void;
}) {
  const t = useT();
  const addToCart = useCart((s) => s.add);
  const [sheet, setSheet] = useState<'cancel' | 'return' | null>(null);
  const [cancelReason, setCancelReason] = useState<string>(CANCEL_REASONS[0]);
  const [cancelText, setCancelText] = useState('');
  const [retReason, setRetReason] = useState(reasons[0] ?? '');
  const [retDetails, setRetDetails] = useState('');
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  const run = async (key: string, fn: () => Promise<Order>, done: string) => {
    setBusy(key);
    setNote(null);
    try {
      onChanged(await fn());
      setNote({ tone: 'pass', text: done });
      setSheet(null);
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    const reason = cancelReason === 'other' ? cancelText.trim() : t(`cancel_${cancelReason as 'other'}`);
    if (reason.length < 3) return;
    run('cancel', () => api.cancelOrder(order.id, reason), t('orderCancelled'));
  };
  const requestReturn = () => run('return', async () => (await api.requestReturn(order.id, { reason: retReason, details: retDetails.trim() })).order,
    t('returnRequested'));
  const review = () => run('review', async () => (await api.reviewOrder(order.id, { rating, title: title.trim(), body: body.trim() })).order,
    t('reviewThanks'));

  const buyAgain = () => {
    const fabric = order.pricing?.fabric.id ?? 'standard';
    const lines = order.lines.map(({ player_name, number, size, quantity }) => ({ player_name, number, size, quantity }));
    const res = addToCart(order.product_id
      ? { item: { product_id: order.product_id, fabric, lines }, title: orderTitle(order), garment: order.garment }
      : { item: { spec: order.spec, design_id: order.design_id || '', fabric, lines }, title: orderTitle(order), garment: order.garment });
    setNote(res.outcome === 'full' ? { tone: 'fail', text: t('cartFull') } : { tone: 'pass', text: t('addedToCart', { title: orderTitle(order) }), cart: true });
  };

  const openReturn = (order.returns ?? []).filter((r) => !['resolved', 'rejected'].includes(r.status));
  const canRet = returnOpen(order);
  const showReview = canReview(order);
  const cancellable = !!order.can_cancel;
  return (
    <Card title={t('orderActions')} testID="order-actions">
      {!signedIn && (cancellable || canRet || showReview) ? (
        <Banner tone="info" text={t('signInToManage')} action={t('signIn')} onAction={() => router.push('/sign-in')} />
      ) : null}
      {(order.returns ?? []).map((r) => (
        <View key={r.id} style={styles.box} testID={`return-${r.number}`}>
          <T variant="label">{t('returnNumber', { number: r.number })} · {tMaybe(t, `rstatus_${r.status}`, r.status)}</T>
          <T variant="caption">{tMaybe(t, `reason_${r.reason}`, r.reason)}{r.details ? ` · ${r.details}` : ''}</T>
          {r.note ? <T variant="caption" color={colors.info}>{r.note}</T> : null}
        </View>
      ))}
      {order.review ? (
        <View style={styles.box} testID="my-review">
          <T variant="label" color={colors.warn}>{'★'.repeat(order.review.rating)}{'☆'.repeat(5 - order.review.rating)}  {order.review.title}</T>
          {order.review.body ? <T variant="body">{order.review.body}</T> : null}
          <T variant="caption">{t('yourReview')}{order.review.hidden ? ` · ${t('reviewHidden')}` : ''}</T>
        </View>
      ) : null}

      {signedIn && showReview ? (
        <View style={styles.box} testID="review-form">
          <T variant="label">{t('rateOrder')}</T>
          <Stars testID="review-stars" label={t('rateOrder')} value={rating} onChange={setRating} />
          <Field testID="review-title" label={`${t('reviewTitle')} (${t('optional')})`} value={title} onChangeText={setTitle} maxLength={120} />
          <Field testID="review-body" label={`${t('reviewBody')} (${t('optional')})`} value={body} onChangeText={setBody} maxLength={4000} multiline />
          <Button testID="submit-review" label={t('submitReview')} onPress={review} busy={busy === 'review'} disabled={!rating || !!busy} />
        </View>
      ) : null}

      <View style={styles.row}>
        {signedIn && cancellable ? (
          <Button testID="cancel-order" kind="danger" compact label={t('cancelOrder')} onPress={() => { setNote(null); setSheet('cancel'); }} />
        ) : null}
        {signedIn && canRet && !openReturn.length ? (
          <Button testID="return-order" kind="secondary" compact label={t('returnOrder')} onPress={() => { setNote(null); setSheet('return'); }} />
        ) : null}
        <Button testID="buy-again" kind="secondary" compact label={t('buyAgain')} onPress={buyAgain} />
      </View>
      {canRet && order.return_until ? (
        <T variant="caption" testID="return-until">{t('returnUntil', { date: formatDay(order.return_until) })}</T>
      ) : null}
      {note ? <Banner tone={note.tone} text={note.text} testID="action-result"
        action={note.cart ? t('goToCart') : undefined}
        onAction={() => router.navigate('/cart')} /> : null}

      <Sheet visible={sheet === 'cancel'} title={t('cancelOrder')} onClose={() => setSheet(null)} testID="cancel-sheet" footer={
        <Button testID="confirm-cancel" kind="danger" label={t('cancelOrder')} onPress={cancel} busy={busy === 'cancel'}
          disabled={!!busy || (cancelReason === 'other' && cancelText.trim().length < 3)} />
      }>
        <T variant="caption" style={{ marginBottom: space(3) }}>{order.payment && order.payment_method !== 'cod' ? t('cancelRefundNote') : t('cancelNote')}</T>
        {CANCEL_REASONS.map((r) => (
          <Choice key={r} testID={`cancel-reason-${r}`} on={cancelReason === r} label={t(`cancel_${r}`)} onPress={() => setCancelReason(r)} />
        ))}
        {cancelReason === 'other' ? (
          <Field testID="cancel-text" label={t('tellUsWhy')} value={cancelText} onChangeText={setCancelText} maxLength={300} />
        ) : null}
        {note?.tone === 'fail' ? <Banner tone="fail" text={note.text} /> : null}
      </Sheet>

      <Sheet visible={sheet === 'return'} title={t('returnOrder')} onClose={() => setSheet(null)} testID="return-sheet" footer={
        <Button testID="confirm-return" label={t('requestReturn')} onPress={requestReturn} busy={busy === 'return'} disabled={!!busy || !retReason} />
      }>
        <T variant="caption" style={{ marginBottom: space(3) }}>
          {t('returnPolicy')}{order.return_until ? ` ${t('returnUntil', { date: formatDay(order.return_until) })}` : ''}
        </T>
        {reasons.map((r) => (
          <Choice key={r} testID={`return-reason-${r}`} on={retReason === r} label={tMaybe(t, `reason_${r}`, r)} onPress={() => setRetReason(r)} />
        ))}
        <Field testID="return-details" label={`${t('returnDetails')} (${t('optional')})`} value={retDetails} onChangeText={setRetDetails}
          maxLength={1000} multiline />
        {note?.tone === 'fail' ? <Banner tone="fail" text={note.text} /> : null}
      </Sheet>
    </Card>
  );
}

function Choice({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      style={[styles.choice, on && styles.choiceOn]}>
      <T variant="label">{on ? '◉' : '○'} {label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(1) },
  box: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  choice: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(2), minHeight: 48, justifyContent: 'center' },
  choiceOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
