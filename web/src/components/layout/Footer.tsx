import Link from 'next/link';
import type { Catalogue } from '@/lib/api/types';
import type { T } from '@/i18n';
import s from './layout.module.css';

export function Footer({ t, catalogue, demoPayments = true }: { t: T; catalogue: Catalogue | null; demoPayments?: boolean }) {
  const co = catalogue?.company;
  const name = co?.name || 'Unsattai';
  return (
    <footer className={s.footer}>
      <div className="container">
        <div className={s.footGrid}>
          <div>
            <h2>{name}</h2>
            <p>{t('footerTagline')}</p>
            {demoPayments ? <p>{t('footerDemo')}</p> : null}
          </div>
          <div>
            <h2>{t('footerLinks')}</h2>
            <ul>
              <li><Link href="/design">{t('navDesign')}</Link></li>
              <li><Link href="/teams">{t('navTeams')}</Link></li>
              <li><Link href="/track">{t('navTrack')}</Link></li>
              <li><Link href="/size-guide" data-testid="footer-size-guide">{t('sizeGuide')}</Link></li>
              <li><Link href="/enquiry">{t('navBulk')}</Link></li>
              <li><Link href="/account">{t('navAccount')}</Link></li>
            </ul>
          </div>
          <div data-testid="footer-contact">
            <h2>{t('footerContact')}</h2>
            <ul>
              {co?.phone ? <li><a href={`tel:${co.phone.replace(/[^\d+]/g, '')}`}>{co.phone}</a></li> : null}
              {co?.email ? <li><a href={`mailto:${co.email}`}>{co.email}</a></li> : null}
              {co?.support_hours ? <li>{t('footerHours', { hours: co.support_hours })}</li> : null}
              <li><Link href="/enquiry">{t('navBulk')}</Link></li>
            </ul>
          </div>
        </div>
        <div className={s.footBottom}>
          <span>{t('footerRights', { year: new Date().getFullYear(), name })}</span>
          <span>English · हिन्दी · తెలుగు · தமிழ்</span>
        </div>
      </div>
    </footer>
  );
}
