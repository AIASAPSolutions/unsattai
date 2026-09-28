'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Button, Empty, ErrorState, Skeleton, SvgImg } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { DesignSpec, SavedDesign } from '@/lib/api/types';
import { flow, flowStore } from '@/lib/flow';
import { formatDate } from '@/lib/price';
import { whenHydrated } from '@/lib/store';
import s from '../account.module.css';

export function Thumb({ spec, alt }: { spec: DesignSpec; alt: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api.render(spec, [], c.signal).then((p) => setSvg(p.mockup_svg)).catch(() => undefined);
    return () => c.abort();
  }, [spec]);
  return svg ? <SvgImg svg={svg} alt={alt} className={s.designThumb} /> : <Skeleton height={200} />;
}

export function DesignsClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.myDesigns()
      .then((r) => live && setDesigns(r.designs))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [nonce]);

  const open = async (d: SavedDesign) => {
    await whenHydrated(flowStore);
    flow.openSpec(d.spec, d.design_id || null, 'saved');
    router.push('/studio');
  };

  const remove = async (d: SavedDesign) => {
    if (!window.confirm(t('accDeleteDesignConfirm', { name: d.name }))) return;
    setBusy(d.id);
    setMsg(null);
    try {
      await api.deleteDesign(d.id);
      setDesigns((list) => (list ?? []).filter((x) => x.id !== d.id));
    } catch (e) {
      setMsg(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section data-testid="account-designs">
      <h2>{t('accDesigns')}</h2>
      {msg ? <Banner tone="fail">{msg}</Banner> : null}
      {error ? (
        <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />
      ) : !designs ? (
        <div className={s.grid}>{[0, 1, 2].map((i) => <Skeleton key={i} height={280} />)}</div>
      ) : designs.length === 0 ? (
        <Empty title={t('accNoDesigns')} testId="designs-empty">
          <p>{t('accNoDesignsText')}</p>
          <Button href="/design">{t('heroCta')}</Button>
        </Empty>
      ) : (
        <ul className={s.grid} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {designs.map((d) => (
            <li key={d.id} className={s.designCard} data-testid={`saved-${d.id}`}>
              <Thumb spec={d.spec} alt={d.name} />
              <div>
                <div className={s.itemTitle}>{d.name}</div>
                <div className={s.itemMeta}>{t(`garment_${d.spec.garment}` as 'garment_jersey')} · {formatDate(d.updated_at.slice(0, 10), lang)}</div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" onClick={() => void open(d)} testId={`saved-open-${d.id}`}>{t('open')}</Button>
                <Button size="sm" kind="ghost" busy={busy === d.id} onClick={() => void remove(d)} testId={`saved-delete-${d.id}`}>{t('delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
