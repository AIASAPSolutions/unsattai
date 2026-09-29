import type { Metadata } from 'next';
import { CheckoutPayClient } from './CheckoutPayClient';

export const metadata: Metadata = { title: 'Payment', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutPayClient id={id} />;
}
