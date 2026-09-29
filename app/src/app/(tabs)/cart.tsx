import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { CartQuote } from '../../api/types';
import { CartTotals } from '../../components/shop/CartTotals';
import { CartLineView } from '../../components/shop/CartLineView';
import { DeliverToBar } from '../../components/shop/DeliverTo';
import { cartPieces } from '../../features/cart/cart';
import { useDeliveryPincode } from '../../features/pincode/useServiceability';
import { errorMessage, useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { useAuth } from '../../state/auth';
import { useCart } from '../../state/cart';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { Empty, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

export default function CartScreen() {
  const t = useT();
  const lines = useCart((s) => s.lines);
  const sync = useCart((s) => s.sync);
  const syncError = useCart((s) => s.syncError);
  const save = useCart((s) => s.save);
  const payment = useCart((s) => s.payment);
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const pincode = useDeliveryPincode();
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [quoting, setQuoting] = useState(false);

  // An estimate for the Deliver-to PIN code; the checkout prices the real address.
  const body = useMemo(() => (lines.length ? {
    items: lines.map((l) => l.item), delivery: { method: 'ship' as const, pincode: pincode ?? '', state: '' },
    coupon: '', rush: false, payment_method: payment,
  } : null), [lines, pincode, payment]);
  const key = body ? JSON.stringify(body) : '';
  useEffect(() => {
    if (!body) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    setQuoteError(null);
    const timer = setTimeout(() => {
      api.cartQuote(body, controller.signal)
        .then(setQuote)
        .catch((e) => !controller.signal.aborted && setQuoteError(e))
        .finally(() => !controller.signal.aborted && setQuoting(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!lines.length) {
    return (
      <Screen testID="screen-cart">
        <DeliverToBar />
        <Empty label={t('cartEmpty')} />
        <Button testID="cart-shop" label={t('browseShop')} onPress={() => router.navigate('/shop')} style={{ marginBottom: space(2) }} />
        <Button kind="secondary" label={t('designYourOwn')} onPress={() => router.navigate('/')} />
        {!signedIn ? <T variant="caption" style={{ marginTop: space(4), textAlign: 'center' }}>{t('cartSignInHint')}</T> : null}
      </Screen>
    );
  }

  const problems = quote?.problems ?? [];
  return (
    <Screen testID="screen-cart" footer={
      <View>
        <View style={styles.footRow}>
          <T variant="label">{t('cartSummary', { items: lines.length, pieces: cartPieces(lines) })}</T>
          {quote ? <T variant="label" testID="cart-total">{formatMoney(quote.totals.total, quote.currency)}</T> : null}
        </View>
        <Button testID="proceed-checkout" label={t('proceedToCheckout')} onPress={() => router.push('/checkout')}
          disabled={problems.length > 0} style={{ marginTop: space(2) }} />
      </View>
    }>
      <DeliverToBar />
      {signedIn && sync === 'error' ? (
        <Banner tone="warn" text={t('cartNotSaved', { detail: errorMessage(t, syncError) })} action={t('retry')} onAction={() => save().catch(() => undefined)} />
      ) : null}
      {lines.map((l, i) => {
        const q = quote?.items.find((x) => x.index === i);
        return <CartLineView key={l.key} line={l} index={i} quoted={q ?? null} currency={quote?.currency ?? 'INR'} />;
      })}
      <Card title={t('priceTitle')}>
        {quote ? <CartTotals quote={quote} /> : quoteError ? null : <Loading label={t('pricing')} />}
        {quoteError ? <Banner tone="warn" text={t('priceUnavailable')} /> : null}
        {quote?.delivery_by ? (
          <T variant="label" style={{ marginTop: space(2) }} testID="cart-eta">{t('allDeliveredBy', { date: formatDay(quote.delivery_by) })}</T>
        ) : null}
        {!pincode ? <T variant="caption">{t('cartNoPincode')}</T> : null}
        {quoting && quote ? <T variant="caption" color={colors.muted}>{t('updatingPrice')}</T> : null}
        {problems.map((p) => <Banner key={p} tone="fail" text={p} testID="cart-problem" />)}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
