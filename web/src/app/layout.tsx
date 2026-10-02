import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { SessionProvider } from '@/components/providers/session';
import { ShopSync } from '@/components/providers/shop';
import { I18nProvider } from '@/i18n/provider';
import { serverT } from '@/i18n/server';
import { loadCatalogue, loadDemoPayments } from '@/lib/server/catalogue';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'Unsattai · Design your own team kit', template: '%s · Unsattai' },
  description: 'Design custom jerseys, V-necks and shorts in English, Hindi, Telugu or Tamil. Print-ready checks, live team pricing and delivery dates.',
  applicationName: 'Unsattai',
  openGraph: { type: 'website', siteName: 'Unsattai', title: 'Unsattai · Design your own team kit',
    description: 'Custom sportswear designed by you: jerseys, V-necks and shorts for players and whole teams.' },
  twitter: { card: 'summary' },
};

export const viewport: Viewport = { themeColor: '#13225a', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { t, lang } = await serverT();
  const [catalogue, demoPayments] = await Promise.all([loadCatalogue(), loadDemoPayments()]);
  return (
    <html lang={lang}>
      <body>
        <I18nProvider initial={lang}>
          <SessionProvider>
            <ShopSync />
            <Header />
            <main id="main" tabIndex={-1}>{children}</main>
            <Footer t={t} catalogue={catalogue} demoPayments={demoPayments} />
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
