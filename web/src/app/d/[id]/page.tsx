import type { Metadata } from 'next';
import { SharedDesignClient } from './SharedDesignClient';

export const metadata: Metadata = {
  title: 'Shared design',
  description: 'A custom kit designed on UrJersey. Open a copy in the studio and make it your own.',
  robots: { index: false },
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SharedDesignClient id={id} />;
}
