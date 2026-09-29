import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CartQuoteItem } from '../../api/types';
import { linePieces, linesSummary, type CartLine } from '../../features/cart/cart';
import { useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { FIT_KEY } from '../../lib/sizing';
import { optionsText } from '../GarmentOptionsPicker';
import { useCart } from '../../state/cart';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { Qty } from '../OrderInputs';
import { DesignThumb } from './DesignThumb';
import { RemoteSvg } from './RemoteSvg';

export function lineTitle(line: CartLine, quoted: CartQuoteItem | null, custom: string): string {
  return line.title || quoted?.title || custom;
}

/** One cart item: picture, what it is, who sells it, when it arrives, its price, and quantity or remove. */
export function CartLineView({ line, index, quoted, currency, readOnly }: {
  line: CartLine; index: number; quoted: CartQuoteItem | null; currency: string; readOnly?: boolean;
}) {
  const t = useT();
  const remove = useCart((s) => s.remove);
  const setQuantity = useCart((s) => s.setQuantity);
  const item = line.item;
  const title = lineTitle(line, quoted, t('customDesign'));
  const garment = item.garment ?? line.garment ?? item.spec?.garment ?? quoted?.garment;
  const single = item.lines.length === 1;
  const opts = quoted?.options;
  const chosen = optionsText(t, garment, opts?.sleeves ?? item.sleeves ?? item.spec?.sleeves, opts?.collar ?? item.collar ?? item.spec?.collar);
  const colourway = item.product_id && (item.colourway || opts?.colourway) && (item.colourway || opts?.colourway) !== 'original'
    ? line.colourwayName || item.colourway || opts?.colourway : '';
  // The server's picture already shows the chosen colourway, sleeves and collar.
  const image = (item.product_id && quoted?.image_url) || line.image;
  return (
    <Card testID={`cart-item-${index}`}>
      <View style={styles.row}>
        <Pressable style={styles.pic} disabled={!line.slug} accessibilityRole={line.slug ? 'link' : undefined}
          onPress={() => line.slug && router.push({ pathname: '/product/[slug]', params: { slug: line.slug } })}>
          {image ? <RemoteSvg path={image} label={title} /> : item.spec ? <DesignThumb spec={item.spec} label={title} /> : null}
        </Pressable>
        <View style={{ flex: 1, marginLeft: space(3) }}>
          <T variant="label" numberOfLines={2} testID={`cart-item-title-${index}`}>{title}</T>
          <T variant="caption">
            {[garment ? t(`garment_${garment}`) : '', item.product_id ? t('readyMade') : t('yourDesign')].filter(Boolean).join(' · ')}
          </T>
          {chosen || colourway ? (
            <T variant="caption" testID={`cart-item-options-${index}`}>
              {[chosen, colourway ? `${t('colourway')}: ${colourway}` : ''].filter(Boolean).join(' · ')}
            </T>
          ) : null}
          <T variant="caption" numberOfLines={3} testID={`cart-item-lines-${index}`}>{linesSummary(item.lines, 3, (f) => t(FIT_KEY[f]))}</T>
          <T variant="caption">{t('fabricNamed', { fabric: quoted?.quote.fabric.name ?? item.fabric })}</T>
          {quoted?.seller ? (
            <T variant="caption" color={colors.ink} testID={`cart-item-seller-${index}`}>
              {t('soldBy', { seller: quoted.seller.name })}{quoted.delivery_date ? ` · ${t('deliveryBy', { date: formatDay(quoted.delivery_date) })}` : ''}
            </T>
          ) : null}
          {quoted ? <T variant="label" style={{ marginTop: space(1) }}>{formatMoney(quoted.quote.total, currency)}</T> : null}
        </View>
      </View>
      {quoted?.problems.map((p) => <T key={p} variant="caption" color={colors.fail} style={{ marginTop: space(1) }}>{p}</T>)}
      {!readOnly ? (
        <View style={styles.actions}>
          {single ? (
            <View style={{ flex: 1 }}>
              <Qty testID={`cart-qty-${index}`} value={item.lines[0].quantity} onChange={(n) => setQuantity(line.key, n)} />
            </View>
          ) : (
            <T variant="caption" style={{ flex: 1 }}>{t('teamPieces', { n: linePieces(item), lines: item.lines.length })}</T>
          )}
          <Button compact kind="ghost" label={t('remove')} onPress={() => remove(line.key)} testID={`cart-remove-${index}`} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  pic: { width: 96, backgroundColor: '#eef0f4', borderRadius: radius.md, padding: space(1), alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: space(2) },
});
