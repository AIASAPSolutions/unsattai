'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner, Button, Card, Empty, ErrorState, SelectField, Skeleton, StatusChip, TextArea, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { OrderSummary, Ticket } from '@/lib/api/types';
import { formatDateTime } from '@/lib/price';
import s from '../account.module.css';

export const TICKET_CATEGORIES = ['order_status', 'sizing', 'quality', 'delivery', 'payment', 'design', 'other'] as const;
export const TICKET_TONE: Record<Ticket['status'], 'info' | 'warn' | 'pass' | 'neutral'> = {
  open: 'info', pending: 'warn', resolved: 'pass', closed: 'neutral',
};

export function SupportClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const orderParam = useSearchParams().get('order') ?? '';
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [formOpen, setFormOpen] = useState(!!orderParam);
  const [form, setForm] = useState({ subject: '', category: orderParam ? 'order_status' : 'other', order_id: orderParam, body: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.tickets().then((r) => live && setTickets(r.tickets)).catch((e) => live && setError(e));
    api.myOrders(1).then((r) => live && setOrders(r.orders)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [nonce]);

  const subjectErr = tried && form.subject.trim().length < 3 ? t('accSubjectShort') : null;
  const bodyErr = tried && !form.body.trim() ? t('required') : null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (form.subject.trim().length < 3 || !form.body.trim()) return;
    setBusy(true);
    setSendErr(null);
    try {
      const tk = await api.newTicket({ ...form, subject: form.subject.trim(), body: form.body.trim() });
      router.push(`/account/support/${encodeURIComponent(tk.id)}`);
    } catch (err) {
      setSendErr(errorMessage(t, err));
      setBusy(false);
    }
  };

  const sorted = [...(tickets ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <section className="stack" style={{ gap: 20 }} data-testid="account-support">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{t('accSupport')}</h2>
        {!formOpen ? <Button onClick={() => setFormOpen(true)} testId="ticket-new">+ {t('accNewTicket')}</Button> : null}
      </div>

      {formOpen ? (
        <Card title={t('accNewTicket')} testId="ticket-form">
          <form className="stack" onSubmit={send} noValidate>
            <TextField label={t('accSubject')} value={form.subject} maxLength={160} error={subjectErr}
              onValue={(v) => setForm((f) => ({ ...f, subject: v }))} testId="ticket-subject" />
            <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <SelectField label={t('accCategory')} value={form.category} onValue={(v) => setForm((f) => ({ ...f, category: v }))} testId="ticket-category">
                  {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{t(`tcat_${c}`)}</option>)}
                </SelectField>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <SelectField label={t('accAboutOrder')} value={form.order_id} optional={t('optional')}
                  onValue={(v) => setForm((f) => ({ ...f, order_id: v }))} testId="ticket-order">
                  <option value="">{t('accNoOrderLinked')}</option>
                  {form.order_id && !orders.some((o) => o.id === form.order_id) ? <option value={form.order_id}>{form.order_id}</option> : null}
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.number || o.id}{o.team_name ? ` · ${o.team_name}` : ''}</option>)}
                </SelectField>
              </div>
            </div>
            <TextArea label={t('accMessage')} value={form.body} rows={5} maxLength={4000} error={bodyErr}
              onValue={(v) => setForm((f) => ({ ...f, body: v }))} testId="ticket-body" />
            {sendErr ? <Banner tone="fail">{sendErr}</Banner> : null}
            <div className="row" style={{ gap: 8 }}>
              <Button type="submit" busy={busy} testId="ticket-send">{t('accSendTicket')}</Button>
              <Button kind="ghost" onClick={() => setFormOpen(false)}>{t('cancel')}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {error ? (
        <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={() => { setError(null); setNonce((n) => n + 1); }} />
      ) : !tickets ? (
        <div className="stack">{[0, 1].map((i) => <Skeleton key={i} height={70} />)}</div>
      ) : sorted.length === 0 ? (
        formOpen ? null : <Empty title={t('accNoTickets')} testId="tickets-empty"><p>{t('accNoTicketsText')}</p></Empty>
      ) : (
        <ul className={s.list}>
          {sorted.map((tk) => (
            <li key={tk.id}>
              <Link href={`/account/support/${encodeURIComponent(tk.id)}`} className={s.item} data-testid={`ticket-${tk.id}`}>
                <div>
                  <div className={s.itemTitle}>{tk.subject}</div>
                  <div className={s.itemMeta}>
                    {tk.number || tk.id} · {t(`tcat_${tk.category}` as 'tcat_other')} · {formatDateTime(tk.updated_at, lang)}
                    {tk.order_id ? ` · ${t('payOrderRef', { ref: tk.order_id })}` : ''}
                  </div>
                </div>
                <div className={s.itemRight}>
                  <StatusChip tone={TICKET_TONE[tk.status] ?? 'neutral'}>{t(`tstatus_${tk.status}` as 'tstatus_open')}</StatusChip>
                  <span className="small muted">{t('accMessagesN', { n: tk.messages.length })}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
