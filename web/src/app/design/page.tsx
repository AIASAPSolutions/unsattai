import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Hydrated } from '@/components/design/Hydrated';
import { BriefClient } from './BriefClient';

export const metadata: Metadata = {
  title: 'Describe your design',
  description: 'Describe your jersey, V-neck or shorts in English, Hindi, Telugu or Tamil. Unsattai reads it back to you and creates four designs.',
  alternates: { canonical: '/design' },
};

export default function Page() {
  return <Suspense><Hydrated><BriefClient /></Hydrated></Suspense>;
}
