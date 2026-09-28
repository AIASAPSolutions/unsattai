import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AccountShell } from './AccountShell';

export const metadata: Metadata = { title: { default: 'My account', template: '%s · My account · UrJersey' }, robots: { index: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
