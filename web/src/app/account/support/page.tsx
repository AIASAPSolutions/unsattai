import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SupportClient } from './SupportClient';

export const metadata: Metadata = { title: 'Support' };

export default function Page() {
  return <Suspense><SupportClient /></Suspense>;
}
