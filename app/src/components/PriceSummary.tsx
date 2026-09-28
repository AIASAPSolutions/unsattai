import { StyleSheet, View } from 'react-native';
import type { Pricing } from '../api/types';
import { useT } from '../i18n';
import { formatMoney, percent } from '../lib/money';
import { T } from '../ui/Text';
import { colors, space } from '../ui/theme';

function Row({ label, value, strong, tone, testID }: { label: string; value: string; strong?: boolean; tone?: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <T variant={strong ? 'label' : 'body'} style={{ flex: 1 }} color={tone}>{label}</T>
      <T variant="label" color={tone} testID={testID}>{value}</T>
    </View>
  );
}

/** The itemised price exactly as the server worked it out: the same numbers appear on the invoice. */
export function PriceSummary({ pricing, compact }: { pricing: Pricing; compact?: boolean }) {
  const t = useT();
  const m = (x: number) => formatMoney(x, pricing.currency);
  const qd = pricing.quantity_discount;
  const sh = pricing.shipping;
  return (
    <View testID="price-summary">
      <Row label={t('subtotal', { n: pricing.pieces })} value={m(pricing.subtotal)} />
      {qd.amount ? <Row label={t('quantityDiscount', { pct: percent(qd.rate) })} value={m(-qd.amount)} tone={colors.pass} /> : null}
      {pricing.rush.selected && pricing.rush.amount ? <Row label={pricing.rush.label} value={m(pricing.rush.amount)} /> : null}
      {pricing.coupon?.amount ? <Row label={t('couponLine', { code: pricing.coupon.code })} value={m(-pricing.coupon.amount)} tone={colors.pass} /> : null}
      <Row label={sh.method === 'pickup' ? (sh.label || t('pickup')) : t('shippingTo', { zone: sh.zone_name ?? '' })}
        value={sh.amount ? m(sh.amount) : t('free')} />
      <Row label={t(pricing.tax.inclusive ? 'taxIncluded' : 'taxLine', { name: pricing.tax.name, pct: percent(pricing.tax.rate) })}
        value={m(pricing.tax.amount)} />
      <View style={styles.total}>
        <Row label={t('total')} value={m(pricing.total)} strong testID="price-total" />
        <T variant="caption">{t('perPiece', { amount: m(pricing.average_per_piece) })}</T>
      </View>
      {!compact && qd.next ? (
        <T variant="caption" color={colors.info} style={{ marginTop: space(2) }} testID="next-tier">
          {t('nextTier', { n: qd.next.pieces_needed, pct: percent(qd.next.rate) })}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(1) },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: space(2), paddingTop: space(2) },
});
