import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { StudioClient } from './StudioClient';

export const metadata: Metadata = { title: 'Design studio', robots: { index: false } };

export default function Page() {
  return <Hydrated><StudioClient /></Hydrated>;
}
