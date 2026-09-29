'use client';
import { useState } from 'react';
import { cx } from '@/components/ui';
import type { StringKey } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import type { Quote, QuoteLine } from '@/lib/api/types';
import { formatDelta } from '@/lib/options';
import { breakdownRows, formatDate, formatMoney, formatPercent, freeDeliveryGap, optionParts, tierNudge, type OptionPart } from '@/lib/price';
import { normaliseFit } from '@/lib/sizing';
import { fitLabel } from './Sizing';
import s from './shop.module.css';
import z from './sizing.module.css';

const LINES_SHOWN = 6;

/**
 * The price breakdown exactly as the server worked it out (POST /shop/quote, an order's
 * pricing or a sales quote). Nothing here is calculated locally except the display.
 */
export function PriceSummary({ quote, updating, showDates = true, showNudges = true, testId = 'price' }: {
  quote: Quote; updating?: boolean; showDates?: boolean; showNudges?: boolean; testId?: string;
}) {
  const { t, lang } = useI18n();
  const [allLines, setAllLines] = useState(false);
  const money = (n: number) => formatMoney(n, quote.currency, lang);
  const pct = (r: number) => formatPercent(r, lang).replace('%', '').trim();
  const nudge = showNudges ? tierNudge(quote) : null;
  const gap = showNudges ? freeDeliveryGap(quote) : null;
  const lines = allLines ? quote.lines : quote.lines.slice(0, LINES_SHOWN);
  const est = quote.estimate;
  const mixedFits = quote.lines.some((l) => normaliseFit(l.fit) !== 'men');
  const partLabel = (key: OptionPart, l: QuoteLine): string => {
    if (key === 'fit') return fitLabel(t, normaliseFit(l.fit));
    const chosen = quote.options?.[key]?.id;
    return chosen ? t(`${key}_${chosen}` as StringKey) : t(key === 'sleeves' ? 'sleevesLabel' : 'collarLabel');
  };

  const label = (key: ReturnType<typeof breakdownRows>[number]['key']): string => {
    switch (key) {
      case 'subtotal': return t('subtotal', { n: quote.pieces });
      case 'quantity_discount': return t('quantityDiscount', { pct: pct(quote.quantity_discount.rate) });
      case 'rush': return `${t('expressChosen')} (+${pct(quote.rush.rate)}%)`;
      case 'coupon': return t('couponLine', { code: quote.coupon?.code ?? '' });
      case 'sales_discount': return t('salesDiscount');
      case 'shipping':
        return quote.shipping.method === 'pickup'
          ? (quote.shipping.label || t('pickup'))
          : t('shippingTo', { zone: quote.shipping.zone_name ? `(${quote.shipping.zone_name})` : '' }).trim();
      case 'tax': return t(quote.tax.inclusive ? 'taxIncluded' : 'taxLine', { name: quote.tax.name, pct: pct(quote.tax.rate) });
      case 'total': return t('total');
    }
  };

  return (
    <div className={cx(s.price, updating && s.updating)} data-testid={testId} aria-busy={updating || undefined}>
      <ul className={s.lines} aria-label={t('orderLines')}>
        {lines.map((l) => (
          <li key={l.line} data-testid={`${testId}-line`}>
            <span className={s.lineWho}>
              <strong data-testid={`${testId}-line-size`}>{mixedFits ? `${fitLabel(t, normaliseFit(l.fit))} ${l.size}` : l.size}</strong> × {l.quantity}
              {l.player_name || l.number ? <span className="muted"> · {[l.player_name, l.number].filter(Boolean).join(' ')}</span> : null}
              {optionParts(l.parts).length ? (
                <span className={z.parts} data-testid={`${testId}-line-parts`}>
                  {optionParts(l.parts).map((p) => `${partLabel(p.key, l)} ${formatDelta(p.amount, quote.currency, lang)}`).join(' · ')}
                </span>
              ) : null}
            </span>
            <span className="tnum">
              <span className="muted small">{money(l.unit_price)} {t('each')} · </span>{money(l.line_total)}
            </span>
          </li>
        ))}
      </ul>
      {quote.lines.length > LINES_SHOWN ? (
        <button type="button" className={s.linkBtn} onClick={() => setAllLines((v) => !v)}>
          {allLines ? t('showFewerLines') : t('showAllLines', { n: quote.lines.length })}
        </button>
      ) : null}

      <dl className={s.rows}>
        {breakdownRows(quote).map((r) => (
          <div key={r.key} className={cx(s.rowLine, r.key === 'total' && s.totalLine)} data-testid={`${testId}-${r.key}`}>
            <dt>{label(r.key)}</dt>
            <dd className="tnum">
              {r.key === 'shipping' && r.free ? <span className={s.free}>{t('free')}</span> : `${r.negative ? '− ' : ''}${money(r.amount)}`}
            </dd>
          </div>
        ))}
      </dl>
      <p className={cx(s.perPiece, 'tnum')} data-testid={`${testId}-per-piece`}>{t('perPiece', { amount: money(quote.average_per_piece) })}</p>

      {quote.coupon?.error ? <p className={s.note} data-testid={`${testId}-coupon-error`}>{t('couponInvalid')} {quote.coupon.error}</p> : null}
      {quote.coupon && quote.coupon.amount > 0 ? (
        <p className={cx(s.note, s.good)} data-testid={`${testId}-coupon-ok`}>
          {t('couponSaves', { code: quote.coupon.code, amount: money(quote.coupon.amount) })}
        </p>
      ) : null}
      {nudge ? (
        <p className={cx(s.note, s.nudge)} data-testid={`${testId}-nudge`}>
          {t('nextTier', { n: nudge.piecesNeeded, pct: pct(nudge.rate) })}
        </p>
      ) : null}
      {gap !== null ? <p className={s.note} data-testid={`${testId}-free-gap`}>{t('freeDeliveryGap', { amount: money(gap) })}</p> : null}
      {quote.problems.length ? (
        <ul className={cx(s.note, s.problems)} data-testid={`${testId}-problems`}>
          {quote.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      ) : null}

      {showDates && est ? (
        <div className={s.dates} data-testid={`${testId}-dates`}>
          <div>
            <strong>
              {quote.shipping.method === 'pickup'
                ? t('estimatedPickup', { date: formatDate(est.ready_date, lang) })
                : t('estimatedDelivery', { date: formatDate(est.delivery_date, lang) })}
            </strong>
          </div>
          {quote.shipping.method === 'ship' ? (
            <div className="small muted">{t('shipsBy', { date: formatDate(est.ship_date, lang), days: est.production_days })}</div>
          ) : null}
          <div className="small muted">{t('etaNote')}</div>
        </div>
      ) : null}
    </div>
  );
}
