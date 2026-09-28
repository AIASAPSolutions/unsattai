import type { Metadata } from 'next';
import { Button, Card } from '@/components/ui';
import { serverT } from '@/i18n/server';
import { formatPercent } from '@/lib/price';
import { loadCatalogue } from '@/lib/server/catalogue';
import s from '../home.module.css';

export const metadata: Metadata = {
  title: 'Team orders',
  description: 'Order a full team kit: share one link, players add their own name, number and size, and you place one order with quantity discounts.',
  alternates: { canonical: '/teams' },
};

export default async function TeamsPage() {
  const { t, lang } = await serverT();
  const cat = await loadCatalogue();
  const tiers = cat?.quantity_tiers.filter((x) => x.discount > 0) ?? [];
  const maxTier = tiers.length ? Math.max(...tiers.map((x) => x.discount)) : 0;
  const steps: [string, string][] = [
    [t('teamsStep1'), t('teamsStep1Text')],
    [t('teamsStep2'), t('teamsStep2Text')],
    [t('teamsStep3'), t('teamsStep3Text')],
    [t('teamsStep4'), t('teamsStep4Text')],
  ];
  return (
    <div className="container page" data-testid="screen-teams">
      <h1>{t('teamTitle')}</h1>
      <p style={{ maxWidth: 720 }}>{t('teamText')}</p>
      <ol className={s.steps} style={{ marginTop: 24 }}>
        {steps.map(([h, p]) => (
          <li key={h} className={s.step}>
            <h2 style={{ fontSize: 18 }}>{h}</h2>
            <p>{p}</p>
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: 12, margin: '24px 0' }}>
        <Button size="lg" href="/design">{t('teamCta')}</Button>
        <Button size="lg" kind="secondary" href="/account/teams">{t('accTeams')}</Button>
      </div>
      {tiers.length ? (
        <Card title={t('tiersTitle')} sub={maxTier ? t('teamPoint3', { pct: formatPercent(maxTier, lang) }) : undefined}>
          <ul className="row" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 12, flexWrap: 'wrap' }}>
            {tiers.map((x) => (
              <li key={x.min} className="tnum" style={{ padding: '8px 14px', background: 'var(--bg)', borderRadius: 999 }}>
                {t('tierFrom', { n: x.min })}: <strong>−{formatPercent(x.discount, lang)}</strong>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <p className="small muted" style={{ marginTop: 16 }}>{t('teamsBulkNote')}</p>
    </div>
  );
}
