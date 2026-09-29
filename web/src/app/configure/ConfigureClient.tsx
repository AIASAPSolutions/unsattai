'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FlowSteps } from '@/components/design/FlowSteps';
import { PincodeForm } from '@/components/market/PincodeChip';
import { useCatalogue } from '@/components/providers/data';
import { usePincode } from '@/components/providers/shop';
import { useSession } from '@/components/providers/session';
import { EnquiryForm } from '@/components/shop/EnquiryForm';
import { PriceSummary } from '@/components/shop/PriceSummary';
import { FitSizePicker, GarmentOptionsPicker, OptionsLine, optionsText } from '@/components/shop/Sizing';
import {
  Banner, Button, Card, Empty, ErrorState, Modal, Skeleton, Spinner, SvgImg, Tabs, TextField, cx,
} from '@/components/ui';
import { errorMessage, type StringKey } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { isAbort } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Preview } from '@/lib/api/types';
import { designEntry, toApiItem } from '@/lib/cart';
import { currentSpec, flow, rowKey, useFlow } from '@/lib/flow';
import { collarOf, hasSleeves, sleevesOf, withOption } from '@/lib/options';
import { BULK_PIECES, buildItems, validateItems } from '@/lib/order';
import { reasonKey } from '@/lib/pincode';
import { formatDate, formatMoney, quoteLines } from '@/lib/price';
import { totalPieces } from '@/lib/roster';
import { checkSize, normaliseFit, sizeRank } from '@/lib/sizing';
import { buyNow, cart, useCart } from '@/lib/shopStore';
import { useCartQuote } from '@/lib/useCartQuote';
import s from './configure.module.css';
import { RosterEditor, type RowIssues } from './RosterEditor';

const ROW_MSG: Record<'player_name' | 'number' | 'quantity' | 'size', StringKey> = {
  player_name: 'tooLong', number: 'digitsOnly', quantity: 'qtyRange', size: 'chooseSize',
};

/**
 * The last step of the custom design flow: fit, sizes and names (one piece or a team roster),
 * sleeves and collar, fabric, the live price and delivery date for the "Deliver to" PIN code, then Add to
 * cart or Buy now.
 */
export function ConfigureClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const spec = useFlow(currentSpec);
  const designId = useFlow((st) => st.designId);
  const draft = useFlow((st) => st.checkout);
  const { catalogue, error: catalogueError, retry: retryCatalogue } = useCatalogue();
  const { me } = useSession();
  const pin = usePincode();
  const { items: cartItems } = useCart();

  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [preview, setPreview] = useState<{ data: Preview | null; error: unknown }>({ data: null, error: null });

  const garment = spec?.garment ?? 'jersey';
  const fabrics = useMemo(() => (catalogue?.fabrics ?? []).filter((f) => f.garments.includes(garment)), [catalogue, garment]);
  // A fabric chosen for another garment (e.g. "pro" for shorts) falls back to the first one that fits.
  const fabric = fabrics.some((f) => f.id === draft.fabric) ? draft.fabric : (fabrics[0]?.id ?? draft.fabric);

  const items = useMemo(() => (spec ? buildItems(draft, spec) : []), [draft, spec]);
  const pieces = totalPieces(items);
  // Print checks for every fit and size ordered ("M", "kids:8Y").
  const sizeKey = useMemo(() => [...new Map(items.map((i) => [checkSize(i.fit, i.size), sizeRank(i.fit, i.size)]))]
    .sort((a, b) => a[1] - b[1]).map(([k]) => k).join(','), [items]);
  const itemIssues = validateItems(items, draft.mode);
  const editing = draft.cartKey ? cartItems.find((e) => e.key === draft.cartKey) ?? null : null;

  const rowIssues: RowIssues = {};
  for (const i of itemIssues) if (i.kind === 'row') (rowIssues[i.index] ??= {})[i.field] = t(ROW_MSG[i.field]);

  // ------------------------------------------------------------ preview and print checks for the sizes ordered
  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.render(spec, sizeKey ? sizeKey.split(',') : [], controller.signal)
        .then((data) => setPreview({ data, error: null }))
        .catch((e) => !isAbort(e) && setPreview((p) => ({ ...p, error: e })));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [spec, sizeKey]);
  const checksFail = preview.data ? !preview.data.manufacturing_ready : false;

  // ------------------------------------------------------------ the item's live price (cart quote of this one item)
  const entry = useMemo(() => {
    if (!spec) return null;
    const lines = quoteLines(items.filter((it, i) => it.quantity >= 1 && !itemIssues.some((x) => x.kind === 'row' && x.index === i)));
    if (!lines.length) return null;
    return designEntry(spec, designId ?? '', fabric, lines);
    // itemIssues is derived from items; listing items is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, designId, fabric, items]);
  const quoteReq = useMemo(() => entry ? {
    items: [toApiItem(entry)], delivery: { method: 'ship' as const, pincode: pin.pincode, state: '' }, coupon: '', rush: false,
    payment_method: 'online' as const,
  } : null, [entry, pin.pincode]);
  const q = useCartQuote(quoteReq);
  const item = q.quote?.items[0] ?? null;

  if (!spec) {
    return (
      <div className="container page">
        <Empty title={t('checkoutEmpty')} testId="configure-empty">
          <p>{t('checkoutEmptyText')}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button href="/design">{t('heroCta')}</Button>
            <Button kind="secondary" href="/shop">{t('navShop')}</Button>
          </div>
        </Empty>
      </div>
    );
  }

  const set = flow.setCheckout;
  const money = (n: number) => formatMoney(n, catalogue?.currency ?? 'INR', lang);

  const switchMode = (mode: 'single' | 'team') => {
    if (mode === draft.mode) return;
    if (mode === 'team' && draft.rows.length === 0) {
      // Start the roster with the studio's own player so nothing typed there is lost.
      const ty = spec.typography;
      set({ mode, rows: [{
        key: rowKey(), player_name: ty.player_name, number: ty.number, fit: normaliseFit(draft.single.fit), size: draft.single.size, quantity: 1,
      }] });
    } else set({ mode });
  };

  const ready = (): boolean => {
    setAttempted(true);
    setError(null);
    if (itemIssues.length || !entry) {
      setError(itemIssues.some((i) => i.kind === 'emptyRoster') ? t('emptyRoster') : t('fixErrors'));
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return false;
    }
    if (checksFail) {
      setError(t('orderBlocked'));
      return false;
    }
    if (draft.collectionId && !me) {
      setError(t('teamNeedsSignIn'));
      return false;
    }
    return true;
  };

  const full = () => {
    if (!ready() || !entry) return null;
    const id = designId ?? flow.ensureDesignId();
    return designEntry(spec, id, fabric, items.map((i) => ({ ...i })));
  };

  const addToCart = () => {
    const e = full();
    if (!e) return;
    if (editing) {
      cart.update(editing.key, e);
      set({ cartKey: null });
      router.push('/cart');
      return;
    }
    const r = cart.add(e);
    if (r.outcome === 'full') setError(t('cartFull'));
    else setAdded(true);
  };

  const buy = () => {
    const e = full();
    if (!e) return;
    buyNow.start(e, draft.collectionId ? { id: draft.collectionId, title: draft.collectionTitle } : null);
    router.push('/checkout?buy=1');
  };

  const fabricName = (id: string) => fabrics.find((f) => f.id === id)?.name ?? id;
  const sleeves = sleevesOf(spec);
  const collar = collarOf(spec);
  // Sleeves and collar are part of the design: changing them redraws the preview and reprices the item.
  const setOption = (group: 'sleeves' | 'collar', value: string) => flow.edit(withOption(spec, group, value));
  const problem = item?.quote.seller_problem ? reasonKey(item.quote.seller_problem) : null;

  return (
    <div className="container page" data-testid="screen-configure">
      <FlowSteps current={4} />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>{t('configureTitle')}</h1>
        <Button kind="ghost" href="/studio">← {t('backToStudio')}</Button>
      </div>

      {draft.collectionId ? (
        <Banner tone="info" testId="collection-banner"
          action={t('collectionClear')} onAction={() => set({ collectionId: '', collectionTitle: '' })}>
          {t('collectionBanner', { title: draft.collectionTitle })}
        </Banner>
      ) : null}
      {editing ? <Banner tone="info" testId="editing-banner">{t('editingCartItem')}</Banner> : null}

      <div className={s.layout}>
        <div className="stack" style={{ gap: 20 }}>
          <Card title={t('stepPieces')}>
            <Tabs value={draft.mode} onChange={switchMode} label={t('orderTitle')} testId="mode"
              options={[{ value: 'single', label: t('single') }, { value: 'team', label: t('teamRoster') }]} />
            <div style={{ height: 14 }} />
            {draft.mode === 'single' ? (
              <div className="stack">
                <FitSizePicker fit={normaliseFit(draft.single.fit)} size={draft.single.size} garment={garment} sleeves={sleeves}
                  onChange={(v) => set((c) => ({ single: { ...c.single, ...v } }))} testId="single-fit-size"
                  fitTestId="single-fit" sizeTestId="single-size" guideTestId="size-chart-single"
                  sizeError={attempted && itemIssues.some((i) => i.kind === 'row' && i.field === 'size') ? t('chooseSize') : null} />
                <div className={s.grid2}>
                  <TextField label={t('quantity')} type="number" min={1} max={500} value={draft.single.quantity || ''} testId="single-qty"
                    error={attempted && itemIssues.some((i) => i.kind === 'row' && i.field === 'quantity') ? t('qtyRange') : null}
                    onValue={(v) => set((c) => ({ single: { ...c.single, quantity: Math.max(0, Math.min(500, Math.floor(Number(v) || 0))) } }))} />
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  {spec.typography.player_name || spec.typography.number
                    ? t('singlePrinted', { name: [spec.typography.player_name, spec.typography.number].filter(Boolean).join(' ') })
                    : t('singleNoName')}
                </p>
              </div>
            ) : (
              <RosterEditor rows={draft.rows} onChange={(rows) => set({ rows })} issues={attempted ? rowIssues : {}}
                failed={{}} defaultSize={draft.single.size} defaultFit={normaliseFit(draft.single.fit)} garment={garment} sleeves={sleeves} />
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

          {hasSleeves(garment) ? (
            <Card title={t('garmentOptions')} testId="configure-options">
              <GarmentOptionsPicker garment={garment} sleeves={sleeves} collar={collar} onChange={setOption} testId="configure-opt" />
            </Card>
          ) : null}

          <Card title={t('stepFabric')}>
            <fieldset className={s.fieldset}>
              <legend className="visually-hidden">{t('fabric')}</legend>
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
            <p className="small muted" style={{ margin: 0 }}>{t('optionsAtCheckout')}</p>
          </Card>
        </div>

        <aside className={s.aside} aria-label={t('priceTitle')}>
          <Card>
            <div className={s.summaryHead}>
              {preview.data ? (
                <SvgImg svg={preview.data.mockup_svg} alt={spec.style_name || t('checkoutYourDesign')} className={s.thumb} testId="checkout-mockup" />
              ) : <Skeleton height={96} className={s.thumb} />}
              <div>
                <div className={s.designName}>{spec.typography.team_name || spec.style_name || t('checkoutYourDesign')}</div>
                <div className="small muted">{t(`garment_${garment}` as StringKey)} · {fabricName(fabric)}</div>
                <OptionsLine text={optionsText(t, { garment, sleeves, collar })} testId="configure-options-line" />
                <a className="small" href="/studio">{t('edit')}</a>
              </div>
            </div>

            {checksFail ? (
              <Banner tone="fail" testId="checks-blocked" action={t('backToStudio')} onAction={() => router.push('/studio')}>
                {t('orderBlocked')}
              </Banner>
            ) : null}

            <div className={s.deliveryBox} data-testid="configure-delivery">
              {!pin.pincode ? (
                <button type="button" className={s.linkBtn} onClick={() => setPinOpen(true)}>{t('pinForDates')}</button>
              ) : item?.seller && item.delivery_date ? (
                <>
                  <strong className={s.good}>{t('deliveryBy', { date: formatDate(item.delivery_date, lang) })}</strong>
                  <span className="small"> · {t('toPincode', { pincode: pin.pincode })}</span>
                  <div className="small" data-testid="configure-seller">{t('soldBy', { seller: item.seller.name })}</div>
                  <button type="button" className={s.linkBtn} onClick={() => setPinOpen(true)}>{t('pinChange')}</button>
                </>
              ) : problem ? (
                <>
                  <strong style={{ color: 'var(--fail)' }}>{t('notDeliverableTo', { pincode: pin.pincode })}</strong>
                  <div className="small">{t(problem, { pincode: pin.pincode })}</div>
                  <button type="button" className={s.linkBtn} onClick={() => setPinOpen(true)}>{t('pinChange')}</button>
                </>
              ) : <Spinner label={t('checkingDelivery')} />}
            </div>

            <h2 className={s.priceTitle}>{t('priceTitle')} {q.status === 'loading' && item ? <span className="small muted">· {t('updatingPrice')}</span> : null}</h2>
            {!quoteReq ? (
              <p className="small muted" data-testid="price-pending">{t('pricePending')}</p>
            ) : item ? (
              <PriceSummary quote={item.quote} updating={q.status === 'loading'} showDates={false} />
            ) : q.status === 'error' ? (
              <Banner tone="warn" action={t('retry')} onAction={q.retry} testId="price-error">{t('priceUnavailable')}</Banner>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                <Spinner label={t('pricing')} />
                <Skeleton height={140} />
              </div>
            )}
            <p className="small muted" style={{ marginTop: 8 }}>{t('priceBeforeOptions')}</p>

            {error ? <div style={{ marginTop: 12 }}><Banner tone="fail" live testId="order-error">{error}</Banner></div> : null}
            {added ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="pass" live testId="added-to-cart" action={t('goToCart')} onAction={() => router.push('/cart')}>{t('addedToCart')}</Banner>
              </div>
            ) : null}

            <div className={s.buttons}>
              {draft.collectionId ? (
                <Button size="lg" block kind="accent" onClick={buy} disabled={checksFail} testId="buy-now">{t('orderTeamList')}</Button>
              ) : editing ? (
                <Button size="lg" block onClick={addToCart} disabled={checksFail} testId="update-cart-item">{t('updateCartItem')}</Button>
              ) : (
                <>
                  <Button size="lg" block kind="secondary" onClick={addToCart} disabled={checksFail} testId="add-to-cart">{t('addToCart')}</Button>
                  <Button size="lg" block kind="accent" onClick={buy} disabled={checksFail} testId="buy-now">{t('buyNow')}</Button>
                </>
              )}
            </div>
          </Card>
        </aside>
      </div>

      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={t('enquiryTitle')} testId="bulk-dialog" closeLabel={t('close')}>
        <EnquiryForm spec={spec} pieces={pieces} compact testId="checkout-enquiry" />
      </Modal>
      <Modal open={pinOpen} onClose={() => setPinOpen(false)} title={t('pinTitle')} closeLabel={t('close')}>
        <PincodeForm initial={pin.pincode} addresses={me?.addresses ?? []} onDone={() => setPinOpen(false)} testId="configure-pin" />
      </Modal>
    </div>
  );
}
