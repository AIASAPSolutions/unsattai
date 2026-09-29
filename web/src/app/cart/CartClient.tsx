'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CartTotals, entryTitle, ItemThumb, Offers } from '@/components/market/CartBits';
import { usePincode, useProductIndex } from '@/components/providers/shop';
import { useCatalogue } from '@/components/providers/data';
import { useSession } from '@/components/providers/session';
import { Banner, Button, Card, Empty, Loading, Skeleton, Spinner } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { itemPieces, linesSummary, setSingleQuantity, type CartEntry } from '@/lib/cart';
import { cartQuoteRequest } from '@/lib/checkout';
import { EMPTY_ADDRESS, flow, flowStore, rowKey } from '@/lib/flow';
import { reasonKey } from '@/lib/pincode';
import { formatDate, formatMoney } from '@/lib/price';
import { cart, checkoutDraft, useCart, useShop, wishlist } from '@/lib/shopStore';
import { whenHydrated } from '@/lib/store';
import { useCartQuote } from '@/lib/useCartQuote';
import { Stepper } from '@/app/shop/[slug]/ProductClient';
import s from '@/components/market/market.module.css';

/** Open a custom design from the cart in the studio flow's options page, to change and save back. */
export async function editDesignItem(e: CartEntry) {
  if (!e.spec) return;
  await whenHydrated(flowStore);
  flow.openSpec(e.spec, e.design_id || null, 'saved');
  const ty = e.spec.typography;
  const single = e.lines.length === 1 && e.lines[0].player_name === ty.player_name && e.lines[0].number === ty.number;
  flow.setCheckout({
    mode: single ? 'single' : 'team',
    single: single ? { size: e.lines[0].size, quantity: e.lines[0].quantity } : flowStore.get().checkout.single,
    rows: single ? [] : e.lines.map((l) => ({ ...l, key: rowKey() })),
    fabric: e.fabric, cartKey: e.key,
  });
}

export function CartClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { items, ready, signedIn, syncError } = useCart();
  const { me } = useSession();
  const pin = usePincode();
  const index = useProductIndex();
  const { catalogue } = useCatalogue();
  const draft = useShop((st) => st.checkout);
  const [msg, setMsg] = useState<string | null>(null);

  const req = useMemo(() => cartQuoteRequest(items, { ...draft, method: 'ship', address: EMPTY_ADDRESS, payment: 'online' }, pin.pincode),
    [items, draft, pin.pincode]);
  const q = useCartQuote(req);
  const quote = q.quote && q.quote.items.length === items.length ? q.quote : null;

  if (!ready) return <Loading label={t('loading')} testId="cart-loading" />;

  const money = (n: number) => formatMoney(n, quote?.currency ?? catalogue?.currency ?? 'INR', lang);
  const fabricName = (id: string) => catalogue?.fabrics.find((f) => f.id === id)?.name ?? id;

  if (!items.length) {
    return (
      <div className="container page" data-testid="screen-cart">
        <h1>{t('cartTitle')}</h1>
        <Empty icon="🛒" title={t('cartEmpty')} testId="cart-empty">
          <p>{t('cartEmptyText')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button href="/shop">{t('navShop')}</Button>
            <Button kind="secondary" href="/design">{t('heroCta')}</Button>
          </div>
          {!me ? <p className="small"><Link href="/signin?next=/cart">{t('cartSignInHint')}</Link></p> : null}
        </Empty>
      </div>
    );
  }

  const saveForLater = async (e: CartEntry) => {
    try {
      await wishlist.toggle(e.product_id);
      cart.remove(e.key);
    } catch (err) {
      setMsg(errorMessage(t, err));
    }
  };

  return (
    <div className="container page" data-testid="screen-cart">
      <h1>{t('cartTitle')} <span className="muted" style={{ fontWeight: 500, fontSize: '1rem' }}>({t('cartItemsN', { n: items.length })})</span></h1>
      {syncError ? (
        <Banner tone="warn" action={t('retry')} onAction={cart.retrySync} testId="cart-sync-error">{t('cartSyncError')}</Banner>
      ) : null}
      {msg ? <Banner tone="fail" live>{msg}</Banner> : null}
      <div className={s.cartLayout}>
        <Card>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="cart-items">
            {items.map((e, i) => {
              const product = e.product_id ? index?.get(e.product_id) ?? null : null;
              const qi = quote?.items[i];
              // A ready-made item's name comes with the product list or the cart quote; until then a placeholder.
              const title = entryTitle(e, product, qi?.title) || (e.product_id ? '' : t('checkoutYourDesign'));
              const problems = qi?.problems ?? [];
              const reason = qi?.quote.seller_problem ? reasonKey(qi.quote.seller_problem) : null;
              return (
                <li key={e.key} className={s.cartItem} data-testid={`cart-item-${i}`}>
                  {product ? (
                    <Link href={`/shop/${encodeURIComponent(product.slug)}`}><ItemThumb entry={e} product={product} alt={title} /></Link>
                  ) : <ItemThumb entry={e} product={product} alt={title} />}
                  <div style={{ minWidth: 0 }}>
                    <div className={s.itemHead}>
                      <div style={{ minWidth: 0 }}>
                        <div className={s.itemTitle}>
                          {!title ? <Skeleton height={18} /> : product ? <Link href={`/shop/${encodeURIComponent(product.slug)}`} style={{ color: 'inherit' }}>{title}</Link> : title}
                        </div>
                        <div className="small muted">
                          {e.product_id ? t('readyMade') : t('yourDesign')} · {t(`garment_${e.spec?.garment ?? product?.garment ?? qi?.garment ?? 'jersey'}` as 'garment_jersey')} · {fabricName(e.fabric)}
                        </div>
                      </div>
                      <div className={s.itemPrice} data-testid={`cart-item-${i}-price`}>
                        {qi ? money(qi.quote.total) : <Skeleton height={20} />}
                      </div>
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {e.lines.length > 1 || e.lines[0]?.player_name || e.lines[0]?.number
                        ? t('rosterSummary', { n: itemPieces(e), lines: e.lines.length, sizes: linesSummary(e.lines) })
                        : linesSummary(e.lines)}
                    </div>
                    <div className="small" style={{ marginTop: 4 }} data-testid={`cart-item-${i}-delivery`}>
                      {!pin.pincode ? <span className="muted">{t('pinForDates')}</span>
                        : !qi ? <span className="muted">{t('checkingDelivery')}</span>
                          : qi.seller && qi.delivery_date ? (
                            <>
                              <strong style={{ color: 'var(--pass)' }}>{t('deliveryBy', { date: formatDate(qi.delivery_date, lang) })}</strong>
                              {' · '}{t('soldBy', { seller: qi.seller.name })}
                            </>
                          ) : <span style={{ color: 'var(--fail)', fontWeight: 600 }}>{reason ? t(reason, { pincode: pin.pincode }) : t('notDeliverableTo', { pincode: pin.pincode })}</span>}
                    </div>
                    {problems.length && !reason ? <p className="small" style={{ color: 'var(--fail)', margin: '4px 0 0' }}>{problems.join(' ')}</p> : null}
                    <div className={s.itemActions}>
                      {e.product_id && e.lines.length === 1 && !e.lines[0].player_name && !e.lines[0].number ? (
                        <Stepper value={e.lines[0].quantity} onChange={(n) => cart.update(e.key, (x) => setSingleQuantity(x, n))}
                          label={`${t('quantity')} · ${e.lines[0].size}`} testId={`cart-qty-${i}`} />
                      ) : null}
                      {e.spec ? (
                        <button type="button" className={s.linkBtn} data-testid={`cart-edit-${i}`}
                          onClick={async () => { await editDesignItem(e); router.push('/configure'); }}>{t('edit')}</button>
                      ) : null}
                      <button type="button" className={s.linkBtn} onClick={() => cart.remove(e.key)} data-testid={`cart-remove-${i}`}>{t('delete')}</button>
                      {e.product_id && signedIn ? (
                        <button type="button" className={s.linkBtn} onClick={() => void saveForLater(e)} data-testid={`cart-save-${i}`}>{t('saveForLater')}</button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <aside className={s.aside} aria-label={t('priceTitle')}>
          <Card title={t('priceTitle')}>
            {!pin.pincode ? <Banner tone="info" testId="cart-pin-hint">{t('cartPinHint')}</Banner> : null}
            {quote ? <CartTotals quote={quote} /> : q.status === 'error' ? (
              <Banner tone="warn" action={t('retry')} onAction={q.retry} testId="price-error">{errorMessage(t, q.error)}</Banner>
            ) : <div className="stack" style={{ gap: 8 }}><Spinner label={t('pricing')} /><Skeleton height={140} /></div>}
            {quote?.delivery_by ? <p className="small" style={{ margin: '10px 0 0' }} data-testid="cart-delivery-by">{t('allDeliveredBy', { date: formatDate(quote.delivery_by, lang) })}</p> : null}
            <div style={{ marginTop: 14 }}>
              <Button size="lg" block kind="accent" onClick={() => router.push('/checkout')} testId="proceed-checkout"
                disabled={!!quote && quote.problems.length > 0 && !!pin.pincode}>
                {quote ? t('proceedToCheckoutTotal', { total: money(quote.totals.total) }) : t('proceedToCheckout')}
              </Button>
              {quote && quote.problems.length && pin.pincode ? <p className="small" style={{ color: 'var(--fail)' }}>{t('cartHasProblems')}</p> : null}
            </div>
          </Card>
          <Card>
            <Offers applied={draft.coupon} quote={quote} onApply={(code) => checkoutDraft.set({ coupon: code })} testId="cart-offers" />
          </Card>
        </aside>
      </div>
    </div>
  );
}
