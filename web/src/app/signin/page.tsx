import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInClient } from './SignInClient';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default function Page() {
  return <Suspense><SignInClient /></Suspense>;
}
