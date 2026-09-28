import type { Metadata } from 'next';
import { TeamsClient } from './TeamsClient';

export const metadata: Metadata = { title: 'Team lists' };

export default function Page() {
  return <TeamsClient />;
}
