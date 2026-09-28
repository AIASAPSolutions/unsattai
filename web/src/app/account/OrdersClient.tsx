'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FulfilmentChip } from '@/components/shop/orderBits';
import { Button, Empty, ErrorState, Skeleton } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { OrderSummary } from '@/lib/api/types';
import { formatDate, formatMoney } from '@/lib/price';
import s from './account.module.css';

const PAGE_SIZE = 20;

export function OrdersClient() {
  const { t, lang } = useI18n();
  const [page, setPage] = useState(1);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ orders: OrderSummary[] | null; total: number; error: unknown; forPage: number }>({
    orders: null, total: 0, error: null, forPage: 0,
  });

  useEffect(() => {
    let live = true;
    api.myOrders(page)
      .then((r) => live && setState({ orders: r.orders, total: r.total, error: null, forPage: page }))
      .catch((error) => live && setState((st) => ({ ...st, error, forPage: page })));
    return () => {
      live = false;
    };
  }, [page, nonce]);

  const loading = state.forPage !== page && !state.error;
  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));

  return (
    <section aria-labelledby="orders-h" data-testid="account-orders">
      <h2 id="orders-h">{t('accOrders')}</h2>
      {state.error ? (
        <ErrorState message={errorMessage(t, state.error)} retryLabel={t('retry')} onRetry={() => { setState((st) => ({ ...st, error: null, forPage: 0 })); setNonce((n) => n + 1); }} />
      ) : loading || !state.orders ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={76} />)}</div>
      ) : state.orders.length === 0 ? (
        <Empty title={t('accNoOrders')} testId="orders-empty">
          <p>{t('accNoOrdersText')}</p>
          <Button href="/design">{t('heroCta')}</Button>
        </Empty>
      ) : (
        <>
          <ul className={s.list}>
            {state.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${encodeURIComponent(o.id)}`} className={s.item} data-testid={`order-${o.id}`}>
                  <div>
                    <div className={s.itemTitle}>{o.number || o.id}{o.team_name ? ` · ${o.team_name}` : ''}</div>
                    <div className={s.itemMeta}>
                      {formatDate(o.created_at.slice(0, 10), lang, true)} · {t(`garment_${o.garment}` as 'garment_jersey')} · {t('piecesN', { n: o.pieces })}
                      {o.promised_delivery_date && o.fulfilment_status !== 'delivered' && o.fulfilment_status !== 'cancelled'
                        ? ` · ${t('promisedDelivery', { date: formatDate(o.promised_delivery_date, lang) })}` : ''}
                    </div>
                  </div>
                  <div className={s.itemRight}>
                    <FulfilmentChip status={o.fulfilment_status} hold={o.hold} />
                    {o.total !== null ? <span className="tnum">{formatMoney(o.total, o.currency ?? 'INR', lang)}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <div className={s.pager}>
              <Button kind="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('back')}</Button>
              <span className="small muted" style={{ alignSelf: 'center' }}>{t('of', { a: page, b: pages })}</span>
              <Button kind="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('continue')} →</Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
