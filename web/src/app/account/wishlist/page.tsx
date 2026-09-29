import type { Metadata } from 'next';
import { WishlistClient } from './WishlistClient';

export const metadata: Metadata = { title: 'Wishlist' };

export default function Page() {
  return <WishlistClient />;
}
