import type { Metadata } from 'next';
import { OrdersClient } from './OrdersClient';

export const metadata: Metadata = { title: 'Orders' };

export default function Page() {
  return <OrdersClient />;
}
