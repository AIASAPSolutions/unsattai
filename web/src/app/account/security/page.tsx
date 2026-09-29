import type { Metadata } from 'next';
import { SecurityClient } from './SecurityClient';

export const metadata: Metadata = { title: 'Login and security' };

export default function Page() {
  return <SecurityClient />;
}
