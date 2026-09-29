'use client';
import type { Product } from '@/lib/api/types';
import { ProductCard } from './ProductCard';
import s from './market.module.css';

/** A row of product cards (home page). Delivery dates follow the Deliver-to PIN code. */
export function ProductStrip({ products, testId }: { products: Product[]; testId?: string }) {
  return (
    <div className={s.grid} data-testid={testId}>
      {products.map((p, i) => <ProductCard key={p.id} product={p} priority={i < 2} />)}
    </div>
  );
}
