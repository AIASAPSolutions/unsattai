import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ProductDetail } from '@/lib/api/types';
import { serverApi } from '@/lib/server/api';
import { ProductClient } from './ProductClient';

async function load(slug: string): Promise<ProductDetail | null | 'error'> {
  try {
    return await serverApi<ProductDetail>(`shop/products/${encodeURIComponent(slug)}`, { revalidate: 60 });
  } catch (e) {
    return /answered 404/.test(String(e)) ? null : 'error';
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  if (!p || p === 'error') return { title: 'Product' };
  return {
    title: p.title,
    description: p.description.slice(0, 160),
    alternates: { canonical: `/shop/${p.slug}` },
    openGraph: { title: p.title, description: p.description.slice(0, 160) },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await load(slug);
  if (p === null) notFound();
  return <ProductClient slug={slug} initial={p === 'error' ? null : p} />;
}
