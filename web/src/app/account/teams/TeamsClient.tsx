'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Empty, ErrorState, Skeleton, StatusChip } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Collection, CollectionStatus } from '@/lib/api/types';
import { formatDate } from '@/lib/price';
import s from '../account.module.css';

export const COLLECTION_TONE: Record<CollectionStatus, 'info' | 'warn' | 'pass' | 'fail'> = {
  open: 'info', locked: 'warn', ordered: 'pass', cancelled: 'fail',
};

export function TeamsClient() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<Collection[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    api.myCollections().then((r) => live && setList(r.collections)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [nonce]);

  return (
    <section data-testid="account-teams">
      <h2>{t('accTeams')}</h2>
      <p className="muted">{t('accTeamsText')}</p>
      {error ? (
        <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />
      ) : !list ? (
        <div className="stack">{[0, 1].map((i) => <Skeleton key={i} height={70} />)}</div>
      ) : list.length === 0 ? (
        <Empty title={t('accNoTeams')} testId="teams-empty">
          <p>{t('teamText')}</p>
          <Button href="/design">{t('teamCta')}</Button>
        </Empty>
      ) : (
        <ul className={s.list}>
          {[...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).map((c) => (
            <li key={c.id}>
              <Link href={`/account/teams/${encodeURIComponent(c.id)}`} className={s.item} data-testid={`team-${c.id}`}>
                <div>
                  <div className={s.itemTitle}>{c.title}</div>
                  <div className={s.itemMeta}>
                    {t('piecesN', { n: c.count ?? 0 })}
                    {c.deadline ? ` · ${t('teamDeadlineOn', { date: formatDate(c.deadline, lang) })}` : ''}
                  </div>
                </div>
                <StatusChip tone={COLLECTION_TONE[c.status]}>{t(`cstatus_${c.status}` as 'cstatus_open')}</StatusChip>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
