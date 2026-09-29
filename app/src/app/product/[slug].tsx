import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api, queryString } from '../../api/endpoints';
import type { Collar, Colourway, Fit, ProductDetail, Review, Size, Sleeves } from '../../api/types';
import { GarmentOptionsPicker } from '../../components/GarmentOptionsPicker';
import { FitSizePicker, Qty } from '../../components/OrderInputs';
import { DeliveryBox, ratingText } from '../../components/shop/DeliveryBox';
import { WishButton } from '../../components/shop/ProductCard';
import { RemoteSvg } from '../../components/shop/RemoteSvg';
import { chosenOffer } from '../../features/pincode/pincode';
import { useDeliveryPincode, useServiceability } from '../../features/pincode/useServiceability';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { formatDay, formatMoney } from '../../lib/money';
import { collarOf, hasCollar, hasSleeves, sleevesOf } from '../../lib/sizing';
import { useCatalogue } from '../../state/shopInfo';
import { useCart } from '../../state/cart';
import { useFlow } from '../../state/flow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Screen } from '../../ui/Screen';
import { ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { useVoiceGuide } from '../../voice/useVoiceGuide';

export default function ProductScreen() {
  const t = useT();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { speak } = useVoiceGuide();
  const addToCart = useCart((s) => s.add);
  const openProduct = useFlow((s) => s.openProduct);
  const pincode = useDeliveryPincode();
  const [p, setP] = useState<ProductDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [fabric, setFabric] = useState('standard');
  const [size, setSize] = useState<Size>('M');
  const [fit, setFit] = useState<Fit>('men');
  const [colourway, setColourway] = useState('original');
  const [sleeves, setSleeves] = useState<Sleeves>('short');
  const [collar, setCollar] = useState<Collar>('crew');
  const catalogue = useCatalogue();
  const [qty, setQty] = useState(1);
  const [sellerId, setSellerId] = useState('');
  const [notice, setNotice] = useState<{ tone: 'pass' | 'fail' | 'info'; text: string } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPages, setReviewPages] = useState(1);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await api.product(slug);
      setP(d);
      setFabric(d.fabric);
      setSleeves(sleevesOf(d.spec));
      setCollar(collarOf(d.spec));
      setReviews(d.reviews);
      setReviewPages(Math.max(1, Math.ceil(d.review_summary.count / 20)));
      speak(`${d.title}. ${d.description}`);
    } catch (e) {
      setLoadError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const svc = useServiceability(pincode, { garment: p?.garment ?? 'jersey', fabric, pieces: qty });
  const offer = chosenOffer(svc.data, sellerId);
  // A seller picked for another PIN code may not serve this one.
  useEffect(() => {
    if (sellerId && svc.data && !svc.data.offers.some((o) => o.seller_id === sellerId)) setSellerId('');
  }, [svc.data, sellerId]);

  if (!p) {
    return (
      <Screen testID="screen-product">
        {loadError ? <ErrorState message={errorMessage(t, loadError)} retryLabel={t('retry')} onRetry={load} /> : <Loading label={t('loading')} />}
      </Screen>
    );
  }

  const cantDeliver = !!pincode && !!svc.data && !svc.data.serviceable;
  const colourways: Colourway[] = p.colourways ?? [];
  const cw = colourways.find((c) => c.id === colourway) ?? null;
  const choice = {
    ...(colourway !== 'original' && cw ? { colourway } : {}),
    ...(hasSleeves(p.garment) ? { sleeves } : {}),
    ...(hasCollar(p.garment) ? { collar } : {}),
  };
  // The server draws the product in the chosen colourway, sleeves and collar.
  const picture = `${p.image_url}${queryString(choice)}`;
  const line = () => ({
    item: {
      product_id: p.id, fabric, lines: [{ player_name: '', number: '', fit, size, quantity: qty }], seller_id: sellerId || undefined, ...choice,
    },
    title: p.title, image: picture, slug: p.slug, garment: p.garment, colourwayName: cw && colourway !== 'original' ? cw.name : undefined,
  });

  const add = (then?: 'checkout') => {
    const res = addToCart(line());
    if (res.outcome === 'full') {
      setNotice({ tone: 'fail', text: t('cartFull') });
      return;
    }
    if (then === 'checkout' && res.key) {
      router.push({ pathname: '/checkout', params: { only: res.key } });
      return;
    }
    const text = t(res.outcome === 'merged' ? 'cartUpdated' : 'addedToCart', { title: p.title });
    setNotice({ tone: 'pass', text });
    speak(text);
  };

  const customise = () => {
    // Start the studio from what the customer picked here.
    const spec = { ...p.spec, ...(cw?.palette ? { palette: { ...p.spec.palette, ...cw.palette } } : {}),
      ...(hasSleeves(p.garment) ? { sleeves } : {}), ...(hasCollar(p.garment) ? { collar } : {}) };
    openProduct({ id: p.id, slug: p.slug, title: p.title, spec });
    router.push('/studio');
  };

  const moreReviews = async () => {
    const next = reviewPage + 1;
    const res = await api.productReviews(p.slug, next).catch(() => null);
    if (!res) return;
    setReviews((cur) => [...cur, ...res.items.filter((r) => !cur.some((c) => c.id === r.id))]);
    setReviewPage(next);
    setReviewPages(res.pages);
  };

  const price = offer?.unit_price ?? p.price_from;
  const summary = p.review_summary;
  return (
    <Screen testID="screen-product" footer={
      <View>
        {notice ? <Banner tone={notice.tone} text={notice.text} testID="product-notice"
          action={notice.tone === 'pass' ? t('goToCart') : undefined} onAction={() => router.navigate('/cart')} /> : null}
        <View style={styles.actions}>
          <Button testID="add-to-cart" kind="secondary" label={t('addToCart')} onPress={() => add()} style={{ flex: 1 }}
            disabled={cantDeliver} />
          <Button testID="buy-now" label={t('buyNow')} onPress={() => add('checkout')} style={{ flex: 1 }} disabled={cantDeliver} />
        </View>
      </View>
    }>
      <Stack.Screen options={{ title: p.title }} />
      <View style={styles.pic}>
        <RemoteSvg path={picture} label={`${p.title}, ${t(`garment_${p.garment}`)}${cw && colourway !== 'original' ? `, ${cw.name}` : ''}`} />
        <View style={styles.heart}><WishButton product={p} testID="product-wish" onError={(text) => setNotice({ tone: 'fail', text })} /></View>
      </View>
      <T variant="title" accessibilityRole="header" testID="product-title">{p.title}</T>
      <T variant="caption">{t(`garment_${p.garment}`)} · {tMaybe(t, `sport_${p.sport}`, p.sport)} · {p.style_name}</T>
      {summary.average !== null ? (
        <T variant="label" color={colors.warn} style={{ marginTop: space(1) }} testID="product-rating">
          {ratingText(summary)} · {t('ratingsCount', { n: summary.count })}
        </T>
      ) : <T variant="caption" style={{ marginTop: space(1) }}>{t('noReviewsYet')}</T>}
      {price !== null ? (
        <T variant="title" style={{ marginTop: space(2) }} testID="product-price">
          {formatMoney(price, p.currency)} <T variant="caption">{t('each')}</T>
        </T>
      ) : null}
      <T variant="caption" style={{ marginBottom: space(4) }}>{t('priceNote')}</T>

      <DeliveryBox pincode={pincode} data={svc.data} loading={svc.loading} error={svc.error} onRetry={svc.retry}
        sellerId={sellerId} onSeller={(id) => { setSellerId(id); setNotice({ tone: 'info', text: t('sellerChosen') }); }}
        currency={p.currency} garment={p.garment} />

      <Card title={t('chooseOptions')}>
        {p.fabrics.length > 1 ? (
          <View style={{ marginBottom: space(3) }}>
            <T variant="label" style={{ marginBottom: space(2) }}>{t('fabric')}</T>
            {p.fabrics.map((f) => (
              <Pressable key={f.id} testID={`product-fabric-${f.id}`} onPress={() => setFabric(f.id)} accessibilityRole="radio"
                accessibilityState={{ checked: fabric === f.id }} style={[styles.option, fabric === f.id && styles.optionOn]}>
                <T variant="label" style={{ flex: 1 }}>{f.name}</T>
                <T variant="caption">{f.surcharge ? `+${formatMoney(f.surcharge, p.currency)} ${t('each')}` : t('included')}</T>
              </Pressable>
            ))}
          </View>
        ) : null}
        {colourways.length > 1 ? (
          <View style={{ marginBottom: space(3) }} testID="colourways">
            <T variant="label" style={{ marginBottom: space(2) }}>{t('colourway')}: {cw?.name ?? ''}</T>
            <View style={styles.swatches} accessibilityRole="radiogroup">
              {colourways.map((c) => {
                const [a, b] = c.palette ? [c.palette.primary, c.palette.secondary] : c.swatch ?? ['#cccccc', '#999999'];
                const on = c.id === colourway;
                return (
                  <Pressable key={c.id} testID={`colourway-${c.id}`} onPress={() => setColourway(c.id)} accessibilityRole="radio"
                    accessibilityLabel={c.name} accessibilityState={{ checked: on }} style={[styles.swatch, on && styles.swatchOn]}>
                    <View style={[styles.half, { backgroundColor: a }]} />
                    <View style={[styles.half, { backgroundColor: b }]} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        {hasSleeves(p.garment) ? (
          <View style={{ marginBottom: space(2) }}>
            <GarmentOptionsPicker garment={p.garment} sleeves={sleeves} collar={collar} onSleeves={setSleeves} onCollar={setCollar}
              prices={catalogue?.options} currency={catalogue?.currency ?? p.currency} testID="product-opt" />
          </View>
        ) : null}
        <FitSizePicker testID="product-size" fit={fit} size={size} garment={p.garment} sleeves={sleeves}
          onChange={(v) => { setFit(v.fit); setSize(v.size); }} />
        <Qty testID="product-qty" value={qty} onChange={setQty} />
        <Button testID="customise" kind="ghost" label={`✎ ${t('customise')}`} onPress={customise} style={{ alignSelf: 'flex-start' }}
          accessibilityHint={t('customiseHint')} />
        <T variant="caption">{t('customiseHint')}</T>
      </Card>

      <Card title={t('aboutProduct')}>
        <T variant="body">{p.description}</T>
      </Card>

      <Card title={t('reviewsTitle')} testID="reviews">
        {summary.count ? (
          <View style={{ marginBottom: space(3) }}>
            {[5, 4, 3, 2, 1].map((n) => {
              const c = summary.distribution[String(n)] ?? 0;
              return (
                <View key={n} style={styles.bar} accessible accessibilityLabel={t('starsCount', { stars: n, n: c })}>
                  <T variant="caption" style={{ width: 28 }}>{n}★</T>
                  <View style={styles.track}><View style={[styles.fill, { width: `${(c / summary.count) * 100}%` }]} /></View>
                  <T variant="caption" style={{ width: 28, textAlign: 'right' }}>{c}</T>
                </View>
              );
            })}
          </View>
        ) : <T variant="caption">{t('noReviewsYet')}</T>}
        {reviews.map((r) => (
          <View key={r.id} style={styles.review} testID={`review-${r.id}`}>
            <T variant="label" color={colors.warn}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}  <T variant="label">{r.title}</T></T>
            {r.body ? <T variant="body">{r.body}</T> : null}
            <T variant="caption">
              {r.customer_name} · {formatDay(r.created_at)}{r.verified_purchase ? ` · ✓ ${t('verifiedPurchase')}` : ''}{r.seller_name ? ` · ${t('soldBy', { seller: r.seller_name })}` : ''}
            </T>
          </View>
        ))}
        {reviewPage < reviewPages ? <Button kind="ghost" label={t('moreReviews')} onPress={moreReviews} /> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pic: { backgroundColor: '#eef0f4', borderRadius: radius.lg, padding: space(2), marginBottom: space(3) },
  heart: { position: 'absolute', top: space(1), right: space(1) },
  actions: { flexDirection: 'row', gap: space(3) },
  option: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: space(3), marginBottom: space(2), minHeight: 48,
  },
  optionOn: { borderColor: colors.brand, borderWidth: 2, backgroundColor: colors.brandSoft },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  swatch: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: colors.line },
  swatchOn: { borderWidth: 3, borderColor: colors.navy },
  half: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.line, marginHorizontal: space(2), overflow: 'hidden' },
  fill: { height: 8, backgroundColor: '#f5a524' },
  review: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingVertical: space(3) },
});
