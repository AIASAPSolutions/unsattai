'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Button, Card, Empty, ErrorState, Loading, StatusChip, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Collection, CollectionEntry } from '@/lib/api/types';
import { flow, flowStore, rowKey } from '@/lib/flow';
import { formatDate } from '@/lib/price';
import { duplicateNumbers, sizeBreakdown } from '@/lib/roster';
import { copyText } from '@/lib/share';
import { whenHydrated } from '@/lib/store';
import { Thumb } from '../../designs/DesignsClient';
import { COLLECTION_TONE } from '../TeamsClient';

type Full = Collection & { entries: CollectionEntry[] };

export function TeamDashboardClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [c, setC] = useState<Full | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    api.myCollection(id).then((r) => live && setC(r)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [id, nonce]);

  if (error) return <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />;
  if (!c) return <Loading label={t('loading')} />;

  const link = typeof window === 'undefined' ? `/t/${c.token}` : `${window.location.origin}/t/${c.token}`;
  const pieces = c.entries.reduce((n, e) => n + e.quantity, 0);
  const dups = duplicateNumbers(c.entries);
  const editable = c.status === 'open' || c.status === 'locked';

  const run = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'pass', text: ok });
    } catch (e) {
      setMsg({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: 'open' | 'locked' | 'cancelled') =>
    run(status, async () => {
      const updated = await api.setCollectionStatus(c.id, status);
      setC({ ...c, ...updated, entries: c.entries });
    });

  const removeEntry = (e: CollectionEntry) => {
    if (!window.confirm(t('teamRemoveConfirm', { name: e.player_name || e.number || t('unnamed') }))) return;
    void run(`rm-${e.id}`, async () => {
      await api.removeEntry(c.id, e.id);
      setC({ ...c, entries: c.entries.filter((x) => x.id !== e.id) });
    });
  };

  const checkout = async () => {
    await whenHydrated(flowStore);
    flow.openSpec(c.spec, c.design_id || null, 'team');
    flow.setCheckout({
      mode: 'team', fabric: c.fabric, collectionId: c.id, collectionTitle: c.title,
      rows: c.entries.map((e) => ({ key: rowKey(), player_name: e.player_name, number: e.number, size: e.size, quantity: e.quantity })),
    });
    router.push('/configure');
  };

  return (
    <section className="stack" style={{ gap: 20 }} data-testid="team-dashboard">
      <div><Button kind="ghost" size="sm" href="/account/teams">← {t('accTeams')}</Button></div>
      {msg ? <Banner tone={msg.tone} live>{msg.text}</Banner> : null}
      <Card title={c.title} right={<StatusChip tone={COLLECTION_TONE[c.status]} testId="team-status">{t(`cstatus_${c.status}` as 'cstatus_open')}</StatusChip>}>
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ width: 180 }}><Thumb spec={c.spec} alt={c.title} /></div>
          <div className="stack" style={{ flex: 1, minWidth: 240 }}>
            <p style={{ margin: 0 }}>
              <strong className="tnum" data-testid="team-count">{t('piecesN', { n: pieces })}</strong>
              {' · '}{t('teamPlayersN', { n: c.entries.length })}
              {c.deadline ? ` · ${t('teamDeadlineOn', { date: formatDate(c.deadline, lang, true) })}` : ''}
            </p>
            {pieces ? <p className="small muted" style={{ margin: 0 }}>{sizeBreakdown(c.entries).map((b) => `${b.size} ${b.quantity}`).join(' · ')}</p> : null}
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><TextField label={t('teamLink')} value={link} readOnly testId="team-link" onFocus={(e) => e.target.select()} /></div>
              <Button kind="secondary" style={{ marginBottom: 22 }}
                onClick={() => void copyText(link).then(() => setMsg({ tone: 'pass', text: t('linkCopied') }))}>{t('copyLink')}</Button>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {c.status === 'open' ? <Button kind="secondary" busy={busy === 'locked'} onClick={() => void setStatus('locked')} testId="team-lock">{t('teamLock')}</Button> : null}
              {c.status === 'locked' ? <Button kind="secondary" busy={busy === 'open'} onClick={() => void setStatus('open')} testId="team-reopen">{t('teamReopen')}</Button> : null}
              {editable ? (
                <Button busy={busy === 'checkout'} disabled={!c.entries.length} onClick={() => void checkout()} testId="team-checkout">
                  {t('teamCheckout')} →
                </Button>
              ) : null}
              {c.status === 'ordered' && c.order_id ? (
                <Button kind="secondary" href={`/account/orders/${encodeURIComponent(c.order_id)}`}>{t('viewInAccount')}</Button>
              ) : null}
            </div>
            {c.status === 'open' ? <p className="small muted" style={{ margin: 0 }}>{t('teamLockHint')}</p> : null}
          </div>
        </div>
      </Card>

      {dups.length ? <Banner tone="warn">{t('duplicateNumbersWarn', { numbers: dups.join(', ') })}</Banner> : null}

      <Card title={t('teamEntries')}>
        {c.entries.length === 0 ? (
          <Empty title={t('teamNoEntries')} testId="team-entries-empty"><p>{t('teamShareHint')}</p></Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" data-testid="team-entries">
              <thead>
                <tr>
                  <th scope="col">{t('playerName')}</th>
                  <th scope="col">{t('number')}</th>
                  <th scope="col">{t('size')}</th>
                  <th scope="col">{t('quantity')}</th>
                  <th scope="col">{t('teamContact')}</th>
                  <th scope="col"><span className="visually-hidden">{t('removeRow')}</span></th>
                </tr>
              </thead>
              <tbody>
                {c.entries.map((e) => (
                  <tr key={e.id} data-testid={`entry-${e.id}`}>
                    <td>{e.player_name || <span className="muted">{t('unnamed')}</span>}</td>
                    <td className="tnum">{e.number || '—'}</td>
                    <td>{e.size}</td>
                    <td className="tnum">{e.quantity}</td>
                    <td className="small">{e.contact}</td>
                    <td>
                      {editable ? (
                        <Button kind="ghost" size="sm" busy={busy === `rm-${e.id}`} onClick={() => removeEntry(e)} testId={`entry-remove-${e.id}`}>
                          {t('removeRow')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editable ? (
        <div>
          <Button kind="danger" size="sm" busy={busy === 'cancelled'} testId="team-cancel"
            onClick={() => { if (window.confirm(t('teamCancelConfirm'))) void setStatus('cancelled'); }}>{t('teamCancel')}</Button>
        </div>
      ) : null}
    </section>
  );
}
