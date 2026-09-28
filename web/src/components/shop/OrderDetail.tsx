'use client';
import { useEffect, useState } from 'react';
import { PriceSummary } from '@/components/shop/PriceSummary';
import { FulfilmentChip, fulfilmentStatus, invoiceUrl, orderLabel } from '@/components/shop/orderBits';
import { Banner, Card, Skeleton, SvgImg, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Order } from '@/lib/api/types';
import { formatDate, formatDateTime } from '@/lib/price';
import { stateName } from '@/lib/states';
import s from './orderDetail.module.css';

/** Mock-up of an order's own spec (the design may not be stored on the server under its id). */
export function OrderMockup({ order, className }: { order: Order; className?: string }) {
  const { t } = useI18n();
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api.render(order.spec, [], c.signal).then((p) => setSvg(p.mockup_svg)).catch(() => undefined);
    return () => c.abort();
  }, [order.spec]);
  return svg ? <SvgImg svg={svg} alt={order.spec.style_name || t('checkoutYourDesign')} className={className} testId="order-mockup" />
    : <Skeleton height={200} className={className} />;
}

/** Everything a customer can see about one order: status, dates, progress, shipments, lines and price. */
const EVENT_KEYS = ['placed', 'paid', 'planned', 'hold', 'resumed', 'ready', 'delivered', 'cancelled'] as const;

/** Timeline texts come from the server in English; the ones without parameters are translated here. */
export function eventText(t: ReturnType<typeof useI18n>['t'], e: { code: string; text: string }): string {
  return (EVENT_KEYS as readonly string[]).includes(e.code) ? t(`ev_${e.code}` as 'ev_placed') : e.text;
}

export function OrderDetail({ order, extraActions }: { order: Order; extraActions?: React.ReactNode }) {
  const { t, lang } = useI18n();
  const f = order.fulfilment;
  const status = fulfilmentStatus(order);
  const pickup = order.delivery?.method === 'pickup';
  const promised = pickup ? f?.promised_ship_date : f?.promised_delivery_date;
  const estimate = f?.estimate ?? order.pricing?.estimate;
  const addr = order.delivery?.address;
  const stages = f?.stages ?? [];
  const doneCount = stages.filter((x) => x.done_at).length;
  const timeline = [...(order.timeline ?? [])].reverse();
  const paid = !!order.payment;

  return (
    <div className="stack" style={{ gap: 20 }} data-testid="order-detail">
      <Card>
        <div className={s.head}>
          <div>
            <div className="small muted">{t('orderNumber')}</div>
            <div className={s.number} data-testid="order-number">{orderLabel(order)}</div>
            {order.number ? <div className="small muted" data-testid="order-id">{t('orderIdLabel', { id: order.id })}</div> : null}
            <div className="small muted">{t('placedOn', { date: formatDateTime(order.created_at, lang) })}</div>
          </div>
          <FulfilmentChip status={status} hold={f?.hold} testId="order-status" />
        </div>
        {f?.hold ? <Banner tone="warn">{t('onHold')}</Banner> : null}
        {status === 'cancelled' && f?.cancel_reason ? <Banner tone="fail">{t('cancelledBecause', { reason: f.cancel_reason })}</Banner> : null}
        <div className={s.facts}>
          <div>
            <div className="small muted">{pickup ? t('pickup') : t('delivery')}</div>
            {status === 'delivered' && f?.delivered_at ? (
              <div className={s.fact}>{t('deliveredOn', { date: formatDate(f.delivered_at.slice(0, 10), lang) })}</div>
            ) : promised ? (
              <div className={s.fact} data-testid="promised-date">
                {t(pickup ? 'promisedPickup' : 'promisedDelivery', { date: formatDate(promised, lang, true) })}
              </div>
            ) : estimate ? (
              <div className={s.fact} data-testid="estimated-date">
                {t(pickup ? 'estimatedPickup' : 'estimatedDelivery', { date: formatDate(pickup ? estimate.ready_date : estimate.delivery_date, lang, true) })}
              </div>
            ) : <div className={s.fact}>—</div>}
            {f?.rush ? <div className="small">{t('expressChosen')}</div> : null}
          </div>
          <div>
            <div className="small muted">{t('pieces')}</div>
            <div className={s.fact}>{order.total_pieces}</div>
            <div className="small">{t(`garment_${order.garment}` as 'garment_jersey')}{order.pricing ? ` · ${order.pricing.fabric.name}` : ''}</div>
          </div>
          {addr && !pickup ? (
            <div>
              <div className="small muted">{t('shippingAddress')}</div>
              <address className={s.addr}>
                {addr.name ? <>{addr.name}<br /></> : null}
                {addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}<br />
                {addr.city}, {stateName(addr.state)} {addr.pincode}
              </address>
            </div>
          ) : null}
        </div>
        <div className={s.actions}>
          <a className={s.btnLink} href={invoiceUrl(order.id)} target="_blank" rel="noopener" data-testid="invoice-link">
            {paid ? t('saveInvoice') : t('saveProforma')} ↗
          </a>
          {extraActions}
        </div>
      </Card>

      {stages.length && paid && status !== 'cancelled' ? (
        <Card title={t('progress')} sub={t('of', { a: doneCount, b: stages.length })} testId="order-progress">
          <ol className={s.stages}>
            {stages.map((st, i) => {
              const current = !st.done_at && (i === 0 || !!stages[i - 1].done_at);
              return (
                <li key={st.id} className={cx(st.done_at && s.stageDone, current && s.stageNow)} aria-current={current ? 'step' : undefined}>
                  <span className={s.dot} aria-hidden>{st.done_at ? '✓' : i + 1}</span>
                  <span>
                    <span className={s.stageName}>{st.name}</span>
                    {st.done_at ? <span className="small muted"> · {formatDateTime(st.done_at, lang)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      ) : null}

      {order.shipments?.length || f?.dispatched_at ? (
        <Card title={t('shipmentTitle')} testId="order-shipments">
          {f?.dispatched_at ? <p style={{ margin: 0 }}>{t('dispatchedOn', { date: formatDateTime(f.dispatched_at, lang) })}</p> : null}
          {timeline.filter((e) => e.code === 'dispatched').slice(0, 3).map((e) => (
            <p key={`${e.at}-${e.code}`} style={{ margin: '4px 0 0' }}>{e.text}</p>
          ))}
          {order.shipments?.length ? (
            <p className="small muted" style={{ marginBottom: 0 }}>{t('shipmentRefs', { refs: order.shipments.join(', ') })}</p>
          ) : null}
        </Card>
      ) : null}

      {timeline.length ? (
        <Card title={t('updates')} testId="order-timeline">
          <ol className={s.timeline}>
            {timeline.map((e) => (
              <li key={`${e.at}-${e.code}`}>
                <time dateTime={e.at} className="small muted">{formatDateTime(e.at, lang)}</time>
                <div>{eventText(t, e)}</div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card title={t('orderLines')}>
        {order.pricing ? <PriceSummary quote={order.pricing} showNudges={false} showDates={false} testId="order-price" /> : (
          <ul>
            {order.lines.map((l) => <li key={l.line}>{l.size} × {l.quantity} {[l.player_name, l.number].filter(Boolean).join(' ')}</li>)}
          </ul>
        )}
      </Card>
    </div>
  );
}
