import type { Metadata } from 'next';
import { Hydrated } from '@/components/design/Hydrated';
import { ConfirmClient } from './ConfirmClient';

export const metadata: Metadata = { title: 'Is this right?', robots: { index: false } };

export default function Page() {
  return <Hydrated><ConfirmClient /></Hydrated>;
}
