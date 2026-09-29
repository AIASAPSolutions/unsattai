import { Buffer } from 'buffer';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../api/endpoints';
import { TEXT_LIMITS, type CartQuote, type Catalogue, type Check } from '../api/types';
import { ChecksList } from '../components/ChecksList';
import { Qty, SizePicker } from '../components/OrderInputs';
import { DeliverToBar } from '../components/shop/DeliverTo';
import { buildItems, customCartItem, itemIssues, type DraftIssue } from '../features/order/buildOrder';
import { useDeliveryPincode } from '../features/pincode/useServiceability';
import { errorMessage, useT } from '../i18n';
import { newId } from '../lib/ids';
import { formatDay, formatMoney } from '../lib/money';
import { readAsBase64 } from '../lib/readFile';
import { parseRoster, totalPieces, type RosterError } from '../lib/roster';
import { cleanNumber } from '../lib/validation';
import { useCart } from '../state/cart';
import { currentSpec, useFlow, type Commerce, type RosterRow } from '../state/flow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';
import { Empty, Loading } from '../ui/States';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

function RowEditor({ row, index, issues, onChange, onRemove }: {
  row: RosterRow; index: number; issues: DraftIssue[]; onChange: (r: RosterRow) => void; onRemove: () => void;
}) {
  const t = useT();
  const has = (field: string) => issues.some((i) => i.kind === 'row' && i.index === index && i.field === field);
  return (
    <View style={styles.row} testID={`roster-row-${index}`}>
      <View style={styles.rowHead}>
        <T variant="label">{t('line', { n: index + 1 })}</T>
        <Button compact kind="ghost" label={t('removeRow')} onPress={onRemove} testID={`remove-row-${index}`} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 3, marginRight: space(2) }}>
          <Field testID={`row-name-${index}`} label={t('playerName')} value={row.player_name} maxLength={TEXT_LIMITS.player_name}
            error={has('player_name') ? t('tooLong') : null} onChangeText={(player_name) => onChange({ ...row, player_name })} />
        </View>
        <View style={{ flex: 1 }}>
          <Field testID={`row-number-${index}`} label={t('number')} value={row.number} maxLength={3} keyboardType="number-pad"
            error={has('number') ? t('digitsOnly') : null} onChangeText={(v) => onChange({ ...row, number: cleanNumber(v) })} />
        </View>
      </View>
      <SizePicker value={row.size} onChange={(size) => onChange({ ...row, size })} testID={`row-size-${index}`} />
      <Qty value={row.quantity} onChange={(quantity) => onChange({ ...row, quantity })} testID={`row-qty-${index}`} />
    </View>
  );
}

/** The last step of designing: sizes, roster and fabric, then into the cart (or straight to checkout). */
export default function OrderScreen() {
  const t = useT();
  const spec = useFlow(currentSpec);
  const designId = useFlow((s) => s.designId);
  const product = useFlow((s) => s.product);
  const draft = useFlow((s) => s.order);
  const setOrder = useFlow((s) => s.setOrder);
  const addToCart = useCart((s) => s.add);
  const payment = useCart((s) => s.payment);
  const pincode = useDeliveryPincode();
  const { speak } = useVoiceGuide();

  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [rosterNote, setRosterNote] = useState<{ added: number; errors: RosterError[] } | null>(null);
  const [touched, setTouched] = useState(false);
  const [preflight, setPreflight] = useState<{ checks: Check[]; ready: boolean } | null>(null);
  const [preflightError, setPreflightError] = useState<unknown>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [quoting, setQuoting] = useState(false);
  const commerce = draft.commerce;
  const setCommerce = (patch: Partial<Commerce>) => setOrder({ commerce: { ...commerce, ...patch } });

  useEffect(() => {
    api.catalogue().then(setCatalogue).catch(() => setCatalogue(null));
  }, []);

  const items = useMemo(() => (spec ? buildItems(draft, spec) : []), [draft, spec]);
  const orderSizes = useMemo(() => [...new Set(items.map((i) => i.size))], [items]);
  const sizeKey = orderSizes.join(',');

  // Re-check the design for the sizes actually ordered (logo DPI depends on size).
  useEffect(() => {
    if (!spec) return;
    const controller = new AbortController();
    setPreflight(null);
    setPreflightError(null);
    const timer = setTimeout(() => {
      api.render(spec, orderSizes, controller.signal)
        .then((r) => setPreflight({ checks: r.checks, ready: r.manufacturing_ready }))
        .catch((e) => !controller.signal.aborted && setPreflightError(e));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, sizeKey]);

  const issues = spec ? itemIssues(draft, spec) : [];
  const cartItem = useMemo(() => (spec && items.length ? customCartItem(spec, items, commerce.fabric, designId, !!product) : null),
    [spec, items, commerce.fabric, designId, product]);

  // Live price and date for this item, delivered to the Deliver-to PIN code by the best seller.
  const quoteKey = cartItem && !issues.length ? JSON.stringify([cartItem.lines, cartItem.fabric, pincode, payment, spec?.elements.length]) : '';
  useEffect(() => {
    if (!cartItem || !quoteKey) return;
    const controller = new AbortController();
    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(() => {
      api.cartQuote({ items: [cartItem], delivery: { method: 'ship', pincode: pincode ?? '', state: '' }, coupon: '', rush: false, payment_method: payment },
        controller.signal)
        .then(setQuote)
        .catch((e) => !controller.signal.aborted && setQuoteError(e))
        .finally(() => !controller.signal.aborted && setQuoting(false));
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  if (!spec) {
    return (
      <Screen>
        <Empty label={t('noDesigns')} />
        <Button label={t('newDesign')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const fabrics = catalogue ? catalogue.fabrics.filter((f) => f.garments.includes(spec.garment)) : [];
  const setRows = (rows: RosterRow[]) => setOrder({ rows });
  const addParsed = (text: string) => {
    const res = parseRoster(text, draft.rows[draft.rows.length - 1]?.size ?? 'M');
    setRows([...draft.rows, ...res.rows.map((r) => ({ ...r, key: newId('row') }))]);
    setRosterNote({ added: res.rows.length, errors: res.errors });
  };
  const paste = async () => addParsed(await Clipboard.getStringAsync());
  const importFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/plain', 'text/comma-separated-values', 'text/tab-separated-values'], copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets[0]) return;
      const { base64 } = await readAsBase64(res.assets[0].uri);
      addParsed(Buffer.from(base64, 'base64').toString('utf8'));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  };

  const blocked = preflight ? !preflight.ready : false;
  const quoted = quote?.items[0] ?? null;
  const title = product ? t('customisedProduct', { title: product.title }) : spec.typography.team_name || spec.style_name;
  const put = (then?: 'checkout') => {
    setTouched(true);
    setError(null);
    setAdded(null);
    if (issues.length || blocked || !preflight || !cartItem) return;
    const res = addToCart({ item: cartItem, title, garment: spec.garment });
    if (res.outcome === 'full') {
      setError(t('cartFull'));
      speak(t('cartFull'));
      return;
    }
    if (then === 'checkout' && res.key) {
      router.push({ pathname: '/checkout', params: { only: res.key } });
      return;
    }
    const text = t('addedToCart', { title });
    setAdded(text);
    speak(text);
  };

  const listIssue = issues.find((i) => i.kind === 'emptyRoster' || i.kind === 'tooManyLines' || i.kind === 'tooManyPieces');
  const disabled = blocked || !preflight || (touched && issues.length > 0);
  return (
    <Screen
      testID="screen-order"
      footer={
        <View>
          <View style={styles.footerRow}>
            <T variant="label" testID="total-pieces">{t('totalPieces', { n: totalPieces(items) })}</T>
            {quoted ? <T variant="label" testID="footer-total">{formatMoney(quoted.quote.total, quote!.currency)}</T> : null}
          </View>
          {added ? (
            <Banner tone="pass" text={added} testID="added-to-cart">
              <View style={styles.inline}>
                <Button compact testID="go-to-cart" label={t('goToCart')} onPress={() => router.navigate('/cart')} />
                <Button compact kind="ghost" label={t('keepDesigning')} onPress={() => router.back()} />
              </View>
            </Banner>
          ) : null}
          <View style={styles.inline}>
            <Button testID="add-to-cart" kind="secondary" label={t('addToCart')} onPress={() => put()} disabled={disabled} style={{ flex: 1 }} />
            <Button testID="buy-now" label={t('buyNow')} onPress={() => put('checkout')} disabled={disabled} style={{ flex: 1 }} />
          </View>
        </View>
      }
    >
      <DeliverToBar garment={spec.garment} />
      {preflightError ? (
        <Banner tone="warn" text={errorMessage(t, preflightError)} />
      ) : !preflight ? <Loading label={t('checking')} /> : blocked ? (
        <Banner tone="fail" text={t('orderBlocked')} testID="order-blocked">
          <ChecksList checks={preflight.checks} compact />
          <Button compact kind="secondary" label={t('backToStudio')} onPress={() => router.back()} />
        </Banner>
      ) : null}

      <Segmented testID="order-mode" value={draft.mode} onChange={(mode) => setOrder({ mode })}
        options={[{ value: 'single', label: t('single') }, { value: 'team', label: t('team') }]} />

      {draft.mode === 'single' ? (
        <Card title={t('single')} style={{ marginTop: space(4) }}>
          <T variant="caption" style={{ marginBottom: space(3) }}>
            {[spec.typography.player_name, spec.typography.number].filter(Boolean).join(' · ') || spec.style_name}
          </T>
          <T variant="label" style={{ marginBottom: space(2) }}>{t('size')}</T>
          <SizePicker testID="single-size" value={draft.single.size} onChange={(size) => setOrder({ single: { ...draft.single, size } })} />
          <Qty testID="single-qty" value={draft.single.quantity} onChange={(quantity) => setOrder({ single: { ...draft.single, quantity } })} />
        </Card>
      ) : (
        <Card title={t('roster')} style={{ marginTop: space(4) }}>
          <T variant="caption" style={{ marginBottom: space(3) }}>{t('rosterHelp')}</T>
          <View style={styles.wrap}>
            <Button testID="paste-roster" compact kind="secondary" label={t('pasteRoster')} onPress={paste} style={{ marginRight: space(2), marginBottom: space(2) }} />
            <Button testID="import-roster" compact kind="secondary" label={t('importRoster')} onPress={importFile} style={{ marginBottom: space(2) }} />
          </View>
          {rosterNote ? (
            <Banner tone={rosterNote.errors.length ? 'warn' : 'pass'} text={t('rosterImported', { n: rosterNote.added })} testID="roster-note">
              {rosterNote.errors.length ? <T variant="caption" color={colors.ink}>{t('rosterErrors', { n: rosterNote.errors.length })}</T> : null}
              {rosterNote.errors.slice(0, 8).map((e) => (
                <T key={e.line} variant="caption" color={colors.ink}>{t('line', { n: e.line })}: “{e.text}” · {t(`rosterIssue_${e.issue as 'size'}`)}</T>
              ))}
            </Banner>
          ) : null}
          {draft.rows.map((r, i) => (
            <RowEditor key={r.key} row={r} index={i} issues={touched ? issues : []}
              onChange={(next) => setRows(draft.rows.map((x) => (x.key === r.key ? next : x)))}
              onRemove={() => setRows(draft.rows.filter((x) => x.key !== r.key))} />
          ))}
          <Button testID="add-row" kind="secondary" label={`+ ${t('addRow')}`} onPress={() => setRows([...draft.rows, {
            key: newId('row'), player_name: '', number: '', size: draft.rows[draft.rows.length - 1]?.size ?? 'M', quantity: 1,
          }])} />
          {touched && listIssue ? (
            <T variant="caption" color={colors.fail} style={{ marginTop: space(2) }}>
              {listIssue.kind === 'emptyRoster' ? t('emptyRoster') : t('tooManyLines')}
            </T>
          ) : null}
        </Card>
      )}

      {fabrics.length > 1 ? (
        <Card title={t('fabric')}>
          {fabrics.map((f) => (
            <Pressable key={f.id} testID={`fabric-${f.id}`} onPress={() => setCommerce({ fabric: f.id })} accessibilityRole="radio"
              accessibilityState={{ checked: commerce.fabric === f.id }}
              style={[styles.option, commerce.fabric === f.id && styles.optionOn]}>
              <T variant="label" style={{ flex: 1 }}>{f.name}</T>
              <T variant="caption">{f.surcharge ? `+${formatMoney(f.surcharge, catalogue!.currency)} ${t('each')}` : t('included')}</T>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Card title={t('priceTitle')}>
        {quoted ? (
          <View testID="item-quote">
            <View style={styles.footerRow}>
              <T variant="body">{t('itemPrice')}</T>
              <T variant="label" testID="price-total">{formatMoney(quoted.quote.total, quote!.currency)}</T>
            </View>
            <T variant="caption">{t('perPiece', { amount: formatMoney(quoted.quote.average_per_piece, quote!.currency) })}</T>
            {quoted.quote.quantity_discount.next ? (
              <T variant="caption" color={colors.info} testID="next-tier">
                {t('nextTier', { n: quoted.quote.quantity_discount.next.pieces_needed, pct: Math.round(quoted.quote.quantity_discount.next.rate * 100) })}
              </T>
            ) : null}
            {quoted.seller && quoted.delivery_date ? (
              <T variant="label" style={{ marginTop: space(2) }} testID="quote-eta">
                {t('deliveryBy', { date: formatDay(quoted.delivery_date) })} · {t('soldBy', { seller: quoted.seller.name })}
              </T>
            ) : null}
            <T variant="caption">{pincode ? t('itemPriceNote') : t('cartNoPincode')}</T>
          </View>
        ) : issues.length ? <T variant="caption">{t('fixRosterForPrice')}</T> : quoteError ? null : <Loading label={t('pricing')} />}
        {quoteError ? <Banner tone="warn" text={t('priceUnavailable')} testID="quote-error" /> : null}
        {quoting && quote ? <T variant="caption" color={colors.muted}>{t('updatingPrice')}</T> : null}
        {(quoted?.problems ?? []).map((p) => <Banner key={p} tone="fail" text={p} testID="quote-problem" />)}
      </Card>

      {error ? <Banner tone="fail" text={error} testID="order-error" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  inline: { flexDirection: 'row', gap: space(3), marginTop: space(2) },
  row: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(2) },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(1) },
  option: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: space(3), marginBottom: space(2), minHeight: 48,
  },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
});
