import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActivityFeed, LeadForm, leadInput } from '../../components/crm';
import { DesignPreview } from '../../components/domain';
import { IconPlus } from '../../components/icons';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, StatusBadge, useToast } from '../../components/ui';
import { get, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, label, money0 } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Activity, Customer, Lead, Quote } from '../../lib/types';

interface Detail { lead: Lead; activities: Activity[]; customer: Customer | null; quotes: Quote[] }

export default function LeadDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const { currency, settings, staffName, who } = useRefData();
  const d = useLoad(() => get<Detail>(`/ops/leads/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useAction();
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const { lead: l, activities, customer, quotes } = d.data;
  const stages = settings?.crm.value.lead_stages ?? [l.stage];
  const move = (stage: string) => run('stage', async () => {
    await put(`/ops/leads/${l.id}`, leadInput(l, { stage }));
    toast.success(`Moved to ${label(stage)}.`);
    await d.reload();
  }, toast.error);

  return (
    <>
      <PageHeader crumbs={<><Link to="/crm/leads">Leads</Link> / {l.title}</>}
        title={<span className="row">{l.title} <StatusBadge status={l.stage} /></span>}
        subtitle={<>Source {label(l.source)} · created {dateTime(l.created_at)} · owner {staffName(l.owner)}</>}
        actions={can('crm') && <>
          <select value={l.stage} onChange={(e) => move(e.target.value)} disabled={busy === 'stage'} style={{ width: 'auto' }} aria-label="Stage" data-testid="lead-stage">
            {stages.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          <Button onClick={() => setEditing(true)}>Edit</Button>
          {can('quotes') && customer && <Button variant="primary" icon={<IconPlus />} onClick={() => nav(`/crm/quotes/new?customer=${customer.id}&lead=${l.id}`)} data-testid="lead-new-quote">Quote</Button>}
        </>} />
      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Details">
            <div className="grid" style={{ gridTemplateColumns: l.spec ? '1fr 220px' : '1fr' }}>
              <dl className="kv">
                <dt>Customer</dt><dd>{customer ? <Link to={`/crm/customers/${customer.id}`}>{customer.name || customer.phone}</Link> : <span className="muted">None</span>}{customer && <span className="muted"> · {customer.phone}</span>}</dd>
                <dt>Value</dt><dd>{money0(l.value, currency)}</dd>
                <dt>Pieces</dt><dd>{l.pieces || '—'}</dd>
                <dt>Expected close</dt><dd>{day(l.expected_close, true)}</dd>
                {l.organisation_id && <><dt>Organisation</dt><dd><Link to={`/crm/organisations/${l.organisation_id}`}>Open organisation</Link></dd></>}
                {l.stage === 'lost' && <><dt>Lost reason</dt><dd>{l.lost_reason || '—'}</dd></>}
                <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{l.notes || <span className="muted">None</span>}</dd>
              </dl>
              {l.spec && <div><div className="muted small" style={{ marginBottom: 4 }}>Design sent with the enquiry</div><DesignPreview spec={l.spec} height={200} /></div>}
            </div>
          </Card>
          <Card title={`Quotes (${quotes.length})`} flush>
            <DataTable rows={quotes} rowKey={(q) => q.id} compact onRowClick={(q) => nav(`/crm/quotes/${q.id}`)} columns={[
              { key: 'n', header: 'Quote', render: (q) => <Link to={`/crm/quotes/${q.id}`}>{q.number}</Link> },
              { key: 's', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
              { key: 'v', header: 'Valid until', render: (q) => day(q.valid_until) },
              { key: 't', header: 'Total', num: true, render: (q) => money0(q.pricing.total, q.pricing.currency) },
            ]} empty={customer ? 'No quotes yet.' : 'Link a customer to this lead to quote.'} />
          </Card>
          {l.history && l.history.length > 0 && (
            <Card title="Stage history">
              <ul className="timeline">
                {[...l.history].reverse().map((h, i) => <li key={i}><div className="t">{label(h.from)} → {label(h.to)}</div><div className="m">{dateTime(h.at)} · {who(h.by)}</div></li>)}
              </ul>
            </Card>
          )}
        </div>
        <Card title="Activity"><ActivityFeed subject={`lead:${l.id}`} items={activities} onChange={d.reload} /></Card>
      </div>
      {editing && <LeadForm lead={l} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void d.reload(); }} />}
    </>
  );
}
