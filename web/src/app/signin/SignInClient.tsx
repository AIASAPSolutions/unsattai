'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { OtpSignIn } from '@/components/account/OtpSignIn';
import { useSession } from '@/components/providers/session';
import { Card, Loading } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { safeNext } from '@/lib/nav';

export function SignInClient() {
  const t = useT();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const { me, loading } = useSession();

  useEffect(() => {
    if (me) router.replace(next);
  }, [me, next, router]);

  if (loading || me) return <Loading label={t('loading')} />;
  return (
    <div className="container page" style={{ maxWidth: 480 }} data-testid="screen-signin">
      <h1>{t('signInTitle')}</h1>
      <p className="muted">{t('signInText')}</p>
      <Card>
        <OtpSignIn testId="otp" />
      </Card>
      <p className="small muted" style={{ marginTop: 12 }}>{t('guestOrders')}</p>
    </div>
  );
}
