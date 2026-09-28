import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TrackClient } from './TrackClient';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Check the status and delivery date of your UrJersey order with your order number and phone number.',
  alternates: { canonical: '/track' },
};

export default function Page() {
  return <Suspense><TrackClient /></Suspense>;
}
