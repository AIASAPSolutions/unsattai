import type { Metadata } from 'next';
import { EnquiryForm } from '@/components/shop/EnquiryForm';
import { Card } from '@/components/ui';
import { serverT } from '@/i18n/server';
import { loadCatalogue } from '@/lib/server/catalogue';

export const metadata: Metadata = {
  title: 'Bulk enquiry',
  description: 'Kits for clubs, schools, events and companies. Tell us what you need and our team will call you with a quote.',
  alternates: { canonical: '/enquiry' },
};

export default async function Page() {
  const { t } = await serverT();
  const cat = await loadCatalogue();
  const co = cat?.company;
  return (
    <div className="container page" style={{ maxWidth: 760 }} data-testid="screen-enquiry">
      <h1>{t('bulkTitle')}</h1>
      <p>{t('bulkText')}</p>
      <Card>
        <EnquiryForm testId="enquiry" />
      </Card>
      {co && (co.phone || co.email) ? (
        <p className="small muted" style={{ marginTop: 16 }}>
          {t('enquiryDirect')}{' '}
          {co.phone ? <a href={`tel:${co.phone.replace(/[^\d+]/g, '')}`}>{co.phone}</a> : null}
          {co.phone && co.email ? ` ${t('or')} ` : ''}
          {co.email ? <a href={`mailto:${co.email}`}>{co.email}</a> : null}
          {co.support_hours ? ` · ${t('footerHours', { hours: co.support_hours })}` : ''}
        </p>
      ) : null}
    </div>
  );
}
