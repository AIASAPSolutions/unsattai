import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Hydrated } from '@/components/design/Hydrated';
import { CheckoutClient } from './CheckoutClient';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default function Page() {
  return <Hydrated><Suspense><CheckoutClient /></Suspense></Hydrated>;
}
