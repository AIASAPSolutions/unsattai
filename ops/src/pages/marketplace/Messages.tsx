import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Card, Chips, DataTable, Drawer, ErrorBox, PageHeader, Pager, SearchInput } from '../../components/ui';
import { get } from '../../lib/api';
import { dateTime, label } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import type { Message, Page } from '../../lib/types';
import { MessagingSetup } from './MessagingSetup';

const STATUS_TONE = { logged: 'info', sent: 'good', failed: 'bad' } as const;

export default function Messages() {
  const [params, setParams] = useSearchParams();
  const orderId = params.get('order') ?? '';
  const [channel, setChannel] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Message | null>(null);
  const d = useLoad(() => get<Page<Message>>('/ops/messages', { channel: channel[0], status: status[0], order_id: orderId || undefined, q: dq || undefined, page }),
    [channel.join(','), status.join(','), orderId, dq, page]);
  const logged = (d.data?.items ?? []).some((m) => m.status === 'logged');
  const { can } = useAuth();

  return (
    <>
      <PageHeader title="Messages" subtitle="SMS and email sent to customers for order events: placed, confirmed, dispatched, delivered, cancellations and returns. One-time codes are never listed." />
      {can('settings') && <MessagingSetup />}
      <Card flush>
        <div className="card-body stack">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Recipient, subject or text…" testId="messages-search" />
            <Chips value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={[{ value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' }]} />
            <Chips value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'logged', label: 'Logged' }, { value: 'sent', label: 'Sent' }, { value: 'failed', label: 'Failed' }]} />
            {orderId && <span className="tag">Order {orderId}<button type="button" aria-label="Clear order filter" onClick={() => { const p = new URLSearchParams(params); p.delete('order'); setParams(p); }}>×</button></span>}
          </div>
          {logged && <Alert tone="info">“Logged” means no SMS or email provider is connected yet: the message was written to the server log, not delivered.</Alert>}
        </div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="messages-table" rows={d.data?.items ?? []} rowKey={(m) => m.id} onRowClick={setOpen}
            empty={d.loading ? 'Loading…' : 'No messages match.'}
            columns={[
              { key: 'at', header: 'Time', sort: (m) => m.created_at, render: (m) => <span className="nowrap small">{dateTime(m.sent_at || m.created_at)}</span> },
              { key: 'ch', header: 'Channel', sort: (m) => m.channel, render: (m) => <Badge tone={m.channel === 'sms' ? 'accent' : 'info'}>{m.channel === 'sms' ? 'SMS' : 'Email'}</Badge> },
              { key: 'ev', header: 'Template', sort: (m) => m.event, render: (m) => <code className="small">{m.event || '—'}</code> },
              { key: 'to', header: 'Recipient', sort: (m) => m.to, render: (m) => <span className="small">{m.to}</span> },
              { key: 'sub', header: 'Message', render: (m) => <div style={{ maxWidth: 380 }}><div className="ellipsis">{m.subject || m.body.slice(0, 80)}</div>{m.subject && <div className="muted small ellipsis">{m.body}</div>}</div> },
              { key: 'o', header: 'Order', render: (m) => (m.order_id ? <Link to={`/orders/${m.order_id}`}>Open</Link> : <span className="muted">—</span>) },
              { key: 'st', header: 'Status', sort: (m) => m.status, render: (m) => <Badge tone={STATUS_TONE[m.status] ?? 'neutral'} dot>{label(m.status)}</Badge> },
            ]} />
        )}
        {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="messages" />}
      </Card>
      {open && (
        <Drawer open title={`${open.channel === 'sms' ? 'SMS' : 'Email'} to ${open.to}`} onClose={() => setOpen(null)} testId="message-drawer">
          <dl className="kv">
            <dt>Template</dt><dd><code>{open.event}</code></dd>
            <dt>Status</dt><dd><Badge tone={STATUS_TONE[open.status] ?? 'neutral'} dot>{label(open.status)}</Badge></dd>
            <dt>Created</dt><dd>{dateTime(open.created_at)}</dd>
            {open.order_id && <><dt>Order</dt><dd><Link to={`/orders/${open.order_id}`}>Open order</Link></dd></>}
            {open.customer_id && <><dt>Customer</dt><dd><Link to={`/crm/customers/${open.customer_id}`}>Open customer</Link></dd></>}
            {open.subject && <><dt>Subject</dt><dd className="strong">{open.subject}</dd></>}
          </dl>
          <div className="msg-body" style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 6 }}>{open.body}</div>
        </Drawer>
      )}
    </>
  );
}
