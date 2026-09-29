import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SellerOffer, Serviceability } from '../../api/types';
import { chosenOffer, otherOffers, serviceMessage } from '../../features/pincode/pincode';
import { errorMessage, useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { PincodeSheet } from './DeliverTo';

export function ratingText(r: { average: number | null; count: number }): string {
  return r.average === null ? '' : `★ ${r.average.toFixed(1)} (${r.count})`;
}

/** Delivery date, seller, cash on delivery and other sellers for a PIN code, like a marketplace product page. */
export function DeliveryBox({ pincode, data, loading, error, onRetry, sellerId, onSeller, currency, garment }: {
  pincode: string | null;
  data: Serviceability | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  sellerId: string;
  onSeller: (id: string) => void;
  currency: string;
  garment: string;
}) {
  const t = useT();
  const [sheet, setSheet] = useState(false);
  const offer = chosenOffer(data, sellerId);
  const others = otherOffers(data, sellerId);
  const msg = pincode ? serviceMessage(pincode, data) : null;
  return (
    <Card title={t('delivery')} testID="delivery-box" right={
      <Button compact kind="ghost" testID="delivery-change" label={pincode ? t('changePincodeShort', { pin: pincode }) : t('enterPincode')}
        onPress={() => setSheet(true)} />
    }>
      {!pincode ? (
        <T variant="body" testID="delivery-need-pin">{t('enterPincodeForDates')}</T>
      ) : error ? (
        <Banner tone="warn" text={errorMessage(t, error)} action={t('retry')} onAction={onRetry} />
      ) : loading && !data ? (
        <Loading label={t('checkingDelivery')} />
      ) : msg && msg.tone === 'fail' ? (
        <Banner tone="fail" text={t(msg.key, msg.params)} testID="delivery-problem" />
      ) : offer ? (
        <View testID="delivery-offer">
          <T variant="heading" color={colors.pass} testID="delivery-date">{t('deliveryBy', { date: formatDay(offer.delivery_date) })}</T>
          {data?.place ? <T variant="caption">{t('deliveryTo', { place: data.place.state_name })}</T> : null}
          <T variant="body" style={{ marginTop: space(1) }} testID="sold-by">
            {t('soldBy', { seller: offer.seller_name })}{offer.rating.average !== null ? `  ${ratingText(offer.rating)}` : ''}
          </T>
          <T variant="caption" color={offer.cod_available ? colors.pass : colors.muted} testID="cod-note">
            {offer.cod_available ? t('codAvailable') : t('codNotAvailable')}
          </T>
          {others.length ? (
            <View style={{ marginTop: space(3) }} testID="other-sellers">
              <T variant="label" style={{ marginBottom: space(2) }}>{t('otherSellers', { n: others.length })}</T>
              {others.map((o, i) => (
                <OfferRow key={o.seller_id} o={o} currency={currency} index={i} onChoose={() => onSeller(o.seller_id)} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <PincodeSheet visible={sheet} onClose={() => setSheet(false)} garment={garment} />
    </Card>
  );
}

function OfferRow({ o, currency, index, onChoose }: { o: SellerOffer; currency: string; index: number; onChoose: () => void }) {
  const t = useT();
  const tags = [o.fastest ? t('fastest') : '', o.cheapest ? t('cheapest') : ''].filter(Boolean).join(' · ');
  return (
    <View style={styles.offer} testID={`other-seller-${index}`}>
      <View style={{ flex: 1 }}>
        <T variant="label">{o.seller_name}{o.rating.average !== null ? `  ${ratingText(o.rating)}` : ''}</T>
        <T variant="caption">{formatMoney(o.unit_price, currency)} {t('each')} · {t('deliveryBy', { date: formatDay(o.delivery_date) })}</T>
        <T variant="caption">{o.cod_available ? t('codAvailable') : t('codNotAvailable')}{tags ? ` · ${tags}` : ''}</T>
      </View>
      <Button compact kind="secondary" label={t('choose')} onPress={onChoose} testID={`choose-seller-${index}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  offer: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: space(3), marginBottom: space(2), gap: space(2),
  },
});
