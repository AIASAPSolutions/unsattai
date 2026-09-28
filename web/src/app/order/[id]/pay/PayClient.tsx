'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PriceSummary } from '@/components/shop/PriceSummary';
import { orderLabel, useOrder } from '@/components/shop/orderBits';
import { Banner, Button, Card, ErrorState, Loading } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import { formatDate, formatMoney } from '@/lib/price';
import s from '../order.module.css';

/** Demo payment: the store has no payment provider, so paying only confirms the order. */
export function PayClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { order, error, loading, retry } = useOrder(id, api.order);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const paid = !!order?.payment;

  useEffect(() => {
    if (paid) router.replace(`/order/${encodeURIComponent(id)}`);
  }, [paid, id, router]);

  if (loading) return <Loading label={t('loading')} />;
  if (error || !order) {
    return <div className="container page"><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} /></div>;
  }
  if (paid) return <Loading label={t('loading')} />;

  const pricing = order.pricing;
  const pay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      await api.confirmDemoPayment(order.id);
      router.replace(`/order/${encodeURIComponent(order.id)}?paid=1`);
    } catch (e) {
      setPayError(errorMessage(t, e));
      setPaying(false);
    }
  };
  const est = order.fulfilment?.estimate ?? pricing?.estimate;

  return (
    <div className="container page" data-testid="screen-pay">
      <h1>{t('payTitle')}</h1>
      <p className="muted">{t('payOrderRef', { ref: orderLabel(order) })}</p>
      <div className={s.layout}>
        <Card title={t('payment')}>
          <div className={s.demoBox} data-testid="demo-box">
            <strong>{t('demoNoMoney')}</strong>
            <p style={{ margin: '6px 0 0' }}>{t('demoPayNote')}</p>
          </div>
          {est ? (
            <p data-testid="pay-eta">
              {order.delivery?.method === 'pickup'
                ? t('estimatedPickup', { date: formatDate(est.ready_date, lang) })
                : t('estimatedDelivery', { date: formatDate(est.delivery_date, lang) })}
              <br /><span className="small muted">{t('etaNote')}</span>
            </p>
          ) : null}
          {payError ? <Banner tone="fail" live>{payError}</Banner> : null}
          {!order.manufacturing_ready ? <Banner tone="fail">{t('orderBlocked')}</Banner> : null}
          <div style={{ marginTop: 12 }}>
            <Button size="lg" block busy={paying} onClick={pay} disabled={!order.manufacturing_ready} testId="demo-pay">
              {pricing ? t('payDemoAmount', { amount: formatMoney(pricing.total, pricing.currency, lang) }) : t('demoPay')}
            </Button>
          </div>
        </Card>
        <Card title={t('priceTitle')}>
          {pricing ? <PriceSummary quote={pricing} showNudges={false} showDates={false} testId="pay-price" />
            : <p className="muted">{t('totalPieces', { n: order.total_pieces })}</p>}
        </Card>
      </div>
    </div>
  );
}
