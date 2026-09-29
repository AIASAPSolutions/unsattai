import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { ConfigureClient } from './ConfigureClient';

export const metadata: Metadata = { title: 'Sizes and options', robots: { index: false } };

export default function Page() {
  return <Hydrated><ConfigureClient /></Hydrated>;
}
