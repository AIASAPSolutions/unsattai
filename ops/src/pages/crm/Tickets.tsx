import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, Chips, Empty, ErrorBox, Field, Loading, PageHeader, SearchInput, StatusBadge, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ago, dateTime, label } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { TICKET_STATUSES, type Ticket } from '../../lib/types';

export default function Tickets() {
  const { id } = useParams();
  const nav = useNavigate();
  const [status, setStatus] = useState<string[]>(['open', 'pending']);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useLoad(() => get<{ items: Ticket[] }>('/ops/tickets', { status: status.join(',') || undefined, q: dq || undefined }), [status.join(','), dq], { poll: 60_000 });
  const { staffName } = useRefData();
  return (
    <>
      <PageHeader title="Tickets" subtitle="Customer support conversations from the web store and the app." />
      <div className="inbox">
        <Card flush>
          <div className="card-body stack tight">
            <SearchInput value={q} onChange={setQ} placeholder="Search number, subject, customer…" />
            <Chips multi value={status} onChange={setStatus} options={TICKET_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
          </div>
          {list.error ? <div className="card-body"><ErrorBox error={list.error} onRetry={list.reload} /></div> : (
            <div className="inbox-list" data-testid="ticket-list" style={{ borderTop: '1px solid var(--border)' }}>
              {(list.data?.items ?? []).map((t) => (
                <button key={t.id} className={t.id === id ? 'on' : ''} onClick={() => nav(`/crm/tickets/${t.id}`)} data-ticket={t.subject}>
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span className="strong ellipsis">{t.subject}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="muted small">{t.number} · {t.customer.name || t.customer.phone} · {label(t.category)} · {ago(t.updated_at)}</div>
                  <div className="muted small">{t.owner ? staffName(t.owner) : 'Unassigned'}{t.priority !== 'normal' && <> · <Badge tone={t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : 'neutral'}>{t.priority}</Badge></>}</div>
                </button>
              ))}
              {list.data && !list.data.items.length && <Empty title="Inbox zero">No tickets match these filters.</Empty>}
            </div>
          )}
        </Card>
        {id ? <Conversation id={id} onChange={list.reload} /> : <Card><Empty title="Choose a ticket">Pick a conversation on the left.</Empty></Card>}
      </div>
    </>
  );
}

function Conversation({ id, onChange }: { id: string; onChange: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const { staff, staffName } = useRefData();
  const t = useLoad(() => get<Ticket>(`/ops/tickets/${id}`), [id]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const { busy, run } = useAction();
  if (t.error) return <ErrorBox error={t.error} onRetry={t.reload} />;
  if (!t.data) return <Card><Loading /></Card>;
  const x = t.data;
  const canReply = can('crm');
  const update = (payload: Record<string, unknown>, ok: string) => run('u', async () => {
    const out = await post<Ticket>(`/ops/tickets/${x.id}`, { body: '', internal: false, ...payload });
    t.setData(out);
    toast.success(ok);
    onChange();
  }, toast.error);
  const send = () => update({ body: body.trim(), internal, status: nextStatus || (internal ? undefined : 'pending') }, internal ? 'Internal note added.' : 'Reply sent.')
    .then(() => { setBody(''); setNextStatus(''); });

  return (
    <Card title={<span className="row">{x.subject} <StatusBadge status={x.status} /></span>}
      actions={<span className="muted small">{x.number}</span>} flush>
      <div className="card-body stack">
        <div className="row small">
          <span>Customer: <Link to={`/crm/customers/${x.customer_id}`}>{x.customer.name || x.customer.phone}</Link> · {x.customer.phone}</span>
          {x.order_id && <span>· Order <Link to={`/orders/${x.order_id}`}>{x.order_id}</Link></span>}
          <span>· {label(x.category)} · {label(x.priority)} priority · via {label(x.channel)}</span>
        </div>
        {canReply && (
          <div className="row">
            <label className="row tight small">Assigned to
              <select className="sm" style={{ width: 'auto' }} value={x.owner} onChange={(e) => update({ owner: e.target.value }, `Assigned to ${staffName(e.target.value)}.`)} data-testid="ticket-owner">
                <option value="">Unassigned</option>
                {staff.filter((s) => s.active).map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.name || s.email}</option>)}
              </select>
            </label>
            <label className="row tight small">Status
              <select className="sm" style={{ width: 'auto' }} value={x.status} onChange={(e) => update({ status: e.target.value }, `Marked ${e.target.value}.`)} data-testid="ticket-status">
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="convo" data-testid="conversation">
          {x.messages.map((m, i) => {
            const fromCustomer = m.from === 'customer';
            return (
              <div key={i} className={`msg ${fromCustomer ? '' : m.internal ? 'internal' : 'staff'}`}>
                <div className="m">{fromCustomer ? (x.customer.name || 'Customer') : m.from.replace(/^staff:/, '')} · {dateTime(m.at)}{m.internal && ' · internal note'}</div>
                <div className="b">{m.body}</div>
              </div>
            );
          })}
        </div>
      </div>
      {canReply ? (
        <div className="card-foot stack tight">
          <Field label={internal ? 'Internal note (only staff see this)' : 'Reply to the customer'}>
            <textarea value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} data-testid="ticket-reply" style={{ background: internal ? 'var(--warn-soft)' : undefined }} />
          </Field>
          <div className="row">
            <label className="check small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="ticket-internal" /> Internal note</label>
            <span style={{ flex: 1 }} />
            <label className="row tight small">Then
              <select className="sm" style={{ width: 'auto' }} value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                <option value="">{internal ? 'Keep status' : 'Pending (waiting on customer)'}</option>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>Mark {s}</option>)}
              </select>
            </label>
            <Button variant="primary" busy={busy === 'u'} disabled={!body.trim()} onClick={send} data-testid="ticket-send">{internal ? 'Add note' : 'Send reply'}</Button>
          </div>
        </div>
      ) : <div className="card-foot"><Alert>Your role can read tickets but not reply.</Alert></div>}
    </Card>
  );
}
