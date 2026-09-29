'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useCatalogue } from '@/components/providers/data';
import { OrderDetail } from '@/components/shop/OrderDetail';
import { useOrder } from '@/components/shop/orderBits';
import { Banner, Button, ErrorState, Loading, Modal, SelectField, Stars, TextArea, TextField } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Order, Reorder } from '@/lib/api/types';
import { productEntry } from '@/lib/cart';
import { EMPTY_ADDRESS, flow, flowStore, rowKey } from '@/lib/flow';
import { formatDate } from '@/lib/price';
import { cart } from '@/lib/shopStore';
import { whenHydrated } from '@/lib/store';

/** Put a previous order back into the studio flow's options page, ready to change and order again. */
export async function applyReorder(r: Reorder) {
  await whenHydrated(flowStore);
  flow.openSpec(r.spec, r.design_id, 'reorder');
  const ty = r.spec.typography;
  const single = r.items.length === 1 && r.items[0].player_name === ty.player_name && r.items[0].number === ty.number;
  const cur = flowStore.get().checkout;
  flow.setCheckout({
    mode: single ? 'single' : 'team',
    single: single ? { size: r.items[0].size, quantity: r.items[0].quantity } : cur.single,
    rows: single ? [] : r.items.map((it) => ({ ...it, key: rowKey() })),
    fabric: r.fabric || cur.fabric,
    method: r.delivery.method ?? cur.method,
    address: r.delivery.address ? { ...EMPTY_ADDRESS, ...r.delivery.address } : cur.address,
    rush: false, coupon: '',
  });
}

type Dialog = 'cancel' | 'return' | 'review' | null;

export function AccountOrderClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { order, error, loading, retry, replace } = useOrder(id, api.myOrder);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  if (loading) return <Loading label={t('loading')} />;
  if (error || !order) return <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} />;

  const again = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (order.product_id) {
        const fabric = order.pricing?.fabric.id ?? 'standard';
        const r = cart.add(productEntry(order.product_id, fabric, order.lines.map(({ player_name, number, size, quantity }) => ({ player_name, number, size, quantity }))));
        if (r.outcome === 'full') throw new Error(t('cartFull'));
        router.push('/cart');
        return;
      }
      await applyReorder(await api.reorder(order.id));
      router.push('/configure');
    } catch (e) {
      setMsg({ tone: 'fail', text: errorMessage(t, e) });
      setBusy(false);
    }
  };

  const done = (o: Order, text: string) => {
    replace(o);
    setDialog(null);
    setMsg({ tone: 'pass', text });
  };

  return (
    <div className="stack" data-testid="account-order">
      <div><Button kind="ghost" size="sm" href="/account">← {t('accOrders')}</Button></div>
      {msg ? <Banner tone={msg.tone} live testId="order-msg">{msg.text}</Banner> : null}
      {!order.payment && order.fulfilment?.status !== 'cancelled' ? (
        <Banner tone="warn" action={t('payment')} onAction={() => router.push(
          order.checkout_id ? `/checkout/${encodeURIComponent(order.checkout_id)}/pay` : `/order/${encodeURIComponent(order.id)}/pay`)}>
          {t('fstatus_awaiting_payment')}
        </Banner>
      ) : null}
      {order.can_return && order.return_until ? (
        <Banner tone="info" testId="return-window">{t('returnUntil', { date: formatDate(order.return_until, lang) })}</Banner>
      ) : null}
      <OrderDetail order={order} extraActions={(
        <>
          <Button kind="primary" busy={busy} onClick={again} testId="order-again">{t('buyAgain')}</Button>
          {order.can_cancel ? <Button kind="danger" onClick={() => setDialog('cancel')} testId="order-cancel">{t('cancelOrder')}</Button> : null}
          {order.can_return ? <Button kind="secondary" onClick={() => setDialog('return')} testId="order-return">{t('returnItems')}</Button> : null}
          {order.fulfilment?.status === 'delivered' && !order.review ? (
            <Button kind="secondary" onClick={() => setDialog('review')} testId="order-review-btn">{t('writeReview')}</Button>
          ) : null}
          <Button kind="ghost" href={`/account/support?order=${encodeURIComponent(order.id)}`} testId="order-help">{t('orderHelp')}</Button>
        </>
      )} />
      <Modal open={dialog === 'cancel'} onClose={() => setDialog(null)} title={t('cancelOrder')} closeLabel={t('close')} testId="cancel-dialog">
        <CancelForm order={order} onDone={(o) => done(o, t('orderCancelled'))} />
      </Modal>
      <Modal open={dialog === 'return'} onClose={() => setDialog(null)} title={t('returnItems')} closeLabel={t('close')} testId="return-dialog">
        <ReturnForm order={order} onDone={(o) => done(o, t('returnRequested'))} />
      </Modal>
      <Modal open={dialog === 'review'} onClose={() => setDialog(null)} title={t('writeReview')} closeLabel={t('close')} testId="review-dialog">
        <ReviewForm order={order} onDone={(o) => done(o, t('reviewThanks'))} />
      </Modal>
    </div>
  );
}

const CANCEL_REASONS = ['cancel_changed_mind', 'cancel_wrong_details', 'cancel_ordered_twice', 'cancel_too_slow'] as const;

function CancelForm({ order, onDone }: { order: Order; onDone: (o: Order) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = reason === 'other' ? other.trim() : t(reason as (typeof CANCEL_REASONS)[number]);
    if (text.length < 3) {
      setErr(t('reasonNeeded'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      onDone(await api.cancelOrder(order.id, text.slice(0, 300)));
    } catch (x) {
      setErr(errorMessage(t, x));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <p style={{ margin: 0 }}>{order.payment && order.payment_method !== 'cod' ? t('cancelRefundNote') : t('cancelNote')}</p>
      <SelectField label={t('cancelReason')} value={reason} onValue={setReason} testId="cancel-reason">
        {CANCEL_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
        <option value="other">{t('reasonOther')}</option>
      </SelectField>
      {reason === 'other' ? <TextField label={t('reasonDetails')} value={other} onValue={setOther} maxLength={300} testId="cancel-other" /> : null}
      {err ? <Banner tone="fail">{err}</Banner> : null}
      <div><Button type="submit" kind="danger" busy={busy} testId="cancel-confirm">{t('cancelOrder')}</Button></div>
    </form>
  );
}

function ReturnForm({ order, onDone }: { order: Order; onDone: (o: Order) => void }) {
  const { t, lang } = useI18n();
  const { catalogue } = useCatalogue();
  const reasons = catalogue?.returns?.reasons ?? ['damaged', 'wrong_item', 'print_quality'];
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const some = order.lines.length > 1;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setErr(t('reasonNeeded'));
      return;
    }
    const lines = some ? Object.entries(qty).filter(([, q]) => q > 0).map(([line, quantity]) => ({ line: Number(line), quantity })) : [];
    setBusy(true);
    setErr(null);
    try {
      const r = await api.requestReturn(order.id, { reason, details: details.trim(), lines: lines.length ? lines : null });
      onDone(r.order);
    } catch (x) {
      setErr(errorMessage(t, x));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      {order.return_until ? <p style={{ margin: 0 }} data-testid="return-deadline">{t('returnUntil', { date: formatDate(order.return_until, lang) })}</p> : null}
      <p className="small muted" style={{ margin: 0 }}>{t('returnPolicy')}</p>
      <SelectField label={t('returnReason')} value={reason} onValue={setReason} testId="return-reason">
        <option value="">{t('selectPlaceholder')}</option>
        {reasons.map((r) => <option key={r} value={r}>{tMaybe(t, `reason_${r}`, r.replace(/_/g, ' '))}</option>)}
      </SelectField>
      <TextArea label={t('returnDetails')} value={details} onValue={setDetails} maxLength={2000} optional={t('optional')} testId="return-details" />
      {some ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>{t('returnWhich')}</legend>
          {order.lines.map((l) => (
            <TextField key={l.line} label={`${t('line', { n: l.line })}: ${l.size} ${[l.player_name, l.number].filter(Boolean).join(' ')} (${l.quantity})`}
              type="number" min={0} max={l.quantity} value={qty[l.line] ?? ''} testId={`return-line-${l.line}`}
              onValue={(v) => setQty((q) => ({ ...q, [l.line]: Math.max(0, Math.min(l.quantity, Math.floor(Number(v) || 0))) }))} />
          ))}
        </fieldset>
      ) : null}
      {err ? <Banner tone="fail">{err}</Banner> : null}
      <div><Button type="submit" busy={busy} testId="return-submit">{t('returnSubmit')}</Button></div>
    </form>
  );
}

function ReviewForm({ order, onDone }: { order: Order; onDone: (o: Order) => void }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating) {
      setErr(t('ratingNeeded'));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.review(order.id, { rating, title: title.trim(), body: body.trim() });
      onDone(r.order);
    } catch (x) {
      setErr(errorMessage(t, x));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="stack" noValidate>
      <div>
        <div className="small" style={{ fontWeight: 600 }}>{t('yourRating')}</div>
        <Stars value={rating} onChange={setRating} label={t('yourRating')} testId="review-stars" />
      </div>
      <TextField label={t('reviewTitle')} value={title} onValue={setTitle} maxLength={120} optional={t('optional')} testId="review-title" />
      <TextArea label={t('reviewBody')} value={body} onValue={setBody} maxLength={4000} optional={t('optional')} testId="review-body" />
      <p className="small muted" style={{ margin: 0 }}>{t('reviewPublicNote')}</p>
      {err ? <Banner tone="fail">{err}</Banner> : null}
      <div><Button type="submit" busy={busy} testId="review-submit">{t('reviewSubmit')}</Button></div>
    </form>
  );
}
