import { router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, useWindowDimensions, View } from 'react-native';
import { ProductCard } from '../components/shop/ProductCard';
import { errorMessage, useT } from '../i18n';
import { useAuth } from '../state/auth';
import { useWishlist } from '../state/wishlist';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Empty, Loading } from '../ui/States';
import { space } from '../ui/theme';

export default function WishlistScreen() {
  const t = useT();
  const { width } = useWindowDimensions();
  const ids = useWishlist((s) => s.ids);
  const products = useWishlist((s) => s.products);
  const loading = useWishlist((s) => s.loading);
  const error = useWishlist((s) => s.error);
  const load = useWishlist((s) => s.load);
  const signedIn = useAuth((s) => s.status === 'signedIn');

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const items = ids.map((id) => products[id]).filter(Boolean);
  const cols = width >= 700 ? 3 : 2;
  const cardW = Math.floor((Math.min(width, 1100) - space(8) - space(3) * (cols - 1)) / cols);
  return (
    <FlatList
      testID="screen-wishlist"
      key={cols}
      data={items}
      numColumns={cols}
      keyExtractor={(p) => p.id}
      columnWrapperStyle={{ gap: space(3) }}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      ListHeaderComponent={
        <View>
          {!signedIn ? <Banner tone="info" text={t('wishlistGuest')} action={t('signIn')} onAction={() => router.push('/sign-in')} /> : null}
          {error ? <Banner tone="warn" text={errorMessage(t, error)} action={t('retry')} onAction={() => load()} /> : null}
        </View>
      }
      renderItem={({ item, index }) => <ProductCard p={item} index={index} width={cardW} />}
      ListEmptyComponent={loading ? <Loading label={t('loading')} /> : (
        <View testID="wishlist-empty">
          <Empty label={t('wishlistEmpty')} />
          <Button kind="secondary" label={t('browseShop')} onPress={() => router.navigate('/shop')} />
        </View>
      )}
    />
  );
}
