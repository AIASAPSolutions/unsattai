'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Button, Card, ErrorState, Loading } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import { formatDate, formatMoney } from '@/lib/price';
import s from '@/components/market/market.module.css';
import { orderTitle, ordersBySeller, useCheckout } from '../useCheckout';

/** Demo payment for a whole checkout: the store has no payment provider, so paying only confirms the orders. */
export function CheckoutPayClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data, error, loading, retry } = useCheckout(id);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const paid = data?.status === 'paid' || data?.payment_method === 'cod';

  useEffect(() => {
    if (paid) router.replace(`/checkout/${encodeURIComponent(id)}`);
  }, [paid, id, router]);

  if (loading) return <Loading label={t('loading')} />;
  if (error || !data) return <div className="container page"><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={retry} /></div>;
  if (paid) return <Loading label={t('loading')} />;

  const money = (n: number) => formatMoney(n, data.currency, lang);
  const pay = async () => {
    setPaying(true);
    setPayError(null);
    try {
      await api.payCheckout(data.id);
      router.replace(`/checkout/${encodeURIComponent(data.id)}?paid=1`);
    } catch (e) {
      setPayError(errorMessage(t, e));
      setPaying(false);
    }
  };

  return (
    <div className="container page" data-testid="screen-pay">
      <h1>{t('payTitle')}</h1>
      <p className="muted">{t('checkoutRef', { ref: data.number, n: data.order_ids.length })}</p>
      <div className={s.cartLayout}>
        <Card title={t('payment')}>
          <div className={s.demoBox} data-testid="demo-box">
            <strong>{t('demoNoMoney')}</strong>
            <p style={{ margin: '6px 0 0' }}>{t('demoPayNote')}</p>
          </div>
          {payError ? <div style={{ marginTop: 12 }}><Banner tone="fail" live>{payError}</Banner></div> : null}
          <div style={{ marginTop: 14 }}>
            <Button size="lg" block kind="accent" busy={paying} onClick={pay} testId="demo-pay">
              {t('payDemoAmount', { amount: money(data.totals.total) })}
            </Button>
          </div>
        </Card>
        <Card title={t('orderSummary')}>
          {ordersBySeller(data.orders ?? []).map((g) => (
            <div key={g.seller} className={s.sellerGroup}>
              <strong>{g.seller ? t('soldBy', { seller: g.seller }) : null}</strong>
              <ul className="small" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
                {g.orders.map((o) => (
                  <li key={o.id}>
                    {orderTitle(o)} · {t('piecesN', { n: o.total_pieces })} · {money(o.pricing?.total ?? 0)}
                    {o.fulfilment?.estimate ? ` · ${t('deliveryBy', { date: formatDate(o.fulfilment.estimate.delivery_date, lang) })}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: 0 }} className="tnum">{t('total')}: {money(data.totals.total)}</p>
        </Card>
      </div>
    </div>
  );
}
