'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Banner, Button, Card, Empty, ErrorState, Loading, StatusChip, TextArea, cx } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { Ticket } from '@/lib/api/types';
import { formatDateTime } from '@/lib/price';
import s from '../../account.module.css';
import { TICKET_TONE } from '../SupportClient';

/** One support conversation. The API has no single-ticket read for customers, so it is found in the list. */
export function TicketClient({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.tickets()
      .then((r) => live && setTicket(r.tickets.find((x) => x.id === id) ?? null))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [id, nonce]);

  if (error) return <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />;
  if (ticket === undefined) return <Loading label={t('loading')} />;
  if (ticket === null) {
    return <Empty title={t('notFoundTitle')}><Button href="/account/support">{t('accSupport')}</Button></Empty>;
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setSendErr(null);
    try {
      setTicket(await api.replyTicket(ticket.id, reply.trim()));
      setReply('');
    } catch (err) {
      setSendErr(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const closed = ticket.status === 'closed';

  return (
    <section className="stack" data-testid="account-ticket">
      <div><Button kind="ghost" size="sm" href="/account/support">← {t('accSupport')}</Button></div>
      <Card title={ticket.subject} sub={`${ticket.number || ticket.id} · ${t(`tcat_${ticket.category}` as 'tcat_other')}`}
        right={<StatusChip tone={TICKET_TONE[ticket.status] ?? 'neutral'} testId="ticket-status">{t(`tstatus_${ticket.status}` as 'tstatus_open')}</StatusChip>}>
        {ticket.order_id ? (
          <p className="small" style={{ marginTop: 0 }}>
            <Link href={`/account/orders/${encodeURIComponent(ticket.order_id)}`}>{t('payOrderRef', { ref: ticket.order_id })}</Link>
          </p>
        ) : null}
        <div className={s.bubbles} data-testid="ticket-messages">
          {ticket.messages.map((m, i) => (
            <div key={`${m.at}-${i}`} className={cx(s.bubble, m.from === 'customer' && s.mine)}>
              <div className="small muted">{m.from === 'customer' ? t('accYou') : t('accTeam')} · {formatDateTime(m.at, lang)}</div>
              {m.body}
            </div>
          ))}
        </div>
        {closed ? <Banner tone="info">{t('accTicketClosed')}</Banner> : (
          <form className="stack" onSubmit={send}>
            <TextArea label={t('accReply')} value={reply} onValue={setReply} rows={3} maxLength={4000} testId="ticket-reply" />
            {sendErr ? <Banner tone="fail">{sendErr}</Banner> : null}
            <div><Button type="submit" busy={busy} disabled={!reply.trim()} testId="ticket-reply-send">{t('accSendReply')}</Button></div>
          </form>
        )}
      </Card>
    </section>
  );
}
