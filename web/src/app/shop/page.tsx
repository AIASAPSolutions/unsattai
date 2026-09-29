import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui';
import { ShopClient } from './ShopClient';

export const metadata: Metadata = {
  title: 'Shop ready-made designs',
  description: 'Ready-made jerseys, V-necks and shorts for football, cricket and more. Filter by sport, garment, colour and price, check delivery to your PIN code, and customise any design.',
  alternates: { canonical: '/shop' },
};

export default function Page() {
  return <Suspense fallback={<Loading label="…" />}><ShopClient /></Suspense>;
}
