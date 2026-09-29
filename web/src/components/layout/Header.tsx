'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CartLink, NotificationBell, SearchBox } from '@/components/market/HeaderBits';
import { PincodeChip } from '@/components/market/PincodeChip';
import { useSession } from '@/components/providers/session';
import { Button, cx } from '@/components/ui';
import { UserIcon } from '@/components/ui/icons';
import { isLanguage, LANGUAGE_OPTIONS } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import s from './layout.module.css';

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { me, loading } = useSession();
  const path = usePathname();
  const router = useRouter();
  // The mobile menu belongs to the page it was opened on: navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === path;
  const setOpen = (f: (o: boolean) => boolean) => setOpenOn(f(open) ? path : null);

  const links = [
    { href: '/shop', label: t('navShop') },
    { href: '/design', label: t('navDesign') },
    { href: '/teams', label: t('navTeams') },
    { href: '/track', label: t('navTrack') },
    { href: '/enquiry', label: t('navBulk') },
  ];

  return (
    <header className={s.header}>
      <a href="#main" className="skip-link">{t('skipToContent')}</a>
      <div className={cx('container', s.bar)}>
        <Link href="/" className={s.logo} aria-label="UrJersey home">
          <span className={s.logoMark} aria-hidden>UJ</span>
          <span className={s.logoWord}>UrJersey</span>
        </Link>
        <nav className={cx(s.nav, open && s.navOpen)} aria-label="Main" id="main-nav">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={cx(s.navLink, path?.startsWith(l.href) && s.navLinkOn)}
              aria-current={path?.startsWith(l.href) ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
          {me ? <Link href="/account/wishlist" className={cx(s.navLink, path?.startsWith('/account/wishlist') && s.navLinkOn)}>{t('wishlistTitle')}</Link> : null}
        </nav>
        <div className={s.right}>
          <label className="visually-hidden" htmlFor="lang-select">Language</label>
          <select id="lang-select" className={s.lang} value={lang} data-testid="lang-select"
            onChange={(e) => {
              if (isLanguage(e.target.value)) {
                setLang(e.target.value);
                router.refresh();
              }
            }}>
            {LANGUAGE_OPTIONS.map((o) => <option key={o.code} value={o.code} lang={o.code}>{o.label}</option>)}
          </select>
          <NotificationBell />
          {loading ? <span className={s.accountSlot} /> : me ? (
            <Link href="/account" className={s.account} data-testid="nav-account" aria-label={t('navAccount')}>
              <UserIcon size={20} /><span className={s.accountText}>{t('navAccount')}</span>
            </Link>
          ) : (
            <Link href={`/signin?next=${encodeURIComponent(path ?? '/')}`} className={s.account} data-testid="nav-signin" aria-label={t('navSignIn')}>
              <UserIcon size={20} /><span className={s.accountText}>{t('navSignIn')}</span>
            </Link>
          )}
          <CartLink />
          <Button kind="ghost" size="sm" className={s.menuBtn} aria-expanded={open} aria-controls="main-nav"
            onClick={() => setOpen((o) => !o)}>☰ <span className="visually-hidden">{t('navMenu')}</span></Button>
        </div>
      </div>
      <div className={s.subbar}>
        <div className={cx('container', s.subInner)}>
          <PincodeChip />
          <div className={s.searchSlot}>
            <Suspense fallback={null}><SearchBox /></Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}
