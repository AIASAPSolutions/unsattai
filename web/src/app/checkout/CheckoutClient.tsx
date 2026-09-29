'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SignInForm } from '@/components/account/OtpSignIn';
import { CartTotals, entryOptions, entryTitle, ItemThumb, Offers } from '@/components/market/CartBits';
import { useCatalogue, useDemoPayments } from '@/components/providers/data';
import { usePincode, useProductIndex } from '@/components/providers/shop';
import { useSession } from '@/components/providers/session';
import { AddressFields } from '@/components/shop/AddressFields';
import { OptionsLine, fitLabel } from '@/components/shop/Sizing';
import { Banner, Button, Card, Checkbox, Empty, Loading, Skeleton, Spinner, Tabs, TextField, cx } from '@/components/ui';
import { errorMessage, type StringKey } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Address, CheckoutItemError, Me } from '@/lib/api/types';
import { cartPieces, linesSummary, type CartEntry } from '@/lib/cart';
import {
  cartQuoteRequest, checkoutHash, checkoutIssues, checkoutItemErrors, checkoutPayload, codBlock, groupBySeller, onlineMode,
  type CheckoutDraft,
} from '@/lib/checkout';
import { flow, EMPTY_ADDRESS } from '@/lib/flow';
import { orderPayload, payloadHash } from '@/lib/order';
import { reasonKey } from '@/lib/pincode';
import { formatDate, formatMoney } from '@/lib/price';
import { buyNow, cart, checkoutDraft, useCart, useShop } from '@/lib/shopStore';
import { stateName } from '@/lib/states';
import { useCartQuote } from '@/lib/useCartQuote';
import s from '@/components/market/market.module.css';

const CUST_MSG: Record<'name' | 'phone' | 'email', StringKey> = { name: 'required', phone: 'otpPhoneInvalid', email: 'invalid' };

function sameAddress(a: Address, b: Address) {
  return a.line1.trim() === b.line1.trim() && a.pincode === b.pincode && a.city.trim().toLowerCase() === b.city.trim().toLowerCase();
}

/** Which saved address is chosen: the one picked, else the one matching the draft, else the first (default). */
function chosenIndex(me: Me | null, draft: CheckoutDraft): number {
  if (!me?.addresses.length) return -1;
  if (draft.addressIndex >= 0 && draft.addressIndex < me.addresses.length) return draft.addressIndex;
  if (draft.addressIndex === -2) return -1; // "new address" chosen
  const hit = me.addresses.findIndex((a) => sameAddress(a, draft.address));
  if (hit >= 0) return hit;
  return draft.address.line1.trim() ? -1 : 0;
}

export function CheckoutClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { me, loading: meLoading } = useSession();
  const { catalogue } = useCatalogue();
  const index = useProductIndex();
  const pin = usePincode();
  const { items: cartItems, ready: cartReady } = useCart();
  const bn = useShop((st) => st.buyNow);
  const draft = useShop((st) => st.checkout);

  const isBuyNow = params.get('buy') === '1' && !!bn;
  const items: CartEntry[] = useMemo(() => (isBuyNow && bn ? [bn.entry] : cartItems), [isBuyNow, bn, cartItems]);
  const collection = isBuyNow ? bn?.collection ?? null : null;

  const [contactTab, setContactTab] = useState<'guest' | 'signin'>('guest');
  const [attempted, setAttempted] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<CheckoutItemError[]>([]);

  const idx = chosenIndex(me, draft);
  const address = me && idx >= 0 ? { ...EMPTY_ADDRESS, ...me.addresses[idx] } : draft.address;
  const customer = me
    ? { name: draft.customer.name || me.name, phone: me.phone || draft.customer.phone, email: draft.customer.email || me.email }
    : draft.customer;
  const effective: CheckoutDraft = { ...draft, address, customer };

  const req = useMemo(() => cartQuoteRequest(items, effective, pin.pincode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, draft.method, address.pincode, address.state, draft.coupon, draft.rush, draft.payment, pin.pincode]);
  const q = useCartQuote(req, { express: !!catalogue?.rush.enabled });
  const quote = q.quote && q.quote.items.length === items.length ? q.quote : null;
  const groups = quote ? groupBySeller(items, quote) : [];
  const cod = catalogue?.cod ?? null;
  const codWhy = codBlock(quote, cod);
  const { demo } = useDemoPayments();
  const online = onlineMode(demo, codWhy);

  // Cash on delivery chosen but not possible any more (another PIN code or a bigger order): switch back to online.
  // While online payment is not available, cash on delivery is chosen for the customer whenever it can be used.
  useEffect(() => {
    if (draft.payment === 'cod' && codWhy && quote) checkoutDraft.set({ payment: 'online' });
    else if (draft.payment === 'online' && online === 'off' && quote) checkoutDraft.set({ payment: 'cod' });
  }, [draft.payment, codWhy, quote, online]);

  if (leaving) return <Loading label={t('openingPayment')} testId="opening-payment" />;
  if (!cartReady || meLoading) return <Loading label={t('loading')} />;
  if (!items.length) {
    return (
      <div className="container page">
        <Empty icon="🛒" title={t('checkoutNothing')} testId="checkout-empty">
          <p>{t('checkoutNothingText')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button href="/shop">{t('navShop')}</Button>
            <Button kind="secondary" href="/design">{t('heroCta')}</Button>
          </div>
        </Empty>
      </div>
    );
  }

  const set = checkoutDraft.set;
  const setCustomer = (patch: Partial<CheckoutDraft['customer']>) => set((c) => ({ customer: { ...c.customer, ...patch } }));
  const money = (n: number) => formatMoney(n, quote?.currency ?? catalogue?.currency ?? 'INR', lang);
  const issues = checkoutIssues(effective);
  const custErr = (f: keyof typeof CUST_MSG) =>
    attempted && issues.some((i) => i.kind === 'customer' && i.field === f) ? t(CUST_MSG[f]) : null;
  const needsSignIn = !!collection && !me;
  const rushEnabled = !!catalogue?.rush.enabled;
  // "Fix the highlighted fields" goes away once they are fixed.
  const shownError = error === t('fixErrors') && !issues.length && !needsSignIn ? null : error;

  const submit = async () => {
    setAttempted(true);
    setError(null);
    setItemErrors([]);
    if (issues.length || needsSignIn) {
      setError(needsSignIn ? t('teamNeedsSignIn') : t('fixErrors'));
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    if (quote?.problems.length) {
      setError(t('cartHasProblems'));
      return;
    }
    setPlacing(true);
    try {
      if (collection && items[0].spec) {
        // Team lists are ordered as one order that closes the list (POST /orders with collection_id).
        const e = items[0];
        const payload = {
          ...orderPayload({
            designId: e.design_id || flow.ensureDesignId(), spec: e.spec!, items: e.lines, customer, language: lang,
            draft: { fabric: e.fabric, rush: draft.rush, coupon: draft.coupon, method: draft.method, address, collectionId: collection.id },
          }),
          payment_method: draft.payment,
        };
        const key = checkoutDraft.keyFor(payloadHash(payload));
        const order = await api.createOrder({ ...payload, idempotency_key: key });
        await afterPlaced();
        buyNow.clear();
        flow.setCheckout({ collectionId: '', collectionTitle: '' });
        router.push(draft.payment === 'online' && !order.payment && demo
          ? `/order/${encodeURIComponent(order.id)}/pay` : `/order/${encodeURIComponent(order.id)}`);
        return;
      }
      const payload = checkoutPayload({ items, draft: effective, language: lang });
      const key = checkoutDraft.keyFor(checkoutHash(payload));
      const ck = await api.checkout({ ...payload, idempotency_key: key });
      await afterPlaced();
      if (isBuyNow) buyNow.clear();
      else cart.removeMany(items.map((e) => e.key));
      router.push(ck.payment_method === 'online' && ck.status !== 'paid' && demo
        ? `/checkout/${encodeURIComponent(ck.id)}/pay` : `/checkout/${encodeURIComponent(ck.id)}`);
    } catch (e) {
      const errs = e instanceof ApiError ? checkoutItemErrors(e.data) : [];
      setItemErrors(errs);
      setError(errs.length ? t('checkoutItemsFailed') : errorMessage(t, e));
      setPlacing(false);
    }
  };

  async function afterPlaced() {
    setLeaving(true);
    if (me && draft.method === 'ship' && idx < 0 && draft.saveAddress && !me.addresses.some((a) => sameAddress(a, address))) {
      const a = { ...address, name: address.name || customer.name, phone: address.phone || customer.phone };
      await api.updateMe({ addresses: [...me.addresses, a].slice(-10) }).catch(() => undefined);
    }
    checkoutDraft.placed();
  }

  const itemError = (i: number) => itemErrors.find((x) => x.index === i);
  const titleOf = (e: CartEntry, qTitle?: string) => entryTitle(e, e.product_id ? index?.get(e.product_id) : null, qTitle) || (e.product_id ? t('readyMade') : t('checkoutYourDesign'));

  return (
    <div className="container page" data-testid="screen-checkout">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t('checkoutTitle')}</h1>
        {!isBuyNow ? <Button kind="ghost" href="/cart">← {t('backToCart')}</Button> : null}
      </div>
      {collection ? <Banner tone="info" testId="collection-banner">{t('collectionBanner', { title: collection.title })}</Banner> : null}

      <div className={s.cartLayout}>
        <div className="stack" style={{ gap: 20 }}>
          {/* ---------------------------------------------------- 1. who */}
          <Card title={t('ckStepAccount')} testId="contact">
            {me ? (
              <div className="stack">
                <p style={{ margin: 0 }} data-testid="signed-in-as">
                  {t('signedInAs', { name: me.name || me.phone || me.email })}
                  {me.phone ? <> · <span className="tnum">{me.phone}</span></> : null}{me.email ? ` · ${me.email}` : ''}
                </p>
                <div className={s.grid2}>
                  <TextField label={t('customerName')} value={customer.name} autoComplete="name" maxLength={80}
                    onValue={(v) => setCustomer({ name: v })} error={custErr('name')} testId="cust-name" />
                  {me.phone ? (
                    <TextField label={t('email')} value={customer.email} type="email" autoComplete="email" optional={t('optional')}
                      maxLength={120} onValue={(v) => setCustomer({ email: v })} error={custErr('email')} testId="cust-email" />
                  ) : (
                    <TextField label={t('phone')} value={customer.phone} type="tel" autoComplete="tel" maxLength={24}
                      onValue={(v) => setCustomer({ phone: v })} error={custErr('phone')} hint={t('phoneForDelivery')} testId="cust-phone" />
                  )}
                </div>
              </div>
            ) : (
              <>
                <Tabs value={collection ? 'signin' : contactTab} onChange={setContactTab} label={t('ckStepAccount')} testId="contact-tab"
                  options={[{ value: 'guest', label: t('contactGuest') }, { value: 'signin', label: t('contactSignIn') }]} />
                <div style={{ height: 14 }} />
                {contactTab === 'signin' || collection ? (
                  <div className="stack">
                    {collection ? <Banner tone="info">{t('teamNeedsSignIn')}</Banner> : null}
                    <p className="small muted" style={{ margin: 0 }}>{t('signInCartMerges')}</p>
                    <SignInForm testId="checkout-otp" initialPhone={draft.customer.phone} initialName={draft.customer.name}
                      onSignedIn={(m) => setCustomer({ name: draft.customer.name || m.name, email: draft.customer.email || m.email, phone: m.phone || draft.customer.phone })} />
                  </div>
                ) : (
                  <div className="stack">
                    <div className={s.grid2}>
                      <TextField label={t('customerName')} value={draft.customer.name} autoComplete="name" maxLength={80}
                        onValue={(v) => setCustomer({ name: v })} error={custErr('name')} testId="cust-name" />
                      <TextField label={t('phone')} value={draft.customer.phone} type="tel" autoComplete="tel" maxLength={24}
                        onValue={(v) => setCustomer({ phone: v })} error={custErr('phone')} hint={t('otpPhoneHint')} testId="cust-phone" />
                    </div>
                    <TextField label={t('email')} value={draft.customer.email} type="email" autoComplete="email" optional={t('optional')}
                      maxLength={120} onValue={(v) => setCustomer({ email: v })} error={custErr('email')} testId="cust-email" />
                    <p className="small muted" style={{ margin: 0 }}>{t('guestHint')}</p>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* ---------------------------------------------------- 2. address */}
          <Card title={t('ckStepAddress')} testId="delivery">
            <Tabs value={draft.method} onChange={(m) => set({ method: m })} label={t('delivery')} testId="method"
              options={[{ value: 'ship', label: t('shipToAddress') },
                ...(catalogue?.pickup.enabled ?? true ? [{ value: 'pickup' as const, label: t('pickup') }] : [])]} />
            <div style={{ height: 14 }} />
            {draft.method === 'pickup' ? (
              <p style={{ margin: 0 }} data-testid="pickup-info">{t('pickupAt', { label: catalogue?.pickup.label ?? '' })}</p>
            ) : (
              <div className="stack">
                {me?.addresses.length ? (
                  <div className={s.radioCards} role="radiogroup" aria-label={t('savedAddresses')} data-testid="address-book">
                    {me.addresses.map((a, i) => (
                      <label key={`${a.line1}-${a.pincode}-${i}`} className={cx(s.radioCard, idx === i && s.radioOn)} data-testid={`saved-address-${i}`}>
                        <input type="radio" name="address" checked={idx === i} onChange={() => set({ addressIndex: i })} />
                        <span>
                          <strong>{a.name || me.name}</strong>{a.phone ? ` · ${a.phone}` : ''}{i === 0 ? <span className="small muted"> · {t('defaultAddress')}</span> : null}<br />
                          <span className="small">{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {stateName(a.state)} {a.pincode}</span>
                        </span>
                      </label>
                    ))}
                    <label className={cx(s.radioCard, idx < 0 && s.radioOn)} data-testid="new-address">
                      <input type="radio" name="address" checked={idx < 0}
                        onChange={() => set({ addressIndex: -2, address: sameAddress(draft.address, me.addresses[0]) ? EMPTY_ADDRESS : draft.address })} />
                      <span><strong>{t('addNewAddress')}</strong></span>
                    </label>
                  </div>
                ) : null}
                {!me?.addresses.length || idx < 0 ? (
                  <>
                    <AddressFields value={draft.address} onChange={(a) => set({ address: a, addressIndex: me?.addresses.length ? -2 : -1 })}
                      showErrors={attempted} testId="addr" />
                    {me ? (
                      <Checkbox checked={draft.saveAddress} onChange={(v) => set({ saveAddress: v })} testId="save-address">
                        {t('saveAddressToAccount')}
                      </Checkbox>
                    ) : null}
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {/* ---------------------------------------------------- 3. items and dates by seller */}
          <Card title={t('ckStepItems')} sub={quote?.delivery_by ? t('allDeliveredBy', { date: formatDate(quote.delivery_by, lang) }) : undefined} testId="seller-groups">
            {!quote ? (
              q.status === 'error' ? <Banner tone="warn" action={t('retry')} onAction={q.retry}>{errorMessage(t, q.error)}</Banner>
                : <Skeleton height={120} />
            ) : groups.map((g) => (
              <section key={g.sellerId || 'none'} className={s.sellerGroup} data-testid={`seller-group-${g.sellerId || 'none'}`}
                aria-label={g.sellerName ? t('soldBy', { seller: g.sellerName }) : t('noSeller')}>
                <div className={s.sellerHead}>
                  <strong>{g.sellerName ? t('soldBy', { seller: g.sellerName }) : t('noSeller')}</strong>
                  {g.deliveryDate ? (
                    <span className="small" style={{ color: 'var(--pass)', fontWeight: 700 }}>
                      {draft.method === 'pickup' ? t('readyBy', { date: formatDate(g.deliveryDate, lang) }) : t('deliveryBy', { date: formatDate(g.deliveryDate, lang) })}
                    </span>
                  ) : null}
                </div>
                <ul className={s.groupItems}>
                  {g.items.map(({ index: i, entry, quote: qi }) => {
                    const err = itemError(i);
                    const reason = qi.quote.seller_problem ? reasonKey(qi.quote.seller_problem) : null;
                    return (
                      <li key={entry.key} data-testid={`ck-item-${i}`}>
                        <ItemThumb entry={entry} product={entry.product_id ? index?.get(entry.product_id) : null} alt="" />
                        <div style={{ minWidth: 0 }}>
                          <div className={s.itemTitle}>{titleOf(entry, qi.title)}</div>
                          <OptionsLine text={entryOptions(t, entry, entry.product_id ? index?.get(entry.product_id) : null, qi)} testId={`ck-item-${i}-options`} />
                          <div className="small muted" data-testid={`ck-item-${i}-sizes`}>{linesSummary(entry.lines, (f) => fitLabel(t, f))}</div>
                          {reason ? <div className="small" style={{ color: 'var(--fail)' }}>{t(reason, { pincode: address.pincode || pin.pincode })}</div> : null}
                          {qi.problems.length && !reason ? <div className="small" style={{ color: 'var(--fail)' }}>{qi.problems.join(' ')}</div> : null}
                          {err ? (
                            <div className="small" style={{ color: 'var(--fail)', fontWeight: 600 }} data-testid={`ck-item-error-${i}`}>
                              {err.message}
                              {err.failures?.length ? ` ${err.failures.map((f) => `${t('line', { n: f.line })}: ${f.checks.map((c) => c.message).join(' ')}`).join(' · ')}` : ''}
                            </div>
                          ) : null}
                        </div>
                        <span className="tnum" style={{ fontWeight: 700 }}>{money(qi.quote.total)}</span>
                      </li>
                    );
                  })}
                </ul>
                {draft.method === 'ship' ? (
                  <p className="small muted" style={{ margin: '8px 0 0' }} data-testid="group-shipping">
                    {g.shipping > 0 ? t('groupDeliveryCharge', { amount: money(g.shipping) }) : t('groupFreeDelivery')}
                  </p>
                ) : null}
              </section>
            ))}
            {rushEnabled ? (
              <div className={s.sellerGroup} style={{ marginTop: 12 }} data-testid="express">
                <Checkbox checked={draft.rush} onChange={(v) => set({ rush: v })} testId="express-toggle">
                  <strong>{catalogue?.rush.label || t('expressLabel')}</strong>
                </Checkbox>
                <p className="small" style={{ margin: '4px 0 0 28px' }} data-testid="express-dates">
                  {quote?.delivery_by && (draft.rush || q.expressBy)
                    ? draft.rush
                      ? t('expressOn', { pct: Math.round((catalogue?.rush.fee_rate ?? 0) * 100), date: formatDate(quote.delivery_by, lang) })
                      : q.expressBy === quote.delivery_by
                        ? t('expressSameDate', { pct: Math.round((catalogue?.rush.fee_rate ?? 0) * 100) })
                        : t('expressDates', { pct: Math.round((catalogue?.rush.fee_rate ?? 0) * 100), standard: formatDate(quote.delivery_by, lang), express: formatDate(q.expressBy, lang) })
                    : t('expressHint', { pct: Math.round((catalogue?.rush.fee_rate ?? 0) * 100) })}
                </p>
              </div>
            ) : null}
          </Card>

          {/* ---------------------------------------------------- 4. offers */}
          <Card testId="checkout-offers-card">
            <Offers applied={draft.coupon} quote={quote} onApply={(code) => set({ coupon: code })} testId="checkout-offers" />
          </Card>

          {/* ---------------------------------------------------- 5. payment */}
          <Card title={t('ckStepPayment')} testId="payment">
            <div className={s.radioCards} role="radiogroup" aria-label={t('ckStepPayment')}>
              <label className={cx(s.radioCard, draft.payment === 'online' && s.radioOn, online === 'off' && s.radioOff)} data-testid="pay-online">
                <input type="radio" name="payment" checked={draft.payment === 'online'} disabled={online === 'off'}
                  onChange={() => set({ payment: 'online' })} />
                <span>
                  <strong>{online === 'later' ? t('payLater') : t('payOnline')}</strong><br />
                  <span className="small muted" data-testid="pay-online-note">
                    {online === 'demo' ? t('payOnlineHint') : online === 'later' ? t('payLaterHint') : t('payComingSoon')}
                  </span>
                </span>
              </label>
              <label className={cx(s.radioCard, draft.payment === 'cod' && s.radioOn, codWhy && s.radioOff)} data-testid="pay-cod">
                <input type="radio" name="payment" checked={draft.payment === 'cod'} disabled={!!codWhy} onChange={() => set({ payment: 'cod' })} />
                <span>
                  <strong>{t('payCod')}</strong>{cod?.fee ? <span className="small"> · {t('codFeeN', { amount: money(cod.fee) })}</span> : null}<br />
                  <span className="small muted" data-testid="cod-note">
                    {codWhy === 'disabled' ? t('codOff')
                      : codWhy === 'limit' ? t('codLimit', { amount: money(cod?.max_order_value ?? 0) })
                        : codWhy === 'area' ? t('codArea')
                          : cod?.max_order_value ? t('codHint', { amount: money(cod.max_order_value) }) : t('codHintNoLimit')}
                  </span>
                </span>
              </label>
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------- summary */}
        <aside className={s.aside} aria-label={t('priceTitle')}>
          <Card title={t('orderSummary')}>
            <p className="small muted" style={{ marginTop: 0 }}>{t('cartItemsN', { n: items.length })} · {t('piecesN', { n: cartPieces(items) })}</p>
            {draft.method === 'ship' && address.pincode ? (
              <p className="small" style={{ marginTop: 0 }} data-testid="ship-to">{t('deliverTo')} {address.city ? `${address.city} ` : ''}{address.pincode}</p>
            ) : null}
            {quote ? <CartTotals quote={quote} testId="price" /> : q.status === 'error' ? (
              <Banner tone="warn" action={t('retry')} onAction={q.retry} testId="price-error">{t('priceUnavailable')}</Banner>
            ) : <div className="stack" style={{ gap: 8 }}><Spinner label={t('pricing')} /><Skeleton height={140} /></div>}
            {q.status === 'loading' && quote ? <p className="small muted">{t('updatingPrice')}</p> : null}
            {quote?.problems.length ? (
              <ul className="small" style={{ color: 'var(--fail)', paddingLeft: 18 }} data-testid="price-problems">
                {quote.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            ) : null}
            {shownError ? <div style={{ marginTop: 12 }}><Banner tone="fail" live testId="order-error">{shownError}</Banner></div> : null}
            <div style={{ marginTop: 14 }}>
              <Button size="lg" block kind="accent" busy={placing} onClick={submit} testId="place-order">
                {placing ? t('placingOrder')
                  : quote ? (draft.payment === 'cod' ? t('placeCodOrder', { total: money(quote.totals.total) }) : t('placeOrderFor', { total: money(quote.totals.total) }))
                    : t('placeOrder')}
              </Button>
              <p className="small" style={{ textAlign: 'center', color: 'var(--warn)', fontWeight: 600, margin: '8px 0 0' }} data-testid="demo-label">
                {draft.payment === 'cod' ? t('codDemoNote') : online === 'demo' ? t('demoNoMoney') : t('payTeamWillContact')}
              </p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
