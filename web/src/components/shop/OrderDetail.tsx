'use client';
import { useEffect, useState } from 'react';
import { PriceSummary } from '@/components/shop/PriceSummary';
import { FulfilmentChip, fulfilmentStatus, invoiceUrl, orderLabel } from '@/components/shop/orderBits';
import { Banner, Card, Skeleton, SvgImg, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Order } from '@/lib/api/types';
import { formatDate, formatDateTime, formatMoney } from '@/lib/price';
import { tMaybe } from '@/i18n';
import { stateName } from '@/lib/states';
import { normaliseFit } from '@/lib/sizing';
import { fitLabel, optionsText } from './Sizing';
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
const EVENT_KEYS = [
  'placed', 'paid', 'planned', 'hold', 'resumed', 'ready', 'delivered', 'cancelled', 'cod_confirmed', 'cod_collected',
  'return_requested', 'return_approved', 'return_picked_up', 'return_rejected', 'reviewed', 'returned',
] as const;

/** Timeline texts come from the server in English; known codes are translated here, using their params. */
export function eventText(t: ReturnType<typeof useI18n>['t'], e: { code: string; text: string; params?: Record<string, unknown> }): string {
  const p = e.params ?? {};
  if ((EVENT_KEYS as readonly string[]).includes(e.code)) return t(`ev_${e.code}` as 'ev_placed');
  if (e.code === 'stage' && typeof p.stage === 'string') return t('ev_stage', { stage: p.stage });
  if (e.code === 'dispatched' && typeof p.carrier === 'string') {
    return p.tracking ? t('ev_dispatched_tracking', { carrier: p.carrier, tracking: String(p.tracking) }) : t('ev_dispatched', { carrier: p.carrier });
  }
  if (e.code === 'refund' && p.amount !== undefined) return t('ev_refund', { amount: String(p.amount) });
  if (e.code === 'return_resolved') return t(p.resolution === 'replacement' ? 'ev_return_replaced' : 'ev_return_refunded');
  return e.text;
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
  const paid = !!order.payment && order.payment_method !== 'cod';

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
            {order.garment !== 'shorts' ? (
              <div className="small" data-testid="order-options">
                {optionsText(t, { garment: order.garment, sleeves: order.options?.sleeves ?? order.spec?.sleeves, collar: order.options?.collar ?? order.spec?.collar })}
              </div>
            ) : null}
          </div>
          {order.seller?.name ? (
            <div>
              <div className="small muted">{t('seller')}</div>
              <div className={s.fact} data-testid="order-seller">{order.seller.name}</div>
              <div className="small" data-testid="order-payment">
                {order.payment_method === 'cod'
                  ? (order.payment?.collected ? t('codCollected') : t('payCod'))
                  : paid ? t('paidOnline') : t('fstatus_awaiting_payment')}
              </div>
            </div>
          ) : null}
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
            {paid || order.payment?.collected ? t('saveInvoice') : t('saveProforma')} ↗
          </a>
          {extraActions}
        </div>
      </Card>

      {stages.length && !!order.payment && status !== 'cancelled' ? (
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

      {f?.shipment || f?.dispatched_at ? (
        <Card title={t('shipmentTitle')} testId="order-shipments">
          {f?.shipment ? (
            <div className="stack" style={{ gap: 4 }} data-testid="shipment-details">
              <div><strong>{f.shipment.carrier_name}</strong>{f.shipment.tracking_no ? <> · {t('trackingNo')}: <span className="tnum" data-testid="tracking-no">{f.shipment.tracking_no}</span></> : null}</div>
              <div className="small">{t(`shp_${f.shipment.status}` as 'shp_planned')}</div>
              {f.shipment.planned_date && !f.shipment.dispatched_at ? <div className="small">{t('plannedDispatch', { date: formatDate(f.shipment.planned_date, lang) })}</div> : null}
              {f.shipment.dispatched_at ? <div className="small">{t('dispatchedOn', { date: formatDateTime(f.shipment.dispatched_at, lang) })}</div> : null}
              {f.shipment.delivered_at ? <div className="small">{t('deliveredOn', { date: formatDateTime(f.shipment.delivered_at, lang) })}</div> : null}
              {f.shipment.tracking_url ? (
                <a href={f.shipment.tracking_url} target="_blank" rel="noopener noreferrer" data-testid="tracking-link">{t('trackParcel')} ↗</a>
              ) : null}
            </div>
          ) : f?.dispatched_at ? <p style={{ margin: 0 }}>{t('dispatchedOn', { date: formatDateTime(f.dispatched_at, lang) })}</p> : null}
        </Card>
      ) : null}

      {order.returns?.length || order.refunds?.length || order.review ? (
        <Card title={t('afterSales')} testId="order-aftersales">
          <div className="stack" style={{ gap: 10 }}>
            {(order.returns ?? []).map((r) => (
              <div key={r.id} data-testid="return-record">
                <strong>{t('returnN', { n: r.number })}</strong> · {t(`rstatus_${r.status}` as 'rstatus_requested')}
                <div className="small">{tMaybe(t, `reason_${r.reason}`, r.reason)}{r.details ? ` · ${r.details}` : ''}</div>
                {r.note ? <div className="small muted">{r.note}</div> : null}
              </div>
            ))}
            {(order.refunds ?? []).map((r) => (
              <div key={r.id} className="small" data-testid="refund-record">
                {t('refundOf', { amount: formatMoney(r.amount, order.pricing?.currency ?? 'INR', lang) })} · {formatDateTime(r.at, lang)}
                {r.method === 'demo' ? ` · ${t('refundDemo')}` : ''}
              </div>
            ))}
            {order.review ? (
              <div data-testid="order-review">
                <strong>{t('yourReview')}</strong> <span aria-label={t('ratingOf', { avg: order.review.rating, n: 1 })}>{'★'.repeat(order.review.rating)}{'☆'.repeat(5 - order.review.rating)}</span>
                {order.review.title ? <div>{order.review.title}</div> : null}
                {order.review.body ? <div className="small">{order.review.body}</div> : null}
                {order.review.hidden ? <div className="small muted">{t('reviewHidden')}</div> : null}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {timeline.length ? (
        <Card title={t('updates')} testId="order-timeline">
          <ol className={s.timeline}>
            {timeline.map((e, i) => (
              // Several events can share a time and code (stages done together), so the position is part of the key.
              <li key={`${timeline.length - i}-${e.at}-${e.code}`}>
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
            {order.lines.map((l) => (
              <li key={l.line}>{t('fitSize', { fit: fitLabel(t, normaliseFit(l.fit)), size: l.size })} × {l.quantity} {[l.player_name, l.number].filter(Boolean).join(' ')}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
