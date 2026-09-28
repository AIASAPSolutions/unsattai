import type { Metadata } from 'next';
import { AccountOrderClient } from './AccountOrderClient';

export const metadata: Metadata = { title: 'Order' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountOrderClient id={id} />;
}
