'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { OtpSignIn } from '@/components/account/OtpSignIn';
import { useSession } from '@/components/providers/session';
import { Button, Card, Loading, cx } from '@/components/ui';
import { useT } from '@/i18n/provider';
import s from './account.module.css';

const NAV = [
  { href: '/account', key: 'accOrders', exact: true },
  { href: '/account/designs', key: 'accDesigns' },
  { href: '/account/teams', key: 'accTeams' },
  { href: '/account/support', key: 'accSupport' },
  { href: '/account/profile', key: 'accProfile' },
] as const;

/** Account pages need a signed-in customer; signing in happens in place, without leaving the page. */
export function AccountShell({ children }: { children: ReactNode }) {
  const t = useT();
  const path = usePathname() ?? '/account';
  const router = useRouter();
  const { me, loading, signOut } = useSession();

  if (loading) return <Loading label={t('loading')} />;
  if (!me) {
    return (
      <div className="container page" style={{ maxWidth: 480 }} data-testid="account-signin">
        <h1>{t('signInTitle')}</h1>
        <p className="muted">{t('accSignInText')}</p>
        <Card><OtpSignIn testId="otp" /></Card>
      </div>
    );
  }

  const active = (n: (typeof NAV)[number]) =>
    'exact' in n && n.exact ? path === n.href || path.startsWith('/account/orders') : path.startsWith(n.href);

  return (
    <div className="container page">
      <div className={s.top}>
        <div>
          <h1 style={{ margin: 0 }}>{t('navAccount')}</h1>
          <p className="muted" style={{ margin: 0 }} data-testid="account-who">{me.name || me.phone} · <span className="tnum">{me.phone}</span></p>
        </div>
        <Button kind="ghost" onClick={async () => { await signOut(); router.push('/'); }} testId="sign-out">{t('navSignOut')}</Button>
      </div>
      <div className={s.layout}>
        <nav className={s.nav} aria-label={t('navAccount')}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx(s.navLink, active(n) && s.navOn)} aria-current={active(n) ? 'page' : undefined}
              data-testid={`acc-nav-${n.key}`}>
              {t(n.key)}
            </Link>
          ))}
        </nav>
        <div className={s.main}>{children}</div>
      </div>
    </div>
  );
}
