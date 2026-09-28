import type { Metadata } from 'next';
import { QuoteClient } from './QuoteClient';

export const metadata: Metadata = { title: 'Your quote', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QuoteClient token={token} />;
}
