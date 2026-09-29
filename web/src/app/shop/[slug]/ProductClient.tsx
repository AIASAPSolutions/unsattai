'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DeliveryLine } from '@/components/market/Delivery';
import { PincodeForm } from '@/components/market/PincodeChip';
import { WishHeart } from '@/components/market/ProductCard';
import { productImage, rememberProduct, usePincode, useServiceability } from '@/components/providers/shop';
import { useSession } from '@/components/providers/session';
import { ColourwayPicker, FitSizePicker, GarmentOptionsPicker } from '@/components/shop/Sizing';
import { Banner, Button, Card, ErrorState, Loading, Modal, RatingStars, Spinner, cx } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Collar, Fit, ProductDetail, Review, Size, Sleeves } from '@/lib/api/types';
import { productEntry } from '@/lib/cart';
import { flow } from '@/lib/flow';
import { collarOf, hasCollarChoice, hasSleeves, sleevesOf, withOption } from '@/lib/options';
import { formatDate, formatMoney } from '@/lib/price';
import { buyNow, cart } from '@/lib/shopStore';
import s from '@/components/market/market.module.css';

export function ProductClient({ slug, initial }: { slug: string; initial: ProductDetail | null }) {
  const { t } = useI18n();
  const [product, setProduct] = useState<ProductDetail | null>(initial);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (product && nonce === 0) return;
    let live = true;
    api.product(slug).then((p) => live && setProduct(p)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [slug, nonce, product]);
  useEffect(() => {
    if (product) rememberProduct(product);
  }, [product]);
  if (error && !product) {
    return <div className="container page"><ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} /></div>;
  }
  if (!product) return <Loading label={t('loading')} />;
  return <Product product={product} />;
}

function Product({ product }: { product: ProductDetail }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pin = usePincode();
  const { me } = useSession();
  const [fabric, setFabric] = useState(product.fabrics.some((f) => f.id === product.fabric) ? product.fabric : product.fabrics[0]?.id ?? 'standard');
  const [fit, setFit] = useState<Fit>('men');
  const [size, setSize] = useState<Size | null>(null);
  const [colourway, setColourway] = useState('original');
  const [sleeves, setSleeves] = useState<Sleeves>(sleevesOf(product.spec));
  const [collar, setCollar] = useState<Collar>(collarOf(product.spec));
  const [qty, setQty] = useState(1);
  const [sellerId, setSellerId] = useState<string>('');
  const [sizeErr, setSizeErr] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const svc = useServiceability(pin.pincode ? { pincode: pin.pincode, garment: product.garment, fabric, pieces: qty } : null);
  const offers = useMemo(() => svc.data?.offers ?? [], [svc.data]);
  const chosen = offers.find((o) => o.seller_id === sellerId) ?? offers.find((o) => o.recommended) ?? null;
  const money = (n: number) => formatMoney(n, product.currency, lang);
  const unit = chosen?.unit_price ?? product.price_from;

  const entry = () => {
    if (!size) {
      setSizeErr(true);
      document.getElementById('size-group')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return null;
    }
    // An explicit choice of a non-recommended seller is kept; otherwise the server picks the best offer.
    const pickedSeller = sellerId && offers.find((o) => o.seller_id === sellerId && !o.recommended) ? sellerId : '';
    return productEntry(product.id, fabric, [{ fit, size, quantity: qty, player_name: '', number: '' }], pickedSeller, {
      colourway,
      sleeves: hasSleeves(product.garment) ? sleeves : '',
      collar: hasCollarChoice(product.garment) ? collar : '',
    });
  };

  const addToCart = () => {
    setAddErr(null);
    const e = entry();
    if (!e) return;
    const r = cart.add(e);
    if (r.outcome === 'full') setAddErr(t('cartFull'));
    else if (r.outcome === 'too_many') setAddErr(t('tooManyLines'));
    else setAdded(r.outcome);
  };
  const buy = () => {
    const e = entry();
    if (!e) return;
    buyNow.start(e);
    router.push('/checkout?buy=1');
  };
  const customise = () => {
    // The studio starts from the colourway and options chosen here.
    const palette = product.colourways?.find((c) => c.id === colourway)?.palette;
    const base = palette ? { ...product.spec, palette: { ...product.spec.palette, ...palette } } : product.spec;
    flow.openSpec(withOption(withOption(base, 'sleeves', sleeves), 'collar', collar), null, 'product');
    flow.setCheckout({ fabric, single: { fit, size: size ?? (fit === 'kids' ? '8Y' : 'M'), quantity: qty } });
    router.push('/studio');
  };

  const fabricName = (id: string) => product.fabrics.find((f) => f.id === id)?.name ?? id;
  const picture = productImage(product, {
    colourway, sleeves: hasSleeves(product.garment) ? sleeves : undefined, collar: hasCollarChoice(product.garment) ? collar : undefined,
  });

  return (
    <div className="container page" data-testid="screen-product">
      <nav className="small muted" aria-label={t('breadcrumb')} style={{ marginBottom: 12 }}>
        <Link href="/shop">{t('navShop')}</Link> › <Link href={`/shop?sport=${encodeURIComponent(product.sport)}`}>{tMaybe(t, `sport_${product.sport}`, product.sport)}</Link> › <span>{product.title}</span>
      </nav>
      <div className={s.pdp}>
        <div style={{ position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={picture} alt={t('productPictureAlt', { title: product.title })} className={s.pdpImg} data-testid="product-mockup" width={600} height={600} />
          <WishHeart product={product} testId="product-wish" />
        </div>
        <div className={s.buyBox}>
          <div>
            <h1 style={{ marginBottom: 6 }} data-testid="product-title">{product.title}</h1>
            <div className="row" style={{ gap: 10 }}>
              {product.review_summary.count ? (
                <a href="#reviews" data-testid="product-rating">
                  <RatingStars value={product.review_summary.average} count={product.review_summary.count} size="md"
                    label={t('ratingOf', { avg: (product.review_summary.average ?? 0).toFixed(1), n: product.review_summary.count })} />
                </a>
              ) : <span className="small muted" data-testid="product-rating">{t('noReviewsYet')}</span>}
              <span className="small muted">{t(`garment_${product.garment}` as 'garment_jersey')} · {tMaybe(t, `sport_${product.sport}`, product.sport)}</span>
            </div>
          </div>
          <div>
            <div className={s.pdpPrice} data-testid="product-price">
              {unit !== null ? money(unit) : t('unavailable')} <span className={s.priceFrom}>{t('perPieceShort')}</span>
            </div>
            <div className="small muted">
              {product.price_from !== null ? t('priceFromNote', { price: money(product.price_from) }) : null}
            </div>
          </div>
          <p style={{ margin: 0 }}>{product.description}</p>

          <Card>
            <div className="stack" style={{ gap: 14 }}>
              {product.colourways && product.colourways.length > 1 ? (
                <ColourwayPicker colourways={product.colourways} value={colourway} onChange={setColourway} testId="colourway" />
              ) : null}
              <GarmentOptionsPicker garment={product.garment} sleeves={sleeves} collar={collar} testId="product-opt"
                onChange={(group, v) => (group === 'sleeves' ? setSleeves(v as Sleeves) : setCollar(v as Collar))} />
              <div id="size-group">
                <FitSizePicker variant="pills" fit={fit} size={size} garment={product.garment} sleeves={sleeves}
                  onChange={(v) => {
                    // A new fit keeps the size only when the customer had picked one that the fit has.
                    setFit(v.fit);
                    setSize(v.fit === fit ? v.size : size && v.size === size ? size : null);
                    if (v.fit === fit) setSizeErr(false);
                  }}
                  testId="product-fit-size" fitTestId="product-fit" sizeTestId="product-size" guideTestId="product-size-chart" />
                {sizeErr ? <p className="small" role="alert" style={{ color: 'var(--fail)', margin: '6px 0 0', fontWeight: 600 }} data-testid="size-error">{t('chooseSize')}</p> : null}
              </div>
              <div className={s.qtyRow}>
                <Stepper value={qty} onChange={setQty} label={t('quantity')} testId="product-qty" />
                {product.fabrics.length > 1 ? (
                  <label className={s.fieldCol} style={{ flex: 1, minWidth: 180 }}>
                    <span className="small" style={{ fontWeight: 600 }}>{t('fabric')}</span>
                    <select className={s.select} value={fabric} onChange={(e) => setFabric(e.target.value)} data-testid="product-fabric">
                      {product.fabrics.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}{f.surcharge > 0 ? ` (+${money(f.surcharge)})` : ''}</option>
                      ))}
                    </select>
                  </label>
                ) : <span className="small muted">{fabricName(fabric)}</span>}
              </div>

              <div>
                <DeliveryLine garment={product.garment} fabric={fabric} pieces={qty} sellerId={sellerId || undefined} testId="product-delivery" />
                <button type="button" className={s.linkBtn} onClick={() => setPinOpen(true)} data-testid="product-pin-change">
                  {pin.pincode ? t('pinChange') : t('pinCheck')}
                </button>
              </div>

              {addErr ? <Banner tone="fail" live>{addErr}</Banner> : null}
              {added ? (
                <Banner tone="pass" live testId="added-to-cart" action={t('goToCart')} onAction={() => router.push('/cart')}>
                  {added === 'combined' ? t('cartCombined') : t('addedToCart')}
                </Banner>
              ) : null}
              <div className={s.actions}>
                <Button kind="secondary" size="lg" onClick={addToCart} disabled={product.price_from === null} testId="add-to-cart">{t('addToCart')}</Button>
                <Button kind="accent" size="lg" onClick={buy} disabled={product.price_from === null || svc.data?.serviceable === false} testId="buy-now">{t('buyNow')}</Button>
              </div>
              <Button kind="ghost" onClick={customise} testId="customise">✎ {t('customise')}</Button>
              <p className="small muted" style={{ margin: 0 }}>{t('customiseHint')}</p>
            </div>
          </Card>

          <Card title={t('sellersTitle')} sub={pin.pincode ? t('sellersFor', { pincode: pin.pincode }) : t('pinForDates')} testId="sellers">
            {!pin.pincode ? (
              <Button kind="secondary" onClick={() => setPinOpen(true)}>{t('pinCheck')}</Button>
            ) : svc.loading ? <Spinner label={t('checkingDelivery')} /> : svc.error ? (
              <Banner tone="warn" action={t('retry')} onAction={svc.retry}>{errorMessage(t, svc.error)}</Banner>
            ) : !offers.length ? (
              <p className="small" style={{ margin: 0 }} data-testid="sellers-none">{t('notDeliverableTo', { pincode: pin.pincode })}</p>
            ) : (
              <ul className={s.offers} role="radiogroup" aria-label={t('sellersTitle')} data-testid="offer-list">
                {offers.map((o) => {
                  const on = (chosen?.seller_id ?? '') === o.seller_id;
                  return (
                    <li key={o.seller_id}>
                      <label className={cx(s.offerRow, on && s.offerOn)} data-testid={`offer-${o.seller_id}`}>
                        <input type="radio" name="seller" checked={on} onChange={() => setSellerId(o.recommended ? '' : o.seller_id)} />
                        <span style={{ minWidth: 0 }}>
                          <strong>{o.seller_name}</strong>
                          {o.rating.count ? <> <RatingStars value={o.rating.average} count={o.rating.count} label={t('ratingOf', { avg: (o.rating.average ?? 0).toFixed(1), n: o.rating.count })} /></> : null}
                          <span className="small" style={{ display: 'block' }}>
                            {t('deliveryBy', { date: formatDate(o.delivery_date, lang) })} · {o.cod_available ? t('codAvailable') : t('codNotAvailable')}
                          </span>
                          <span className={s.tags}>
                            {o.recommended ? <span className={s.tag}>{t('offerRecommended')}</span> : null}
                            {o.fastest ? <span className={s.tag}>{t('offerFastest')}</span> : null}
                            {o.cheapest ? <span className={s.tag}>{t('offerCheapest')}</span> : null}
                          </span>
                        </span>
                        <span className="tnum" style={{ fontWeight: 800 }}>{money(o.unit_price)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Reviews product={product} />

      <Modal open={pinOpen} onClose={() => setPinOpen(false)} title={t('pinTitle')} closeLabel={t('close')} testId="product-pin-dialog">
        <PincodeForm initial={pin.pincode} addresses={me?.addresses ?? []} onDone={() => setPinOpen(false)} testId="product-pin" />
      </Modal>
    </div>
  );
}

export function Stepper({ value, onChange, label, testId, min = 1, max = 500 }: {
  value: number; onChange: (n: number) => void; label: string; testId?: string; min?: number; max?: number;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.floor(n) || min));
  return (
    <div className={s.fieldCol}>
      <span className="small" style={{ fontWeight: 600 }} id={`${testId}-label`}>{label}</span>
      <div className={s.stepper} role="group" aria-labelledby={`${testId}-label`}>
        <button type="button" onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label="−" data-testid={`${testId}-minus`}>−</button>
        <input type="number" inputMode="numeric" min={min} max={max} value={value} aria-labelledby={`${testId}-label`}
          onChange={(e) => onChange(clamp(Number(e.target.value)))} data-testid={testId} />
        <button type="button" onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label="+" data-testid={`${testId}-plus`}>+</button>
      </div>
    </div>
  );
}

function Reviews({ product }: { product: ProductDetail }) {
  const { t, lang } = useI18n();
  const [more, setMore] = useState<Review[] | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const sum = product.review_summary;
  const list = more ?? product.reviews;
  const loadMore = async () => {
    setBusy(true);
    try {
      const next = page + 1;
      const r = await api.productReviews(product.slug, next);
      setMore((m) => (m ? [...m, ...r.items] : r.items));
      setPage(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="reviews" style={{ marginTop: 32 }} aria-labelledby="reviews-h" data-testid="reviews">
      <h2 id="reviews-h">{t('reviewsTitle')}</h2>
      {!sum.count ? <p className="muted">{t('noReviewsText')}</p> : (
        <div className={s.shopLayout}>
          <div>
            <RatingStars value={sum.average} count={sum.count} size="md" label={t('ratingOf', { avg: (sum.average ?? 0).toFixed(1), n: sum.count })} />
            <div className={s.dist} style={{ marginTop: 10 }}>
              {[5, 4, 3, 2, 1].map((n) => {
                const c = sum.distribution[String(n)] ?? 0;
                return (
                  <div key={n} style={{ display: 'contents' }}>
                    <span>{n}★</span>
                    <span className={s.distBar}><span style={{ width: `${sum.count ? (c / sum.count) * 100 : 0}%` }} /></span>
                    <span className="muted">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <ul className={s.reviews}>
              {list.map((r) => (
                <li key={r.id} data-testid="review">
                  <RatingStars value={r.rating} label={t('ratingOf', { avg: r.rating.toFixed(1), n: 1 })} />
                  {r.title ? <strong style={{ display: 'block' }}>{r.title}</strong> : null}
                  {r.body ? <p style={{ margin: '4px 0' }}>{r.body}</p> : null}
                  <span className="small muted">
                    {r.customer_name} · {formatDate(r.created_at.slice(0, 10), lang, true)}
                    {r.verified_purchase ? ` · ${t('verifiedPurchase')}` : ''}{r.seller_name ? ` · ${t('soldBy', { seller: r.seller_name })}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {list.length < sum.count ? <Button kind="secondary" busy={busy} onClick={loadMore} style={{ marginTop: 12 }}>{t('loadMore')}</Button> : null}
          </div>
        </div>
      )}
    </section>
  );
}
