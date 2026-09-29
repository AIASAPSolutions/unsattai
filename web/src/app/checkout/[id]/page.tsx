import type { Metadata } from 'next';
import { CheckoutDoneClient } from './CheckoutDoneClient';

export const metadata: Metadata = { title: 'Order placed', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CheckoutDoneClient id={id} />;
}
