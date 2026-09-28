'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Stars, StatusChip, SvgImg } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useT } from '@/i18n/provider';
import type { Design } from '@/lib/api/types';
import { COLOR_ROLES } from '@/lib/api/types';
import { flow, useFlow } from '@/lib/flow';
import s from './design.module.css';

/** One design with its mock-up, check status, palette, rating and "open in the studio". */
export function DesignCard({ d, index }: { d: Design; index: number }) {
  const t = useT();
  const router = useRouter();
  const rating = useFlow((st) => st.ratings[d.id] ?? 0);
  const [rateError, setRateError] = useState<string | null>(null);
  const warns = d.checks.filter((c) => c.level === 'warn').length;
  const p = d.spec.pattern;
  return (
    <Card className={s.designCard} testId={`design-${index}`} as="article">
      <div className={s.mock}>
        <SvgImg svg={d.mockup_svg} alt={`${d.spec.style_name}, ${t(`garment_${d.spec.garment}`)}`} />
      </div>
      <div className={s.titleRow}>
        <h3>{d.spec.style_name}</h3>
        <StatusChip tone={d.manufacturing_ready ? 'pass' : 'fail'}>{d.manufacturing_ready ? t('ready') : t('notReady')}</StatusChip>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {tMaybe(t, `pattern_${p.type}`, p.type)} · {tMaybe(t, `coverage_${p.coverage}`, p.coverage)} · {tMaybe(t, `sport_${d.spec.sport}`, d.spec.sport)}
      </p>
      {warns ? <p className="small" style={{ color: 'var(--warn)', margin: 0 }}>! {t('warnings', { n: warns })}</p> : null}
      <div className={s.palette} aria-label={t('colours')}>
        {COLOR_ROLES.map((r) => <span key={r} className={s.dot} style={{ background: d.spec.palette[r], width: 20, height: 20 }}
          title={`${t(`role_${r}`)} ${d.spec.palette[r]}`} />)}
      </div>
      {d.spec.rationale ? <p className={s.rationale}>{d.spec.rationale}</p> : null}
      <div className={s.rateRow}>
        <span>{rating ? t('rated') : t('rate')}</span>
        <Stars value={rating} label={`${t('rate')}: ${d.spec.style_name}`} testId={`rate-${index}`} onChange={(n) => {
          setRateError(null);
          flow.rate(d.id, n).catch((e) => setRateError(errorMessage(t, e)));
        }} />
      </div>
      {rateError ? <p className="small" style={{ color: 'var(--fail)' }}>{rateError}</p> : null}
      <Button block testId={`open-${index}`} onClick={() => {
        flow.openDesign(d);
        router.push('/studio');
      }}>{t('openEditor')}</Button>
    </Card>
  );
}
