'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { productImage } from '@/components/providers/shop';
import { useSession } from '@/components/providers/session';
import { ColourwayDots } from '@/components/shop/Sizing';
import { RatingStars, cx } from '@/components/ui';
import { HeartIcon } from '@/components/ui/icons';
import { errorMessage, tMaybe } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import type { Product } from '@/lib/api/types';
import { formatMoney } from '@/lib/price';
import { useShop, wishlist } from '@/lib/shopStore';
import { DeliveryLine } from './Delivery';
import s from './market.module.css';

/** Wishlist heart. Guests are sent to sign in first. */
export function WishHeart({ product, className, testId }: { product: Pick<Product, 'id' | 'title'>; className?: string; testId?: string }) {
  const { t } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const on = useShop((st) => !!st.wishlist?.includes(product.id));
  const [msg, setMsg] = useState<string | null>(null);
  const click = async () => {
    if (!me) {
      router.push(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    try {
      setMsg(null);
      await wishlist.toggle(product.id);
    } catch (e) {
      setMsg(errorMessage(t, e));
    }
  };
  return (
    <button type="button" className={cx(s.heart, on && s.heartOn, className)} aria-pressed={on}
      aria-label={on ? t('wishlistRemove', { title: product.title }) : t('wishlistAdd', { title: product.title })}
      title={msg ?? undefined} onClick={() => void click()} data-testid={testId ?? `wish-${product.id}`}>
      <HeartIcon size={20} filled={on} />
    </button>
  );
}

export function ProductCard({ product, priority }: { product: Product; priority?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <article className={s.card} data-testid={`product-${product.slug}`}>
      <Link href={`/shop/${encodeURIComponent(product.slug)}`} className={s.cardLink} data-testid={`product-link-${product.slug}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={productImage(product)} alt={product.title} className={s.cardImg} loading={priority ? 'eager' : 'lazy'} width={300} height={300} />
        <div className={s.cardBody}>
          <span className={s.cardTitle}>{product.title}</span>
          <span className={s.cardMeta}>{t(`garment_${product.garment}` as 'garment_jersey')} · {tMaybe(t, `sport_${product.sport}`, product.sport)}</span>
          <ColourwayDots colourways={product.colourways} testId={`colourways-${product.slug}`} />
          {product.rating.count ? (
            <RatingStars value={product.rating.average} count={product.rating.count}
              label={t('ratingOf', { avg: (product.rating.average ?? 0).toFixed(1), n: product.rating.count })} />
          ) : null}
          <span className={s.price}>
            {product.price_from !== null ? <><span className={s.priceFrom}>{t('fromLabel')} </span>{formatMoney(product.price_from, product.currency, lang)}</> : t('unavailable')}
          </span>
        </div>
      </Link>
      <div style={{ padding: '0 12px 12px' }}>
        <DeliveryLine garment={product.garment} fabric={product.fabric} compact testId={`delivery-${product.slug}`} />
      </div>
      {product.featured ? <span className={s.featured}>{t('featured')}</span> : null}
      <WishHeart product={product} />
    </article>
  );
}
