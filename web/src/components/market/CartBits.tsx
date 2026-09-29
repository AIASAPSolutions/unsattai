'use client';
import { useEffect, useState } from 'react';
import { productImage } from '@/components/providers/shop';
import { Banner, Button, Skeleton, SvgImg, TextField, cx } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { CartQuote, DesignSpec, Product, PublicOffer } from '@/lib/api/types';
import type { CartEntry } from '@/lib/cart';
import { formatMoney } from '@/lib/price';
import s from './market.module.css';

// ----------------------------------------------------------------- thumbnails

const renders = new WeakMap<DesignSpec, Promise<string>>();

function renderThumb(spec: DesignSpec): Promise<string> {
  let p = renders.get(spec);
  if (!p) {
    p = api.render(spec).then((r) => r.mockup_svg);
    p.catch(() => renders.delete(spec));
    renders.set(spec, p);
  }
  return p;
}

export function ItemThumb({ entry, product, alt }: { entry: Pick<CartEntry, 'spec' | 'product_id'>; product?: Product | null; alt: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.spec) return;
    let live = true;
    renderThumb(entry.spec).then((x) => live && setSvg(x)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [entry.spec]);
  if (entry.product_id) {
    // eslint-disable-next-line @next/next/no-img-element
    return product ? <img src={productImage(product)} alt={alt} className={s.thumb} loading="lazy" width={104} height={104} /> : <Skeleton className={s.thumb} height={76} />;
  }
  return svg ? <SvgImg svg={svg} alt={alt} className={s.thumb} /> : <Skeleton className={s.thumb} height={76} />;
}

/** Title of a cart item: the product's, the quote's, or the design's own names. */
export function entryTitle(e: CartEntry, product?: Product | null, quoteTitle?: string | null): string {
  if (product) return product.title;
  if (quoteTitle) return quoteTitle;
  return e.spec?.typography?.team_name || e.spec?.style_name || '';
}

// ----------------------------------------------------------------- totals

export function CartTotals({ quote, testId = 'cart-totals' }: { quote: CartQuote; testId?: string }) {
  const { t, lang } = useI18n();
  const money = (n: number) => formatMoney(n, quote.currency, lang);
  const x = quote.totals;
  const sellers = new Set(quote.items.map((i) => i.seller?.id ?? '')).size;
  const saved = x.quantity_discount + x.coupon;
  const pickup = quote.items[0]?.quote.shipping.method === 'pickup';
  return (
    <div data-testid={testId}>
      <dl className={s.totals}>
        <div data-testid={`${testId}-subtotal`}><dt>{t('itemsSubtotal', { n: quote.pieces })}</dt><dd className="tnum">{money(x.subtotal)}</dd></div>
        {x.quantity_discount > 0 ? <div data-testid={`${testId}-qd`}><dt>{t('quantityDiscountShort')}</dt><dd className={cx('tnum', s.save)}>− {money(x.quantity_discount)}</dd></div> : null}
        {x.rush > 0 ? <div data-testid={`${testId}-rush`}><dt>{t('expressChosen')}</dt><dd className="tnum">{money(x.rush)}</dd></div> : null}
        {x.coupon > 0 ? <div data-testid={`${testId}-coupon`}><dt>{t('couponLine', { code: quote.coupon?.code ?? '' })}</dt><dd className={cx('tnum', s.save)}>− {money(x.coupon)}</dd></div> : null}
        <div data-testid={`${testId}-shipping`}>
          <dt>{pickup ? t('pickup') : sellers > 1 ? t('deliveryChargesN', { n: sellers }) : t('deliveryCharge')}</dt>
          <dd className="tnum">{x.shipping === 0 ? <span className={s.save}>{t('free')}</span> : money(x.shipping)}</dd>
        </div>
        {x.cod_fee > 0 ? <div data-testid={`${testId}-cod`}><dt>{t('codFee')}</dt><dd className="tnum">{money(x.cod_fee)}</dd></div> : null}
        <div data-testid={`${testId}-tax`}><dt>{t('taxShort')}</dt><dd className="tnum">{money(x.tax)}</dd></div>
        <div className={s.grand} data-testid={`${testId}-total`}><dt>{t('total')}</dt><dd className="tnum">{money(x.total)}</dd></div>
      </dl>
      {saved > 0 ? <p className={cx('small', s.save)} style={{ margin: '8px 0 0' }} data-testid={`${testId}-saved`}>{t('youSave', { amount: money(saved) })}</p> : null}
      {!pickup && sellers > 1 ? <p className="small muted" style={{ margin: '6px 0 0' }}>{t('oneChargePerSeller')}</p> : null}
    </div>
  );
}

// ----------------------------------------------------------------- offers and coupon

let offersCache: Promise<PublicOffer[]> | null = null;
function loadOffers() {
  offersCache ??= api.offers().then((r) => r.items).catch((e) => {
    offersCache = null;
    throw e;
  });
  return offersCache;
}

/** "Available offers" (GET /shop/offers) plus a box for any other code. */
export function Offers({ applied, onApply, quote, currency = 'INR', testId = 'offers' }: {
  applied: string; onApply: (code: string) => void; quote: CartQuote | null; currency?: string; testId?: string;
}) {
  const { t, lang } = useI18n();
  const [offers, setOffers] = useState<PublicOffer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  useEffect(() => {
    let live = true;
    loadOffers().then((o) => live && setOffers(o)).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const money = (n: number) => formatMoney(n, currency, lang);
  const coupon = quote?.coupon;
  return (
    <div className="stack" style={{ gap: 10 }} data-testid={testId}>
      <strong>{t('offersTitle')}</strong>
      {offers === null && !failed ? <Skeleton height={48} /> : null}
      {offers && offers.length === 0 ? <p className="small muted" style={{ margin: 0 }}>{t('offersNone')}</p> : null}
      {offers?.length ? (
        <ul className={s.offerList}>
          {offers.map((o) => (
            <li key={o.code} className={s.offerItem} data-testid={`offer-${o.code}`}>
              <span style={{ minWidth: 0 }}>
                <span className={s.offerCode}>{o.code}</span>
                <span className="small" style={{ display: 'block' }}>{o.title}</span>
                {o.min_subtotal ? <span className="small muted">{t('offerMin', { amount: money(o.min_subtotal) })}</span> : null}
              </span>
              {applied === o.code ? (
                <Button kind="ghost" size="sm" onClick={() => onApply('')} testId={`offer-remove-${o.code}`}>{t('couponRemove')}</Button>
              ) : (
                <Button kind="secondary" size="sm" onClick={() => onApply(o.code)} testId={`offer-apply-${o.code}`}>{t('couponApply')}</Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <form className={s.pinForm} onSubmit={(e) => { e.preventDefault(); if (code) onApply(code); }}>
        <TextField label={t('couponCode')} value={code} maxLength={24} optional={t('optional')}
          onValue={(v) => setCode(v.toUpperCase().replace(/\s/g, ''))} testId={`${testId}-code`} />
        <Button type="submit" kind="secondary" disabled={!code} testId={`${testId}-code-apply`}>{t('couponApply')}</Button>
      </form>
      {applied && coupon?.error ? <Banner tone="warn" testId="coupon-error">{t('couponInvalid')} {coupon.error}</Banner> : null}
      {applied && coupon && coupon.amount > 0 ? (
        <Banner tone="pass" testId="coupon-ok">{t('couponSaves', { code: coupon.code, amount: money(coupon.amount) })}</Banner>
      ) : null}
      {applied && !offers?.some((o) => o.code === applied) ? (
        <Button kind="ghost" size="sm" onClick={() => onApply('')} testId="coupon-remove">{t('couponRemove')} {applied}</Button>
      ) : null}
    </div>
  );
}
