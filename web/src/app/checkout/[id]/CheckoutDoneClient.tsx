'use client';
import Link from 'next/link';
import { useDemoPayments } from '@/components/providers/data';
import { useSession } from '@/components/providers/session';
import { FulfilmentChip, fulfilmentStatus, invoiceUrl } from '@/components/shop/orderBits';
import { Banner, Button, Card, ErrorState, ExternalButton, Loading } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { formatDate, formatMoney } from '@/lib/price';
import s from '@/components/market/market.module.css';
import { orderTitle, ordersBySeller, useCheckout } from './useCheckout';

/** Confirmation after checkout: every order it made, grouped by seller, with dates and invoices. */
export function CheckoutDoneClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const { data, error, loading, retry } = useCheckout(id);
  const { demo } = useDemoPayments();

  if (loading) return <Loading label={t('loading')} />;
  if (error || !data) return <div className="container page"><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} /></div>;

  const money = (n: number) => formatMoney(n, data.currency, lang);
  const cod = data.payment_method === 'cod';
  const done = data.status === 'paid' || cod;
  const orders = data.orders ?? [];
  const groups = ordersBySeller(orders);

  return (
    <div className="container page" data-testid="screen-checkout-done">
      <section className={s.hero} aria-live="polite">
        {done ? <div className={s.tick} aria-hidden>✓</div> : null}
        <h1 style={{ margin: '4px 0' }}>{done ? t('checkoutDoneTitle') : t('fstatus_awaiting_payment')}</h1>
        <p className="muted" style={{ margin: 0 }}>{t('checkoutDoneText', { name: data.customer.name, n: orders.length })}</p>
        <div className={s.big} data-testid="checkout-number">{data.number}</div>
        <p style={{ margin: 0 }} data-testid="checkout-total">
          {cod ? t('codPayOnDelivery', { amount: money(data.totals.total) }) : t('paidTotal', { amount: money(data.totals.total) })}
        </p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
          {!done && demo ? <Button href={`/checkout/${encodeURIComponent(data.id)}/pay`} testId="go-pay">{t('payment')}</Button> : null}
          {me ? <Button kind="secondary" href="/account" testId="to-orders">{t('viewInAccount')}</Button> : null}
          <Button kind="ghost" href="/shop">{t('continueShopping')}</Button>
        </div>
      </section>
      {!done && !demo ? <div style={{ maxWidth: 820, margin: '0 auto 16px' }}><Banner tone="warn" testId="pay-coming-soon">{t('payComingSoonTitle')}. {t('payTeamWillContact')}</Banner></div> : null}
      {!me ? <div style={{ maxWidth: 820, margin: '0 auto 16px' }}><Banner tone="info">{t('guestCheckoutHint')}</Banner></div> : null}

      <div style={{ maxWidth: 820, margin: '0 auto' }} className="stack" data-testid="checkout-orders">
        {groups.map((g) => (
          <Card key={g.seller} title={g.seller ? t('soldBy', { seller: g.seller }) : t('orderLines')} testId="checkout-seller">
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} className="stack">
              {g.orders.map((o) => {
                const promised = o.fulfilment?.promised_delivery_date ?? o.fulfilment?.estimate?.delivery_date;
                const pickup = o.delivery?.method === 'pickup';
                return (
                  <li key={o.id} className={s.sellerGroup} data-testid={`checkout-order-${o.id}`}>
                    <div className={s.sellerHead}>
                      <span>
                        <strong data-testid="checkout-order-number">{o.number || o.id}</strong> · {orderTitle(o)}
                      </span>
                      <FulfilmentChip status={fulfilmentStatus(o)} />
                    </div>
                    <div className="small">
                      {t('piecesN', { n: o.total_pieces })} · {money(o.pricing?.total ?? 0)}
                      {promised ? <> · <strong style={{ color: 'var(--pass)' }}>
                        {pickup ? t('readyBy', { date: formatDate(pickup ? o.fulfilment?.promised_ship_date ?? promised : promised, lang) }) : t('deliveryBy', { date: formatDate(promised, lang) })}
                      </strong></> : null}
                    </div>
                    <div className="small muted">{t('orderIdLabel', { id: o.id })}</div>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <ExternalButton href={invoiceUrl(o.id)} kind="secondary" testId="checkout-invoice">{o.payment && !cod ? t('saveInvoice') : t('saveProforma')} ↗</ExternalButton>
                      {me ? <Button kind="ghost" size="sm" href={`/account/orders/${encodeURIComponent(o.id)}`}>{t('view')}</Button>
                        : <Button kind="ghost" size="sm" href={`/track?order=${encodeURIComponent(o.id)}`}>{t('navTrack')}</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
        <p className="small muted" style={{ textAlign: 'center' }}>{t('etaNote')} <Link href="/account/support">{t('orderHelp')}</Link></p>
      </div>
    </div>
  );
}
