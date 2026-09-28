'use client';
import { useSession } from '@/components/providers/session';
import { OrderDetail } from '@/components/shop/OrderDetail';
import { invoiceUrl, orderLabel, useOrder } from '@/components/shop/orderBits';
import { Banner, Button, ErrorState, ExternalButton, Loading } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import { formatDate } from '@/lib/price';
import s from './order.module.css';

export function ConfirmationClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const { order, error, loading, retry } = useOrder(id, api.order);

  if (loading) return <Loading label={t('loading')} />;
  if (error || !order) {
    return <div className="container page"><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} /></div>;
  }

  const paid = !!order.payment;
  const f = order.fulfilment;
  const pickup = order.delivery?.method === 'pickup';
  const promised = pickup ? f?.promised_ship_date : f?.promised_delivery_date;

  return (
    <div className="container page" data-testid="screen-confirmation">
      <section className={s.hero} aria-live="polite">
        {paid ? (
          <>
            <div className={s.tick} aria-hidden>✓</div>
            <h1 style={{ margin: '4px 0' }}>{t('orderConfirmedTitle')}</h1>
            <p className="muted" style={{ margin: 0 }}>{t('orderConfirmedText', { name: order.customer.name })}</p>
          </>
        ) : (
          <h1>{t('fstatus_awaiting_payment')}</h1>
        )}
        <p style={{ marginBottom: 0 }}>{t('orderNumber')}</p>
        <div className={s.number} data-testid="confirmation-number">{orderLabel(order)}</div>
        {order.number ? <p className="small muted" style={{ margin: 0 }} data-testid="confirmation-id">{t('orderIdLabel', { id: order.id })}</p> : null}
        {promised ? (
          <p className={s.date} data-testid="confirmation-promised">
            {t(pickup ? 'promisedPickup' : 'promisedDelivery', { date: formatDate(promised, lang, true) })}
          </p>
        ) : null}
        {order.payment?.demo ? <p className="small muted">{t('paidDemo', { ref: order.payment.reference })}</p> : null}
        <div className={s.actions}>
          {!paid ? <Button href={`/order/${encodeURIComponent(order.id)}/pay`} testId="go-pay">{t('payment')}</Button> : null}
          <ExternalButton href={invoiceUrl(order.id)} testId="confirmation-invoice">{paid ? t('saveInvoice') : t('saveProforma')} ↗</ExternalButton>
          {me ? <Button kind="secondary" href={`/account/orders/${encodeURIComponent(order.id)}`}>{t('viewInAccount')}</Button>
            : <Button kind="secondary" href={`/track?order=${encodeURIComponent(order.id)}`}>{t('navTrack')}</Button>}
          <Button kind="ghost" href="/design">{t('newDesign')}</Button>
        </div>
        {!me ? <Banner tone="info">{t('guestTrackHint', { id: order.id })}</Banner> : null}
      </section>
      <div style={{ maxWidth: 820, margin: '16px auto 0' }}>
        <OrderDetail order={order} />
      </div>
    </div>
  );
}
