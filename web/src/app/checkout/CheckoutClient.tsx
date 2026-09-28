'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { OtpSignIn } from '@/components/account/OtpSignIn';
import { FlowSteps } from '@/components/design/FlowSteps';
import { useCatalogue } from '@/components/providers/data';
import { useSession } from '@/components/providers/session';
import { EnquiryForm } from '@/components/shop/EnquiryForm';
import { AddressFields } from '@/components/shop/AddressFields';
import { PriceSummary } from '@/components/shop/PriceSummary';
import {
  Banner, Button, Card, Checkbox, Empty, ErrorState, Loading, Modal, SelectField, Skeleton, Spinner, SvgImg, Tabs, TextField, cx,
} from '@/components/ui';
import { errorMessage, type StringKey } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError, isAbort } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import { SIZES, type Address, type OrderFailure, type Preview, type QuoteRequest, type Size } from '@/lib/api/types';
import { currentSpec, flow, rowKey, useFlow } from '@/lib/flow';
import {
  BULK_PIECES, buildItems, orderPayload, payloadHash, rowsForFailure, validateAddress, validateCustomer, validateItems, type DraftIssue,
} from '@/lib/order';
import { formatDate, formatMoney, formatPercent, quoteLines } from '@/lib/price';
import { totalPieces } from '@/lib/roster';
import { STATES } from '@/lib/states';
import { checkPincode } from '@/lib/validation';
import s from './checkout.module.css';
import { RosterEditor, SizeChart, type RowIssues } from './RosterEditor';
import { useQuote } from './useQuote';

const ROW_MSG: Record<'player_name' | 'number' | 'quantity', StringKey> = { player_name: 'tooLong', number: 'digitsOnly', quantity: 'qtyRange' };
const CUST_MSG: Record<'name' | 'phone' | 'email', StringKey> = { name: 'required', phone: 'otpPhoneInvalid', email: 'invalid' };

function sameAddress(a: Address, b: Address) {
  return a.line1.trim() === b.line1.trim() && a.pincode === b.pincode && a.city.trim().toLowerCase() === b.city.trim().toLowerCase();
}

export function CheckoutClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const spec = useFlow(currentSpec);
  const designId = useFlow((st) => st.designId);
  const draft = useFlow((st) => st.checkout);
  const { catalogue, error: catalogueError, retry: retryCatalogue } = useCatalogue();
  const { me, loading: meLoading } = useSession();

  const [contactTab, setContactTab] = useState<'guest' | 'signin'>('guest');
  const [attempted, setAttempted] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<OrderFailure[]>([]);
  const [couponInput, setCouponInput] = useState(draft.coupon);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [preview, setPreview] = useState<{ data: Preview | null; error: unknown; forSpec: unknown }>({ data: null, error: null, forSpec: null });

  const garment = spec?.garment ?? 'jersey';
  const fabrics = useMemo(() => (catalogue?.fabrics ?? []).filter((f) => f.garments.includes(garment)), [catalogue, garment]);
  // A fabric chosen for another garment (e.g. "pro" for shorts) falls back to the first one that fits.
  const fabric = fabrics.some((f) => f.id === draft.fabric) ? draft.fabric : (fabrics[0]?.id ?? draft.fabric);

  const items = useMemo(() => (spec ? buildItems(draft, spec) : []), [draft, spec]);
  const pieces = totalPieces(items);
  const sizes = useMemo(() => [...new Set(items.map((i) => i.size))].sort((a, b) => SIZES.indexOf(a) - SIZES.indexOf(b)), [items]);
  const sizeKey = sizes.join(',');

  const customer = me
    ? { name: draft.customer.name || me.name, phone: me.phone, email: draft.customer.email || me.email }
    : draft.customer;

  // ------------------------------------------------------------ issues (shown after the first attempt)
  const itemIssues = validateItems(items, draft.mode);
  const addressIssues = draft.method === 'ship' ? validateAddress(draft.address) : [];
  const customerIssues = validateCustomer(customer);
  const collectionNeedsSignIn = !!draft.collectionId && !me;
  const allIssues: DraftIssue[] = [...itemIssues, ...addressIssues, ...customerIssues];

  const rowIssues: RowIssues = {};
  for (const i of itemIssues) if (i.kind === 'row') (rowIssues[i.index] ??= {})[i.field] = t(ROW_MSG[i.field]);
  const custErr = (f: keyof typeof CUST_MSG) =>
    attempted && customerIssues.some((i) => i.kind === 'customer' && i.field === f) ? t(CUST_MSG[f]) : null;

  const failedRows: Record<number, string> = {};
  for (const f of failures) {
    for (const i of rowsForFailure(items, f)) failedRows[i] = f.checks.map((c) => c.message).join(' ');
  }

  // ------------------------------------------------------------ preview and print checks for the sizes ordered
  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.render(spec, sizeKey ? (sizeKey.split(',') as Size[]) : [], controller.signal)
        .then((data) => setPreview({ data, error: null, forSpec: spec }))
        .catch((e) => !isAbort(e) && setPreview((p) => ({ ...p, error: e })));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [spec, sizeKey]);
  const checksFail = preview.data ? !preview.data.manufacturing_ready : false;

  // ------------------------------------------------------------ live price
  const quoteReq: QuoteRequest | null = useMemo(() => {
    if (!spec || !catalogue) return null;
    const lines = quoteLines(items.filter((it, i) => it.quantity >= 1 && !itemIssues.some((x) => x.kind === 'row' && x.index === i)));
    if (!lines.length) return null;
    const pin = draft.address.pincode.trim();
    return {
      garment: spec.garment, fabric, logos: Math.min(4, spec.elements.filter((e) => e.type === 'logo').length), lines,
      delivery: {
        method: draft.method,
        pincode: draft.method === 'ship' && !checkPincode(pin) ? pin : '',
        state: draft.method === 'ship' && STATES.some((x) => x.code === draft.address.state) ? draft.address.state : '',
      },
      rush: draft.rush && !!catalogue.rush.enabled, coupon: draft.coupon,
    };
    // itemIssues is derived from items; listing items is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, catalogue, items, fabric, draft.method, draft.address.pincode, draft.address.state, draft.rush, draft.coupon]);
  const q = useQuote(quoteReq);
  const quote = quoteReq ? q.quote : null;

  if (placed) return <Loading label={t('openingPayment')} testId="opening-payment" />;

  if (!spec) {
    return (
      <div className="container page">
        <Empty title={t('checkoutEmpty')} testId="checkout-empty">
          <p>{t('checkoutEmptyText')}</p>
          <Button href="/design">{t('heroCta')}</Button>
        </Empty>
      </div>
    );
  }

  const set = flow.setCheckout;
  const setCustomer = (patch: Partial<typeof draft.customer>) => set((c) => ({ customer: { ...c.customer, ...patch } }));
  const pct = (r: number) => formatPercent(r, lang).replace('%', '').trim();
  const money = (n: number) => formatMoney(n, catalogue?.currency ?? 'INR', lang);

  const switchMode = (mode: 'single' | 'team') => {
    if (mode === draft.mode) return;
    if (mode === 'team' && draft.rows.length === 0) {
      // Start the roster with the studio's own player so nothing typed there is lost.
      const ty = spec.typography;
      set({ mode, rows: [{ key: rowKey(), player_name: ty.player_name, number: ty.number, size: draft.single.size, quantity: 1 }] });
    } else set({ mode });
  };

  const submit = async () => {
    setAttempted(true);
    setError(null);
    setFailures([]);
    if (allIssues.length || collectionNeedsSignIn) {
      setError(collectionNeedsSignIn ? t('teamNeedsSignIn') : t('fixErrors'));
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }
    if (checksFail) {
      setError(t('orderBlocked'));
      return;
    }
    const id = flow.ensureDesignId();
    const address = { ...draft.address, name: draft.address.name || customer.name, phone: draft.address.phone || customer.phone };
    const payload = orderPayload({
      designId: designId ?? id, spec, items, customer, language: lang,
      draft: { ...draft, fabric, address, rush: draft.rush && !!catalogue?.rush.enabled },
    });
    const key = flow.keyForPayload(payloadHash(payload));
    setPlacing(true);
    try {
      const order = await api.createOrder({ ...payload, idempotency_key: key });
      if (me && draft.method === 'ship' && draft.saveAddress && !me.addresses.some((a) => sameAddress(a, address))) {
        await api.updateMe({ addresses: [...me.addresses, payload.delivery!.address!].slice(-5) }).catch(() => undefined);
      }
      setPlaced(true);
      router.push(`/order/${encodeURIComponent(order.id)}/pay`);
      setTimeout(() => flow.orderPlaced(), 400);
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'blocked') {
        const d = e.data as { failures?: OrderFailure[] };
        setFailures(d.failures ?? []);
        setError(t('orderBlockedServer'));
      } else {
        setError(errorMessage(t, e));
      }
    } finally {
      setPlacing(false);
    }
  };

  // ------------------------------------------------------------ express dates
  const dateOf = (e?: { delivery_date: string; ready_date: string } | null) =>
    e ? formatDate(draft.method === 'pickup' ? e.ready_date : e.delivery_date, lang) : null;
  const std = quote ? (draft.rush ? quote.estimate_standard : quote.estimate) : null;
  const exp = quote ? (draft.rush ? quote.estimate : q.expressEstimate) : null;
  const stdDate = dateOf(std);
  const expDate = dateOf(exp);

  const fabricName = (id: string) => fabrics.find((f) => f.id === id)?.name ?? id;

  return (
    <div className="container page" data-testid="screen-checkout">
      <FlowSteps current={4} />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t('checkoutTitle')}</h1>
        <Button kind="ghost" href="/studio">← {t('backToStudio')}</Button>
      </div>

      {draft.collectionId ? (
        <Banner tone="info" testId="collection-banner"
          action={t('collectionClear')} onAction={() => set({ collectionId: '', collectionTitle: '' })}>
          {t('collectionBanner', { title: draft.collectionTitle })}
        </Banner>
      ) : null}

      <div className={s.layout}>
        <div className="stack" style={{ gap: 20 }}>
          {/* ---------------------------------------------------- 1. pieces */}
          <Card title={t('stepPieces')}>
            <Tabs value={draft.mode} onChange={switchMode} label={t('orderTitle')} testId="mode"
              options={[{ value: 'single', label: t('single') }, { value: 'team', label: t('teamRoster') }]} />
            <div style={{ height: 14 }} />
            {draft.mode === 'single' ? (
              <div className="stack">
                <div className={s.grid2}>
                  <SelectField label={t('size')} value={draft.single.size} testId="single-size"
                    onValue={(v) => set((c) => ({ single: { ...c.single, size: v as Size } }))}>
                    {SIZES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </SelectField>
                  <TextField label={t('quantity')} type="number" min={1} max={500} value={draft.single.quantity || ''} testId="single-qty"
                    error={attempted && itemIssues.some((i) => i.kind === 'row') ? t('qtyRange') : null}
                    onValue={(v) => set((c) => ({ single: { ...c.single, quantity: Math.max(0, Math.min(500, Math.floor(Number(v) || 0))) } }))} />
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  {spec.typography.player_name || spec.typography.number
                    ? t('singlePrinted', { name: [spec.typography.player_name, spec.typography.number].filter(Boolean).join(' ') })
                    : t('singleNoName')}
                </p>
                <button type="button" className={s.linkBtn} onClick={() => setChartOpen(true)} data-testid="size-chart-single">{t('sizeChart')}</button>
              </div>
            ) : (
              <RosterEditor rows={draft.rows} onChange={(rows) => set({ rows })} issues={attempted ? rowIssues : {}}
                failed={failedRows} defaultSize={draft.single.size} />
            )}
            {attempted && itemIssues.some((i) => i.kind === 'emptyRoster') ? <Banner tone="fail">{t('emptyRoster')}</Banner> : null}
            {itemIssues.some((i) => i.kind === 'tooManyLines' || i.kind === 'tooManyPieces') ? <Banner tone="fail">{t('tooManyLines')}</Banner> : null}
            {pieces > BULK_PIECES ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="info" testId="bulk-banner" action={t('bulkBannerCta')} onAction={() => setBulkOpen(true)}>
                  {t('bulkBanner', { n: pieces })}
                </Banner>
              </div>
            ) : null}
          </Card>

          {/* ---------------------------------------------------- 2. fabric and options */}
          <Card title={t('stepOptions')}>
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>{t('fabric')}</legend>
              {!catalogue && !catalogueError ? <Skeleton height={64} /> : null}
              {catalogueError ? <ErrorState message={errorMessage(t, catalogueError)} retryLabel={t('retry')} onRetry={retryCatalogue} /> : null}
              <div className={s.options} role="radiogroup" aria-label={t('fabric')}>
                {fabrics.map((f) => (
                  <label key={f.id} className={cx(s.option, fabric === f.id && s.optionOn)} data-testid={`fabric-${f.id}`}>
                    <input type="radio" name="fabric" value={f.id} checked={fabric === f.id} onChange={() => set({ fabric: f.id })} />
                    <span className={s.optionName}>{f.name}</span>
                    <span className="small muted">{f.surcharge > 0 ? t('fabricSurcharge', { amount: money(f.surcharge) }) : t('included')}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {catalogue?.rush.enabled ? (
              <div className={s.express} data-testid="express">
                <Checkbox checked={draft.rush} onChange={(v) => set({ rush: v })} testId="express-toggle">
                  <strong>{catalogue.rush.label || t('expressLabel')}</strong>
                </Checkbox>
                <p className="small" style={{ margin: '4px 0 0 28px' }} data-testid="express-dates">
                  {stdDate && expDate
                    ? stdDate === expDate
                      ? t('expressSameDate', { pct: pct(catalogue.rush.fee_rate) })
                      : t('expressDates', { pct: pct(catalogue.rush.fee_rate), standard: stdDate, express: expDate })
                    : t('expressHint', { pct: pct(catalogue.rush.fee_rate) })}
                </p>
              </div>
            ) : null}

            <div className={s.coupon}>
              <TextField label={t('couponCode')} value={couponInput} optional={t('optional')} maxLength={24} testId="coupon"
                onValue={(v) => setCouponInput(v.toUpperCase().replace(/\s/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') set({ coupon: couponInput }); }} />
              {draft.coupon && draft.coupon === couponInput ? (
                <Button kind="secondary" onClick={() => { setCouponInput(''); set({ coupon: '' }); }} testId="coupon-remove">{t('couponRemove')}</Button>
              ) : (
                <Button kind="secondary" disabled={!couponInput} onClick={() => set({ coupon: couponInput })} testId="coupon-apply">{t('couponApply')}</Button>
              )}
            </div>
            {draft.coupon && quote?.coupon?.error ? <Banner tone="warn" testId="coupon-error">{t('couponInvalid')} {quote.coupon.error}</Banner> : null}
            {draft.coupon && quote?.coupon && quote.coupon.amount > 0 ? (
              <Banner tone="pass" testId="coupon-ok">{t('couponSaves', { code: quote.coupon.code, amount: money(quote.coupon.amount) })}</Banner>
            ) : null}
          </Card>

          {/* ---------------------------------------------------- 3. delivery */}
          <Card title={t('stepDelivery')}>
            <Tabs value={draft.method} onChange={(m) => set({ method: m })} label={t('delivery')} testId="method"
              options={[{ value: 'ship', label: t('shipToAddress') },
                ...(catalogue?.pickup.enabled ?? true ? [{ value: 'pickup' as const, label: t('pickup') }] : [])]} />
            <div style={{ height: 14 }} />
            {draft.method === 'pickup' ? (
              <p style={{ margin: 0 }} data-testid="pickup-info">{t('pickupAt', { label: catalogue?.pickup.label ?? '' })}</p>
            ) : (
              <div className="stack">
                {me?.addresses.length ? (
                  <div className={s.saved} role="group" aria-label={t('savedAddresses')}>
                    <span className="small muted">{t('savedAddresses')}</span>
                    {me.addresses.map((a, i) => (
                      <button key={`${a.line1}-${a.pincode}-${i}`} type="button" data-testid={`saved-address-${i}`}
                        className={cx(s.savedAddr, sameAddress(a, draft.address) && s.savedOn)}
                        onClick={() => set({ address: { ...a } })}>
                        <strong>{a.name || me.name}</strong> · {a.line1}, {a.city} {a.pincode}
                      </button>
                    ))}
                  </div>
                ) : null}
                <AddressFields value={draft.address} onChange={(address) => set({ address })} showErrors={attempted} testId="addr" />
                {me ? (
                  <Checkbox checked={draft.saveAddress} onChange={(v) => set({ saveAddress: v })} testId="save-address">
                    {t('saveAddressToAccount')}
                  </Checkbox>
                ) : null}
              </div>
            )}
          </Card>

          {/* ---------------------------------------------------- 4. contact */}
          <Card title={t('stepContact')} testId="contact">
            {meLoading ? <Spinner /> : me ? (
              <div className="stack">
                <p style={{ margin: 0 }} data-testid="signed-in-as">{t('signedInAs', { name: me.name || me.phone })} · <span className="tnum">{me.phone}</span></p>
                <div className={s.grid2}>
                  <TextField label={t('customerName')} value={customer.name} autoComplete="name" maxLength={80}
                    onValue={(v) => setCustomer({ name: v })} error={custErr('name')} testId="cust-name" />
                  <TextField label={t('email')} value={customer.email} type="email" autoComplete="email" optional={t('optional')}
                    maxLength={120} onValue={(v) => setCustomer({ email: v })} error={custErr('email')} testId="cust-email" />
                </div>
              </div>
            ) : (
              <>
                <Tabs value={draft.collectionId ? 'signin' : contactTab} onChange={setContactTab} label={t('stepContact')} testId="contact-tab"
                  options={[{ value: 'guest', label: t('contactGuest') }, { value: 'signin', label: t('contactSignIn') }]} />
                <div style={{ height: 14 }} />
                {contactTab === 'signin' || draft.collectionId ? (
                  <div className="stack">
                    {draft.collectionId ? <Banner tone="info">{t('teamNeedsSignIn')}</Banner> : null}
                    <OtpSignIn testId="checkout-otp" initialPhone={draft.customer.phone} initialName={draft.customer.name}
                      onSignedIn={(m) => setCustomer({ name: draft.customer.name || m.name, email: draft.customer.email || m.email, phone: m.phone })} />
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
        </div>

        {/* ---------------------------------------------------- summary */}
        <aside className={s.aside} aria-label={t('priceTitle')}>
          <Card>
            <div className={s.summaryHead}>
              {preview.data ? (
                <SvgImg svg={preview.data.mockup_svg} alt={spec.style_name || t('checkoutYourDesign')} className={s.thumb} testId="checkout-mockup" />
              ) : <Skeleton height={96} className={s.thumb} />}
              <div>
                <div className={s.designName}>{spec.typography.team_name || spec.style_name || t('checkoutYourDesign')}</div>
                <div className="small muted">{t(`garment_${garment}` as StringKey)} · {fabricName(fabric)}</div>
                <a className="small" href="/studio">{t('edit')}</a>
              </div>
            </div>

            {checksFail ? (
              <Banner tone="fail" testId="checks-blocked" action={t('backToStudio')} onAction={() => router.push('/studio')}>
                {t('orderBlocked')}
              </Banner>
            ) : null}

            <h2 className={s.priceTitle}>{t('priceTitle')} {q.status === 'loading' && quote ? <span className="small muted">· {t('updatingPrice')}</span> : null}</h2>
            {!quoteReq ? (
              <p className="small muted" data-testid="price-pending">{t('pricePending')}</p>
            ) : quote ? (
              <PriceSummary quote={quote} updating={q.status === 'loading'} />
            ) : q.status === 'error' ? (
              <Banner tone="warn" action={t('retry')} onAction={q.retry} testId="price-error">{t('priceUnavailable')}</Banner>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <Spinner label={t('pricing')} />
                <Skeleton height={140} />
              </div>
            )}
            {quote && q.status === 'error' ? <p className="small muted">{t('priceUnavailable')}</p> : null}

            {error && !(error === t('fixErrors') && !allIssues.length) && !(error === t('teamNeedsSignIn') && !collectionNeedsSignIn) ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="fail" live testId="order-error">
                  <div>{error}</div>
                  {failures.length ? (
                    <ul className={s.errList} data-testid="order-failures">
                      {failures.map((f) => (
                        <li key={f.line}>
                          {t('line', { n: f.line })} · {f.size} {[f.player_name, f.number].filter(Boolean).join(' ')}: {f.checks.map((c) => c.message).join(' ')}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Banner>
              </div>
            ) : null}

            <div style={{ marginTop: 14 }}>
              <Button size="lg" block busy={placing} onClick={submit} disabled={checksFail} testId="place-order">
                {placing ? t('placingOrder') : quote ? t('placeOrderFor', { total: money(quote.total) }) : t('placeOrder')}
              </Button>
              <p className={s.demo} data-testid="demo-label">{t('demoNoMoney')}</p>
            </div>
          </Card>
        </aside>
      </div>

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={t('enquiryTitle')} testId="bulk-dialog" closeLabel={t('close')}>
        <EnquiryForm spec={spec} pieces={pieces} compact testId="checkout-enquiry" />
      </Modal>
      <Modal open={chartOpen} onClose={() => setChartOpen(false)} title={t('sizeChart')} closeLabel={t('close')}>
        <SizeChart />
      </Modal>
    </div>
  );
}
