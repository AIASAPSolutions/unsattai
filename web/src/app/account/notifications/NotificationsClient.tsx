'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Empty, ErrorState, Skeleton, cx } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { NotificationPage } from '@/lib/api/types';
import { formatDateTime } from '@/lib/price';
import s from '../account.module.css';

export function NotificationsClient() {
  const { t, lang } = useI18n();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    api.notifications(page).then((d) => live && setData(d)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [page, nonce]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 30)) : 1;
  const readAll = async () => {
    try {
      await api.markRead({ all: true });
      setNonce((n) => n + 1);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section aria-labelledby="ntf-h" data-testid="account-notifications">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id="ntf-h" style={{ margin: 0 }}>{t('notificationsTitle')}</h2>
        {data?.unread ? <Button kind="secondary" size="sm" onClick={readAll} testId="notifications-read-all">{t('markAllRead')}</Button> : null}
      </div>
      <div style={{ height: 12 }} />
      {error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />
        : !data ? <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={64} />)}</div>
          : !data.items.length ? <Empty icon="🔔" title={t('notificationsEmpty')} testId="notifications-empty" />
            : (
              <ul className={s.list} data-testid="notifications-list">
                {data.items.map((n) => (
                  <li key={n.id} className={cx(s.item)} style={n.read ? undefined : { borderColor: 'var(--info)', background: 'var(--info-soft)' }}>
                    <div>
                      <div className={s.itemTitle}>{n.read ? null : <span className="visually-hidden">{t('unread')}: </span>}{n.title}</div>
                      <div className={s.itemMeta}>{n.body}</div>
                      <time className="small muted" dateTime={n.created_at}>{formatDateTime(n.created_at, lang)}</time>
                    </div>
                    {n.order_id ? <Link href={`/account/orders/${encodeURIComponent(n.order_id)}`} className="small">{t('view')}</Link> : null}
                  </li>
                ))}
              </ul>
            )}
      {pages > 1 ? (
        <div className={s.pager}>
          <Button kind="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('previous')}</Button>
          <span className="small muted" style={{ alignSelf: 'center' }}>{t('of', { a: page, b: pages })}</span>
          <Button kind="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('next')} →</Button>
        </div>
      ) : null}
    </section>
  );
}
