import { StyleSheet, View } from 'react-native';
import type { CartQuote } from '../../api/types';
import { useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

function Row({ label, value, strong, tone, testID }: { label: string; value: string; strong?: boolean; tone?: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <T variant={strong ? 'label' : 'body'} style={{ flex: 1 }} color={tone}>{label}</T>
      <T variant="label" color={tone} testID={testID}>{value}</T>
    </View>
  );
}

/** The whole cart's price exactly as the server worked it out (one delivery charge per seller). */
export function CartTotals({ quote }: { quote: CartQuote }) {
  const t = useT();
  const m = (x: number) => formatMoney(x, quote.currency);
  const s = quote.totals;
  const sellers = new Set(quote.items.map((i) => i.seller?.id ?? '')).size;
  return (
    <View testID="cart-totals">
      <Row label={t('subtotal', { n: quote.pieces })} value={m(s.subtotal)} />
      {s.quantity_discount ? <Row label={t('quantityDiscountShort')} value={m(-s.quantity_discount)} tone={colors.pass} /> : null}
      {s.rush ? <Row label={t('expressChosen')} value={m(s.rush)} /> : null}
      {s.coupon ? <Row label={t('couponLine', { code: quote.coupon?.code ?? '' })} value={m(-s.coupon)} tone={colors.pass} testID="cart-coupon" /> : null}
      <Row label={sellers > 1 ? t('deliveryChargesSellers', { n: sellers }) : t('deliveryCharges')} value={s.shipping ? m(s.shipping) : t('free')} />
      {s.cod_fee ? <Row label={t('codFee')} value={m(s.cod_fee)} testID="cart-cod-fee" /> : null}
      <Row label={t('taxShort')} value={m(s.tax)} />
      <View style={styles.total}>
        <Row label={t('total')} value={m(s.total)} strong testID="cart-price-total" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(1) },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: space(2), paddingTop: space(2) },
});
