'use client';
import { usePincode, useServiceability } from '@/components/providers/shop';
import { cx } from '@/components/ui';
import { TruckIcon } from '@/components/ui/icons';
import { useI18n } from '@/i18n/provider';
import type { Garment, Offer, Serviceability } from '@/lib/api/types';
import { reasonKey } from '@/lib/pincode';
import { formatDate } from '@/lib/price';
import s from './market.module.css';

/** The offer to show: the one the customer picked, else the recommended one. */
export function pickOffer(data: Serviceability | null, sellerId?: string): Offer | null {
  if (!data?.serviceable) return null;
  return data.offers.find((o) => o.seller_id === sellerId) ?? data.offers.find((o) => o.recommended) ?? data.offers[0] ?? null;
}

/**
 * "Delivery by Thu, 2 Oct · Sold by UrJersey · Cash on delivery available" for the
 * "Deliver to" PIN code, from /shop/serviceability.
 */
export function DeliveryLine({ garment, fabric, pieces = 1, sellerId, compact, testId = 'delivery-line' }: {
  garment: Garment; fabric?: string; pieces?: number; sellerId?: string; compact?: boolean; testId?: string;
}) {
  const { t, lang } = useI18n();
  const pin = usePincode();
  const { data, loading, error } = useServiceability(pin.pincode ? { pincode: pin.pincode, garment, fabric, pieces } : null);
  if (!pin.ready) return <div className={s.delivery} aria-hidden>&nbsp;</div>;
  if (!pin.pincode) {
    return <div className={s.delivery} data-testid={testId}><span className="muted">{t('pinForDates')}</span></div>;
  }
  if (loading) return <div className={s.delivery} data-testid={testId}><span className="muted">{t('checkingDelivery')}</span></div>;
  if (error) return <div className={s.delivery} data-testid={testId}><span className="muted">{t('deliveryUnknown')}</span></div>;
  const offer = pickOffer(data, sellerId);
  if (!offer) {
    return (
      <div className={s.delivery} data-testid={testId} data-state="unserviceable">
        <span className={s.deliveryBad}>{t('notDeliverableTo', { pincode: pin.pincode })}</span>
        {!compact ? <span className="small">{t(reasonKey(data?.reason) ?? 'pinNotServiceable', { pincode: pin.pincode })}</span> : null}
      </div>
    );
  }
  const picked = sellerId ? data?.offers.find((o) => o.seller_id === sellerId) : null;
  return (
    <div className={s.delivery} data-testid={testId} data-state="ok">
      <span className={cx('row')} style={{ gap: 6, flexWrap: 'nowrap' }}>
        {!compact ? <TruckIcon size={18} /> : null}
        <span>
          <span className={s.deliveryDate} data-testid={`${testId}-date`}>{t('deliveryBy', { date: formatDate(offer.delivery_date, lang) })}</span>
          {!compact ? <span className="muted"> · {t('toPincode', { pincode: pin.pincode })}</span> : null}
        </span>
      </span>
      <span className={compact ? 'small muted' : undefined} data-testid={`${testId}-seller`}>
        {t('soldBy', { seller: offer.seller_name })}
        {!compact ? ` · ${offer.cod_available ? t('codAvailable') : t('codNotAvailable')}` : null}
      </span>
      {sellerId && !picked ? <span className="small muted">{t('sellerSwitched')}</span> : null}
    </div>
  );
}
