import type { Metadata } from 'next';
import { TeamEntryClient } from './TeamEntryClient';

export const metadata: Metadata = {
  title: 'Add yourself to the team list',
  description: 'Add your name, number and size to your team’s kit order.',
  robots: { index: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TeamEntryClient token={token} />;
}
