import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Product } from '../../api/types';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatMoney } from '../../lib/money';
import { useWishlist } from '../../state/wishlist';
import { T } from '../../ui/Text';
import { colors, radius, shadow, space } from '../../ui/theme';
import { ratingText } from './DeliveryBox';
import { RemoteSvg } from './RemoteSvg';

export function WishButton({ product, testID, onError }: { product: Product; testID?: string; onError?: (msg: string) => void }) {
  const t = useT();
  const on = useWishlist((s) => s.ids.includes(product.id));
  const toggle = useWishlist((s) => s.toggle);
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }}
      accessibilityLabel={on ? t('removeFromWishlist') : t('addToWishlist')} hitSlop={8} style={styles.heart}
      onPress={() => toggle(product).catch((e) => onError?.(errorMessage(t, e)))}>
      <T variant="heading" color={on ? colors.brand : colors.muted} style={{ fontSize: 22, lineHeight: 26 }}>{on ? '♥' : '♡'}</T>
    </Pressable>
  );
}

/** A product tile in the shop grid and the wishlist. */
export function ProductCard({ p, index, width }: { p: Product; index: number; width: number }) {
  const t = useT();
  const open = () => router.push({ pathname: '/product/[slug]', params: { slug: p.slug } });
  return (
    <View style={[styles.card, shadow, { width }]}>
      <Pressable testID={`product-${index}`} onPress={open} accessibilityRole="button"
        accessibilityLabel={`${p.title}, ${p.price_from !== null ? t('priceFrom', { price: formatMoney(p.price_from, p.currency) }) : ''}`}>
        <View style={styles.pic}>
          <RemoteSvg path={p.image_url} label={p.title} />
        </View>
        <T variant="label" numberOfLines={2} style={{ marginTop: space(2) }}>{p.title}</T>
        <T variant="caption" numberOfLines={1}>{t(`garment_${p.garment}`)} · {tMaybe(t, `sport_${p.sport}`, p.sport)}</T>
        {(p.colourways?.length ?? 0) > 1 ? (
          <View style={styles.dots} accessible accessibilityLabel={`${t('colourway')}: ${p.colourways!.map((c) => c.name).join(', ')}`}>
            {p.colourways!.slice(0, 6).map((c) => (
              <View key={c.id} style={[styles.dot, { backgroundColor: c.swatch?.[0] ?? c.palette?.primary ?? colors.line }]} />
            ))}
          </View>
        ) : null}
        {p.rating.average !== null ? <T variant="caption" color={colors.warn}>{ratingText(p.rating)}</T> : null}
        <T variant="label" style={{ marginTop: space(1) }}>
          {p.price_from !== null ? t('priceFrom', { price: formatMoney(p.price_from, p.currency) }) : t('unavailable')}
        </T>
      </Pressable>
      <View style={styles.heartPos}><WishButton product={p} testID={`wish-${index}`} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space(3), marginBottom: space(3) },
  pic: { backgroundColor: '#eef0f4', borderRadius: radius.md, padding: space(1) },
  dots: { flexDirection: 'row', gap: 4, marginTop: space(1) },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: colors.line },
  heartPos: { position: 'absolute', top: space(1), right: space(1) },
  heart: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
