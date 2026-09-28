import type { Metadata } from 'next';
import { Button, Empty } from '@/components/ui';
import { serverT } from '@/i18n/server';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false } };

export default async function NotFound() {
  const { t } = await serverT();
  return (
    <div className="container page">
      <Empty icon="?" title={t('notFoundTitle')} testId="not-found">
        <p>{t('notFoundText')}</p>
        <Button href="/">{t('goHome')}</Button>
      </Empty>
    </div>
  );
}
