'use client';
import { useEffect, useState } from 'react';
import { ProductCard } from '@/components/market/ProductCard';
import { Button, Empty, ErrorState, Skeleton } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Wishlist } from '@/lib/api/types';
import { useShop, wishlist } from '@/lib/shopStore';
import s from '@/components/market/market.module.css';

export function WishlistClient() {
  const { t } = useI18n();
  const ids = useShop((st) => st.wishlist);
  const [data, setData] = useState<Wishlist | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    api.wishlist().then((w) => { if (live) { setData(w); wishlist.set(w.product_ids); } }).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [nonce]);
  // Hearts toggled on this page take the product out straight away.
  const items = data ? data.items.filter((p) => !ids || ids.includes(p.id)) : null;
  return (
    <section aria-labelledby="wish-h" data-testid="account-wishlist">
      <h2 id="wish-h">{t('wishlistTitle')}</h2>
      {error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />
        : !items ? <div className={s.grid}>{[0, 1, 2].map((i) => <Skeleton key={i} height={280} />)}</div>
          : !items.length ? (
            <Empty icon="♡" title={t('wishlistEmpty')} testId="wishlist-empty">
              <p>{t('wishlistEmptyText')}</p>
              <Button href="/shop">{t('navShop')}</Button>
            </Empty>
          ) : <div className={s.grid} data-testid="wishlist-grid">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
    </section>
  );
}
