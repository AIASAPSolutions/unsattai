import type { Metadata } from 'next';
import { TeamDashboardClient } from './TeamDashboardClient';

export const metadata: Metadata = { title: 'Team list' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamDashboardClient id={id} />;
}
