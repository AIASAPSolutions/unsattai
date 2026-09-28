'use client';
import { useEffect } from 'react';
import { ErrorState } from '@/components/ui';
import { useT } from '@/i18n/provider';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container page">
      <ErrorState message={t('somethingWrong')} retryLabel={t('retry')} onRetry={reset} testId="error-boundary" />
    </div>
  );
}
