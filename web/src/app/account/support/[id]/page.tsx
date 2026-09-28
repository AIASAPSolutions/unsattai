import type { Metadata } from 'next';
import { TicketClient } from './TicketClient';

export const metadata: Metadata = { title: 'Support ticket' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketClient id={id} />;
}
