import type { Metadata } from 'next';
import { CartClient } from './CartClient';

export const metadata: Metadata = { title: 'Cart', robots: { index: false } };

export default function Page() {
  return <CartClient />;
}
