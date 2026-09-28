import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { DesignsClient } from './DesignsClient';

export const metadata: Metadata = { title: 'Your designs', robots: { index: false } };

export default function Page() {
  return <Hydrated><DesignsClient /></Hydrated>;
}
