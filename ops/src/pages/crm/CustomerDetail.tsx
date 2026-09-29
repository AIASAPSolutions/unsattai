import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActivityFeed, CustomerForm, LeadForm, LeadValue } from '../../components/crm';
import { OrderStatus } from '../../components/domain';
import { PaymentBadge, SellerLink, Verified } from '../../components/marketplace';
import { IconPlus } from '../../components/icons';
import { Badge, Button, Card, DataTable, ErrorBox, Loading, PageHeader, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, label, money0, num } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Activity, CheckoutRef, Customer, Lead, OrderSummary, Organisation, Quote, Ticket } from '../../lib/types';

interface Detail { customer: Customer; orders: OrderSummary[]; activities: Activity[]; quotes: Quote[]; tickets: Ticket[]; leads: Lead[]; organisation: Organisation | null }

export default function CustomerDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { currency, staffName } = useRefData();
  const d = useLoad(() => get<Detail>(`/ops/customers/${id}`), [id]);
  // Checkout numbers for orders placed together (the order rows carry only the checkout id).
  const ckIds = [...new Set((d.data?.orders ?? []).map((o) => o.checkout_id).filter((x): x is string => !!x))];
  const checkouts = useLoad(async () => {
    const out: Record<string, CheckoutRef> = {};
    await Promise.all(ckIds.slice(0, 30).map(async (cid) => { const c = await get<CheckoutRef>(`/ops/checkouts/${cid}`).catch(() => null); if (c) out[cid] = c; }));
    return out;
  }, [ckIds.join(',')]);
  const [editing, setEditing] = useState(false);
  const [newLead, setNewLead] = useState(false);
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const { customer: c, orders, quotes, tickets, leads, organisation, activities } = d.data;
  return (
    <>
      <PageHeader crumbs={<><Link to="/crm/customers">Customers</Link> / {c.name || c.phone}</>}
        title={<span className="row">{c.name || 'No name'} <StatusBadge status={c.status} /></span>}
        subtitle={<>customer since {day(c.created_at, true)} · source {label(c.source)}</>}
        actions={can('crm') && <>
          <Button onClick={() => setEditing(true)} data-testid="edit-customer">Edit profile</Button>
          <Button onClick={() => setNewLead(true)} icon={<IconPlus />}>Lead</Button>
          {can('quotes') && <Button variant="primary" icon={<IconPlus />} onClick={() => nav(`/crm/quotes/new?customer=${c.id}`)} data-testid="new-quote">Quote</Button>}
        </>} />
      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <div className="kpis">
            <div className="kpi"><div className="k">Paid orders</div><div className="v">{num(c.orders_count)}</div></div>
            <div className="kpi"><div className="k">Lifetime value</div><div className="v">{money0(c.lifetime_value, currency)}</div></div>
            <div className="kpi"><div className="k">Last order</div><div className="v" style={{ fontSize: 16 }}>{day(c.last_order_at, true)}</div></div>
            <div className="kpi"><div className="k">Open tickets</div><div className="v">{tickets.filter((t) => t.status === 'open' || t.status === 'pending').length}</div></div>
          </div>
          <Card title={`Orders (${orders.length})`} flush>
            <DataTable rows={orders} rowKey={(o) => o.id} compact onRowClick={(o) => nav(`/orders/${o.id}`)} columns={[
              { key: 'n', header: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.number}</Link> },
              { key: 'd', header: 'Placed', sort: (o) => o.created_at, render: (o) => day(o.created_at) },
              { key: 'ck', header: 'Checkout', sort: (o) => o.checkout_id ?? '', render: (o) => (o.checkout_id
                ? <Link to={`/orders?checkout=${o.checkout_id}`} title="Orders placed together">{checkouts.data?.[o.checkout_id]?.number ?? 'Checkout'}</Link> : <span className="muted small">Single</span>) },
              { key: 'design', header: 'Design', render: (o) => o.team_name || o.style_name },
              { key: 'sel', header: 'Seller', render: (o) => <SellerLink id={o.seller_id} name={o.seller_name} /> },
              { key: 's', header: 'Status', render: (o) => <span className="row tight"><OrderStatus o={o} /><PaymentBadge o={o} /></span> },
              { key: 'p', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
              { key: 't', header: 'Total', num: true, render: (o) => money0(o.total, o.currency) },
            ]} empty="No orders yet." />
          </Card>
          <Card title={`Quotes (${quotes.length})`} flush actions={can('quotes') && <Link to={`/crm/quotes/new?customer=${c.id}`}>New quote</Link>}>
            <DataTable rows={quotes} rowKey={(q) => q.id} compact onRowClick={(q) => nav(`/crm/quotes/${q.id}`)} columns={[
              { key: 'n', header: 'Quote', render: (q) => <Link to={`/crm/quotes/${q.id}`}>{q.number}</Link> },
              { key: 't', header: 'Title', render: (q) => q.title || q.spec?.style_name },
              { key: 's', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
              { key: 'v', header: 'Valid until', render: (q) => day(q.valid_until) },
              { key: 'a', header: 'Total', num: true, render: (q) => money0(q.pricing.total, q.pricing.currency) },
            ]} empty="No quotes." />
          </Card>
          <Card title={`Leads (${leads.length})`} flush>
            <DataTable rows={leads} rowKey={(l) => l.id} compact onRowClick={(l) => nav(`/crm/leads/${l.id}`)} columns={[
              { key: 't', header: 'Lead', render: (l) => <Link to={`/crm/leads/${l.id}`}>{l.title}</Link> },
              { key: 's', header: 'Stage', render: (l) => <StatusBadge status={l.stage} /> },
              { key: 'v', header: 'Value', render: (l) => <LeadValue l={l} currency={currency} /> },
              { key: 'o', header: 'Owner', render: (l) => staffName(l.owner) },
            ]} empty="No leads." />
          </Card>
          <Card title={`Tickets (${tickets.length})`} flush>
            <DataTable rows={tickets} rowKey={(t) => t.id} compact onRowClick={(t) => nav(`/crm/tickets/${t.id}`)} columns={[
              { key: 'n', header: 'Ticket', render: (t) => <Link to={`/crm/tickets/${t.id}`}>{t.number}</Link> },
              { key: 's', header: 'Subject', render: (t) => t.subject },
              { key: 'st', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
              { key: 'u', header: 'Updated', render: (t) => dateTime(t.updated_at) },
            ]} empty="No tickets." />
          </Card>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Profile">
            <dl className="kv" data-testid="customer-contact">
              <dt>Mobile</dt><dd>{c.phone ? <Verified value={c.phone} verified={c.phone_verified} testId="customer-phone" /> : <span className="muted">None</span>}</dd>
              <dt>Email</dt><dd>{c.email ? <Verified value={c.email} verified={c.email_verified} testId="customer-email" /> : <span className="muted">None</span>}</dd>
              <dt>Sign-in</dt><dd>{c.has_password ? 'Code or password' : c.phone_verified || c.email_verified ? 'One-time code' : <span className="muted">Has not signed in</span>}</dd>
              <dt>Organisation</dt><dd>{organisation ? <Link to={`/crm/organisations/${organisation.id}`}>{organisation.name}</Link> : <span className="muted">None</span>}</dd>
              <dt>Owner</dt><dd>{c.owner ? staffName(c.owner) : <span className="muted">Unassigned</span>}</dd>
              <dt>Tags</dt><dd><span className="row tight">{c.tags.length ? c.tags.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">None</span>}</span></dd>
              <dt>Marketing</dt><dd>{c.marketing_opt_in ? <Badge tone="good">Opted in</Badge> : <span className="muted">No</span>}</dd>
              {c.addresses?.length > 0 && <><dt>Addresses</dt><dd>{c.addresses.map((a, i) => <div key={i} className="small">{a.line1}, {a.city} {a.state} {a.pincode}</div>)}</dd></>}
              {c.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</dd></>}
            </dl>
          </Card>
          <Card title="Activity"><ActivityFeed subject={`customer:${c.id}`} items={activities} onChange={d.reload} /></Card>
        </div>
      </div>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void d.reload(); }} />}
      {newLead && <LeadForm preset={{ customer_id: c.id, organisation_id: c.organisation_id, title: `${c.name || c.phone}: ` }} onClose={() => setNewLead(false)} onSaved={(l) => nav(`/crm/leads/${l.id}`)} />}
    </>
  );
}
