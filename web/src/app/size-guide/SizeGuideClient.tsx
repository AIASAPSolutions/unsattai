'use client';
import { useState } from 'react';
import { SizeGuideView } from '@/components/shop/Sizing';
import { Card, Tabs } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import type { SizeGuide, Sleeves } from '@/lib/api/types';

/** The size guide as a page: tops (with short or long sleeve lengths) or shorts, for each fit. */
export function SizeGuideClient({ initial }: { initial: SizeGuide | null }) {
  const { t } = useI18n();
  const [garment, setGarment] = useState<'jersey' | 'shorts'>('jersey');
  const [sleeves, setSleeves] = useState<Sleeves>('short');
  return (
    <div className="container page" style={{ maxWidth: 860 }} data-testid="screen-size-guide">
      <h1>{t('sgPageTitle')}</h1>
      <p>{t('sgPageText')}</p>
      <Card>
        <div className="stack" style={{ gap: 14 }}>
          <Tabs label={t('sgGarment')} value={garment} onChange={setGarment} testId="sg-garment"
            options={[{ value: 'jersey', label: t('sgTops') }, { value: 'shorts', label: t('sgShorts') }]} />
          {garment === 'jersey' ? (
            <Tabs label={t('sleevesLabel')} value={sleeves} onChange={setSleeves} testId="sg-sleeves"
              options={[{ value: 'short', label: t('sleeves_short') }, { value: 'long', label: t('sleeves_long') }]} />
          ) : null}
          <SizeGuideView garment={garment} sleeves={sleeves} initial={initial} testId="size-guide-page" />
        </div>
      </Card>
    </div>
  );
}
