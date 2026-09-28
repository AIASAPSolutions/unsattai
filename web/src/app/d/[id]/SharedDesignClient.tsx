'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChecksList } from '@/components/studio/ChecksTab';
import { Button, Card, Empty, ErrorState, Loading, SvgImg } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Design } from '@/lib/api/types';
import { flow, flowStore } from '@/lib/flow';
import { whenHydrated } from '@/lib/store';
import s from '../../order/[id]/order.module.css';

/** A design shared by link: see it, then open an editable copy in your own studio. */
export function SharedDesignClient({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [design, setDesign] = useState<Design | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    api.design(id).then((d) => live && setDesign(d)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [id, nonce]);

  if (error) {
    const nf = error instanceof ApiError && error.kind === 'not_found';
    return (
      <div className="container page">
        {nf ? <Empty title={t('sharedNotFound')}><p>{t('sharedNotFoundText')}</p><Button href="/design">{t('heroCta')}</Button></Empty>
          : <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />}
      </div>
    );
  }
  if (!design) return <Loading label={t('loading')} />;

  const open = async () => {
    await whenHydrated(flowStore);
    flow.openSpec(design.spec, design.id, 'shared');
    router.push('/studio');
  };

  return (
    <div className="container page" style={{ maxWidth: 900 }} data-testid="screen-shared">
      <h1>{design.spec.typography.team_name || design.spec.style_name || t('checkoutYourDesign')}</h1>
      <p className="muted">{t(`garment_${design.spec.garment}` as 'garment_jersey')}{design.spec.style_name ? ` · ${design.spec.style_name}` : ''}</p>
      <div className={s.layout}>
        <Card>
          <SvgImg svg={design.mockup_svg} alt={design.spec.style_name || t('checkoutYourDesign')} className={s.thumb} testId="shared-mockup" />
        </Card>
        <Card title={t('sharedTitle')}>
          <p style={{ marginTop: 0 }}>{t('sharedText')}</p>
          <Button size="lg" onClick={() => void open()} testId="shared-open">{t('sharedOpen')}</Button>
          <div style={{ marginTop: 16 }}><ChecksList checks={design.checks} /></div>
        </Card>
      </div>
    </div>
  );
}
