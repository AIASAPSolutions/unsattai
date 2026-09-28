import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { CheckoutClient } from './CheckoutClient';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default function Page() {
  return <Hydrated><CheckoutClient /></Hydrated>;
}
