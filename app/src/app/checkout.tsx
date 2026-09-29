import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import type { Address, CartQuote, Catalogue, CheckoutItemProblem, Customer, Offer, PaymentMethod } from '../api/types';
import { ChecksList } from '../components/ChecksList';
import { AddressForm, addressLine, EMPTY_ADDRESS_FORM } from '../components/shop/AddressForm';
import { CartLineView, lineTitle } from '../components/shop/CartLineView';
import { CartTotals } from '../components/shop/CartTotals';
import { groupBySeller } from '../features/cart/cart';
import {
  addressProblems, cartQuoteRequest, checkoutHash, checkoutIssues, checkoutPayload, checkoutProblems, cleanAddress, type CheckoutDraft,
} from '../features/checkout/checkout';
import { errorMessage, useT } from '../i18n';
import { formatDay, formatMoney, percent } from '../lib/money';
import { useAuth } from '../state/auth';
import { useCart } from '../state/cart';
import { useLocation } from '../state/location';
import { usePrefs } from '../state/prefs';
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

export default function CheckoutScreen() {
  const t = useT();
  const { only } = useLocalSearchParams<{ only?: string }>();
  const lang = usePrefs((s) => s.language);
  const remember = usePrefs((s) => s.rememberCustomer);
  const savedCustomer = usePrefs((s) => s.customer);
  const savedAddress = usePrefs((s) => s.address);
  const setRemember = usePrefs((s) => s.setRememberCustomer);
  const saveCustomer = usePrefs((s) => s.saveCustomer);
  const allLines = useCart((s) => s.lines);
  const coupon = useCart((s) => s.coupon);
  const rush = useCart((s) => s.rush);
  const payment = useCart((s) => s.payment);
  const setOptions = useCart((s) => s.setOptions);
  const keyFor = useCart((s) => s.keyFor);
  const removeMany = useCart((s) => s.removeMany);
  const me = useAuth((s) => s.customer);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const setCustomer = useAuth((s) => s.setCustomer);
  const devicePin = useLocation((s) => s.pincode);
  const setDevicePin = useLocation((s) => s.setPincode);
  const { speak } = useVoiceGuide();

  const lines = useMemo(() => (only ? allLines.filter((l) => l.key === only) : allLines), [allLines, only]);
  const saved = me?.addresses ?? [];
  const [method, setMethod] = useState<'ship' | 'pickup'>('ship');
  const [choice, setChoice] = useState<number | 'new'>(saved.length ? 0 : 'new');
  const [form, setForm] = useState<Address>(() => ({
    ...EMPTY_ADDRESS_FORM, ...(savedAddress ?? {}), pincode: savedAddress?.pincode || devicePin || '',
  }));
  const [saveNew, setSaveNew] = useState(true);
  const [contact, setContact] = useState<Customer>(() => ({
    name: me?.name || savedCustomer?.name || '', phone: me?.phone || savedCustomer?.phone || '', email: me?.email || savedCustomer?.email || '',
  }));
  const [couponText, setCouponText] = useState(coupon);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [quoting, setQuoting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<CheckoutItemProblem[]>([]);
  const placing = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.catalogue().then(setCatalogue).catch(() => setCatalogue(null));
    api.offers().then((o) => setOffers(o.items)).catch(() => setOffers([]));
  }, []);

  // Signed in later (or the profile loaded): use the saved addresses and contact details.
  useEffect(() => {
    if (!me) return;
    if (me.addresses.length && choice === 'new' && !form.line1) setChoice(0);
    setContact((c) => ({ name: c.name || me.name, phone: c.phone || me.phone, email: c.email || me.email }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const address: Address = choice === 'new' ? form : saved[choice] ?? form;
  const draft: CheckoutDraft = { method, address, customer: contact, coupon, rush, payment };
  const issues = checkoutIssues(draft);
  const quoteBody = useMemo(() => (lines.length ? cartQuoteRequest(lines, draft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, method, address.pincode, address.state, coupon, rush, payment]);
  const quoteKey = quoteBody ? JSON.stringify(quoteBody) : '';
  useEffect(() => {
    if (!quoteBody) return;
    const controller = new AbortController();
    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(() => {
      api.cartQuote(quoteBody, controller.signal)
        .then((q) => {
          setQuote(q);
          // Cash on delivery can't be used here (area, seller or amount): fall back to paying online.
          if (q.payment_method === 'cod' && !q.cod_available) setOptions({ payment: 'online' });
        })
        .catch((e) => !controller.signal.aborted && setQuoteError(e))
        .finally(() => !controller.signal.aborted && setQuoting(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  if (done) return <Screen testID="screen-checkout"><Loading label={t('placingOrder')} /></Screen>;
  if (!lines.length) {
    return (
      <Screen testID="screen-checkout">
        <Empty label={t('cartEmpty')} />
        <Button label={t('browseShop')} onPress={() => router.navigate('/shop')} />
      </Screen>
    );
  }

  const applyCoupon = (code: string) => {
    const c = code.replace(/\s/g, '').toUpperCase();
    setCouponText(c);
    setOptions({ coupon: c });
  };
  const groups = quote ? groupBySeller(quote) : [];
  const quoteProblems = quote?.problems ?? [];
  const codFee = catalogue?.cod?.fee ?? 0;
  const codOn = catalogue?.cod?.enabled !== false;
  const total = quote ? formatMoney(quote.totals.total, quote.currency) : '';

  const place = async () => {
    if (placing.current) return;
    setTouched(true);
    setError(null);
    setProblems([]);
    if (issues.length || !quote || quoteProblems.length) {
      if (issues.length) speak(t('checkDetails'));
      return;
    }
    placing.current = true;
    setBusy('place');
    try {
      // A new address is kept on the account for next time.
      if (signedIn && me && method === 'ship' && choice === 'new' && saveNew && !addressProblems(form).length) {
        const next = [...me.addresses, cleanAddress(form, contact)].slice(-10);
        await api.updateMe({ addresses: next }).then(setCustomer).catch(() => undefined);
      }
      const payload = checkoutPayload(lines, draft, lang);
      // A retry of the same checkout reuses the key, so the server never creates it twice.
      const idempotency_key = keyFor(checkoutHash(payload));
      let ck = await api.checkout({ ...payload, idempotency_key });
      if (!signedIn && remember) saveCustomer(contact, method === 'ship' ? cleanAddress(address, contact) : null);
      if (method === 'ship' && address.pincode !== devicePin) setDevicePin(address.pincode);
      // Placed: the next checkout needs a new key, even for the same items.
      useCart.setState({ checkoutKey: null, checkoutKeyFor: null, coupon: '' });
      if (ck.payment_method === 'online' && ck.status !== 'paid') {
        setBusy('pay');
        // A failed payment is not lost: the confirmation screen offers "Pay now" again.
        ck = await api.payCheckout(ck.id).catch(() => ck);
      }
      setDone(true);
      removeMany(lines.map((l) => l.key));
      speak(t(ck.status === 'paid' ? 'orderPlaced' : 'paymentPending', { number: ck.number }));
      router.replace({ pathname: '/checkouts/[id]', params: { id: ck.id } });
    } catch (e) {
      setProblems(checkoutProblems(e));
      const msg = e instanceof ApiError && checkoutProblems(e).length ? t('checkoutItemsBlocked') : errorMessage(t, e);
      setError(msg);
      speak(msg);
    } finally {
      placing.current = false;
      setBusy(null);
    }
  };

  const contactBad = (f: 'name' | 'phone' | 'email') => touched && issues.some((i) => i.kind === 'customer' && i.field === f);
  const payLabel = payment === 'cod' ? t('placeCodOrder', { total }) : t('payAndPlace', { total });
  return (
    <Screen testID="screen-checkout" footer={
      <View>
        <View style={styles.footRow}>
          <T variant="label">{t('orderTotal')}</T>
          <T variant="heading" testID="checkout-total">{total}</T>
        </View>
        {quote?.delivery_by ? <T variant="caption" style={{ marginBottom: space(2) }}>{t('allDeliveredBy', { date: formatDay(quote.delivery_by) })}</T> : null}
        <Button testID="place-order" label={busy === 'pay' ? t('paying') : busy ? t('placingOrder') : payLabel} onPress={place} busy={!!busy}
          disabled={!!busy || !quote || quoteProblems.length > 0 || (touched && issues.length > 0)} />
      </View>
    }>
      {!signedIn ? (
        <Banner tone="info" text={t('checkoutGuest')} action={t('signIn')}
          onAction={() => router.push({ pathname: '/sign-in', params: { next: 'checkout' } })} testID="checkout-sign-in" />
      ) : null}

      <Card title={t('stepAddress')}>
        {catalogue?.pickup.enabled ? (
          <Segmented testID="delivery-method" value={method} onChange={setMethod}
            options={[{ value: 'ship', label: t('shipToAddress') }, { value: 'pickup', label: t('pickup') }]} />
        ) : null}
        {method === 'pickup' ? (
          <T variant="caption" style={{ marginTop: space(3) }}>{catalogue?.pickup.label}</T>
        ) : (
          <View style={{ marginTop: space(3) }}>
            {saved.map((a, i) => (
              <Pressable key={`${a.line1}-${i}`} testID={`address-${i}`} onPress={() => setChoice(i)} accessibilityRole="radio"
                accessibilityState={{ checked: choice === i }} style={[styles.option, choice === i && styles.optionOn]}>
                <T variant="label">{a.name || contact.name}{i === 0 ? ` · ${t('defaultAddress')}` : ''}</T>
                <T variant="caption">{addressLine(a)}</T>
              </Pressable>
            ))}
            {saved.length ? (
              <Pressable testID="address-new" onPress={() => setChoice('new')} accessibilityRole="radio" accessibilityState={{ checked: choice === 'new' }}
                style={[styles.option, choice === 'new' && styles.optionOn]}>
                <T variant="label">+ {t('addNewAddress')}</T>
              </Pressable>
            ) : null}
            {choice === 'new' ? (
              <View style={{ marginTop: space(2) }}>
                <AddressForm value={form} onChange={setForm} issues={issues} touched={touched} withContact={signedIn} />
                {signedIn ? (
                  <Pressable style={styles.switchRow} onPress={() => setSaveNew(!saveNew)} accessibilityRole="switch" accessibilityState={{ checked: saveNew }}>
                    <T variant="body" style={{ flex: 1 }}>{t('saveAddress')}</T>
                    <Switch value={saveNew} onValueChange={setSaveNew} />
                  </Pressable>
                ) : null}
              </View>
            ) : touched && addressProblems(address).length ? <T variant="caption" color={colors.fail}>{t('addressIncomplete')}</T> : null}
          </View>
        )}
      </Card>

      <Card title={t('customer')}>
        <Field testID="customer-name" label={t('customerName')} value={contact.name} autoComplete="name" textContentType="name"
          error={contactBad('name') ? t('required') : null} onChangeText={(name) => setContact({ ...contact, name })} />
        <Field testID="customer-phone" label={t('phone')} value={contact.phone} keyboardType="phone-pad" autoComplete="tel"
          textContentType="telephoneNumber" hint={t('phoneForDelivery')} error={contactBad('phone') ? t('invalid') : null}
          onChangeText={(phone) => setContact({ ...contact, phone })} />
        <Field testID="customer-email" label={`${t('email')} (${t('optional')})`} value={contact.email} keyboardType="email-address"
          autoCapitalize="none" autoComplete="email" textContentType="emailAddress"
          error={contactBad('email') ? t('invalid') : null} onChangeText={(email) => setContact({ ...contact, email })} />
        {!signedIn ? (
          <Pressable style={styles.switchRow} onPress={() => setRemember(!remember, contact)} accessibilityRole="switch" accessibilityState={{ checked: remember }}>
            <T variant="body" style={{ flex: 1 }}>{t('rememberMe')}</T>
            <Switch value={remember} onValueChange={(on) => setRemember(on, contact)} testID="remember-me" />
          </Pressable>
        ) : null}
      </Card>

      <Card title={t('stepDelivery')} testID="seller-groups">
        {!quote ? (quoteError ? <Banner tone="warn" text={t('priceUnavailable')} action={t('retry')} onAction={() => setOptions({ coupon })} /> : <Loading label={t('pricing')} />) : null}
        {groups.map((g, gi) => (
          <View key={g.seller?.id ?? gi} style={styles.group} testID={`seller-group-${gi}`}>
            <T variant="label" testID={`seller-group-title-${gi}`}>
              {t('shipmentOf', { n: gi + 1, total: groups.length })} · {g.seller ? t('soldBy', { seller: g.seller.name }) : t('noSeller')}
            </T>
            {g.deliveryDate ? (
              <T variant="body" color={colors.pass}>
                {t(method === 'pickup' ? 'estimatedPickup' : 'deliveryBy', { date: formatDay(g.deliveryDate) })}
              </T>
            ) : null}
            {g.indexes.map((i) => (
              <T key={i} variant="caption">• {lines[i] ? lineTitle(lines[i], quote?.items[i] ?? null, t('customDesign')) : ''}</T>
            ))}
          </View>
        ))}
        {lines.map((l, i) => (
          <CartLineView key={l.key} line={l} index={i} quoted={quote?.items.find((x) => x.index === i) ?? null} currency={quote?.currency ?? 'INR'} readOnly />
        ))}
        {catalogue?.rush.enabled ? (
          <Pressable style={styles.switchRow} onPress={() => setOptions({ rush: !rush })} accessibilityRole="switch" accessibilityState={{ checked: rush }}>
            <View style={{ flex: 1 }}>
              <T variant="body">{catalogue.rush.label}</T>
              <T variant="caption">{t('expressHint', { pct: percent(catalogue.rush.fee_rate) })}</T>
            </View>
            <Switch value={rush} onValueChange={(v) => setOptions({ rush: v })} testID="express" />
          </Pressable>
        ) : null}
      </Card>

      <Card title={t('offersTitle')} testID="offers">
        {offers.map((o) => (
          <View key={o.code} style={styles.offer}>
            <View style={{ flex: 1 }}>
              <T variant="label">{o.code}</T>
              <T variant="caption">{o.title}</T>
            </View>
            <Button compact kind={coupon === o.code ? 'ghost' : 'secondary'} testID={`offer-${o.code}`}
              label={coupon === o.code ? t('applied') : t('apply')} onPress={() => applyCoupon(coupon === o.code ? '' : o.code)} />
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1, marginRight: space(2) }}>
            <Field testID="coupon" label={`${t('couponCode')} (${t('optional')})`} value={couponText} maxLength={24} autoCapitalize="characters"
              error={quote?.coupon?.error && coupon ? t('couponInvalid') : null}
              onChangeText={(v) => setCouponText(v.replace(/\s/g, '').toUpperCase())} onSubmitEditing={() => applyCoupon(couponText)} />
          </View>
          <Button compact kind="secondary" label={t('apply')} testID="apply-coupon" onPress={() => applyCoupon(couponText)} style={{ marginTop: space(6) }} />
        </View>
        {quote?.coupon?.amount ? (
          <T variant="caption" color={colors.pass} testID="coupon-ok">
            {t('couponSaves', { code: quote.coupon.code, amount: formatMoney(quote.coupon.amount, quote.currency) })}
          </T>
        ) : null}
      </Card>

      <Card title={t('stepPayment')}>
        <PayOption testID="pay-online" value="online" current={payment} onPick={(p) => setOptions({ payment: p })}
          title={t('payOnline')} note={t('payOnlineNote')} />
        {codOn ? (
          <PayOption testID="pay-cod" value="cod" current={payment} onPick={(p) => setOptions({ payment: p })} disabled={!!quote && !quote.cod_available}
            title={t('payCod')} note={quote && !quote.cod_available ? t('codUnavailableHere') : codFee ? t('codFeeNote', { fee: formatMoney(codFee, quote?.currency ?? 'INR') }) : t('codNote')} />
        ) : null}
      </Card>

      <Card title={t('priceTitle')}>
        {quote ? <CartTotals quote={quote} /> : null}
        {quoting && quote ? <T variant="caption" color={colors.muted}>{t('updatingPrice')}</T> : null}
        {quoteProblems.map((p) => <Banner key={p} tone="fail" text={p} testID="quote-problem" />)}
      </Card>

      {problems.length ? (
        <Card title={t('checkoutItemsBlocked')} testID="checkout-problems">
          {problems.map((p) => (
            <View key={p.index} style={{ marginBottom: space(3) }}>
              <T variant="label">{lines[p.index] ? lineTitle(lines[p.index], null, t('customDesign')) : t('itemN', { n: p.index + 1 })}</T>
              <T variant="body">{p.message}</T>
              {(p.failures ?? []).map((f) => (
                <View key={`${f.line}-${f.size}`} style={{ marginTop: space(2) }}>
                  <T variant="caption">{t('line', { n: f.line })}: {[f.player_name, f.number, f.size].filter(Boolean).join(' · ')}</T>
                  <ChecksList checks={f.checks} compact />
                </View>
              ))}
            </View>
          ))}
        </Card>
      ) : null}
      {error ? <Banner tone="fail" text={error} testID="checkout-error" action={problems.length ? undefined : t('retry')} onAction={place} /> : null}
    </Screen>
  );
}

function PayOption({ value, current, onPick, title, note, disabled, testID }: {
  value: PaymentMethod; current: PaymentMethod; onPick: (p: PaymentMethod) => void; title: string; note: string; disabled?: boolean; testID: string;
}) {
  const on = value === current;
  return (
    <Pressable testID={testID} onPress={() => onPick(value)} disabled={disabled} accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !!disabled }} style={[styles.option, on && styles.optionOn, disabled && { opacity: 0.5 }]}>
      <T variant="label">{on ? '◉' : '○'} {title}</T>
      <T variant="caption">{note}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(1) },
  option: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space(3), marginBottom: space(2), minHeight: 48 },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginVertical: space(2) },
  group: { borderLeftWidth: 3, borderLeftColor: colors.brand, paddingLeft: space(3), marginBottom: space(3) },
  offer: { flexDirection: 'row', alignItems: 'center', marginBottom: space(3), gap: space(2) },
});
