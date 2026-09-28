'use client';
import { useState } from 'react';
import { DesignCard } from '@/components/design/DesignCard';
import { FlowSteps } from '@/components/design/FlowSteps';
import s from '@/components/design/design.module.css';
import { Banner, Button, Empty, Skeleton } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { flow, useFlow } from '@/lib/flow';

export function DesignsClient() {
  const { t, lang } = useI18n();
  const designs = useFlow((st) => st.designs);
  const generation = useFlow((st) => st.generation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromPicture = generation?.provider.startsWith('image:') || generation?.requested_provider === 'image';

  const more = async () => {
    setBusy(true);
    setError(null);
    try {
      await flow.generate(lang, true);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page" data-testid="screen-designs">
      <FlowSteps current={2} />
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('designsTitle')}</h1>
          {generation?.fallback_reason ? null : generation ? (
            <p className="small muted" style={{ margin: 0 }}>
              {fromPicture ? t('pictureEngine') : t('engine', { name: generation.provider })}
            </p>
          ) : null}
        </div>
        <Button kind="ghost" href="/design">{t('editBrief')}</Button>
      </div>
      {generation?.fallback_reason ? <Banner tone="info">{t('fallbackNotice', { reason: generation.fallback_reason })}</Banner> : null}

      {designs.length === 0 ? (
        <Empty title={t('noDesigns')}><Button href="/design">{t('describeTitle')}</Button></Empty>
      ) : (
        <div className={s.designGrid} style={{ marginTop: 16 }}>
          {designs.map((d, i) => <DesignCard key={d.id} d={d} index={i} />)}
          {busy ? [0, 1, 2, 3].map((i) => <Skeleton key={`sk-${i}`} height={420} />) : null}
        </div>
      )}

      {error ? <div style={{ marginTop: 16 }}><Banner tone="fail" action={t('retry')} onAction={more}>{error}</Banner></div> : null}
      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        {fromPicture ? (
          <Button kind="secondary" href="/design/picture" testId="another-picture">{t('pictureAnother')}</Button>
        ) : designs.length ? (
          <Button kind="secondary" size="lg" busy={busy} onClick={more} testId="more-designs">
            {busy ? t('generating') : t('moreDesigns')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
