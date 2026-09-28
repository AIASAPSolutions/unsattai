import type { Metadata } from 'next';
import { DesignsClient } from './DesignsClient';

export const metadata: Metadata = { title: 'Saved designs' };

export default function Page() {
  return <DesignsClient />;
}
