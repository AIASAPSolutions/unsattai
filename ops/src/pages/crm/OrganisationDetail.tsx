import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActivityFeed, LeadForm, LeadValue, OrganisationForm } from '../../components/crm';
import { OrderStatus } from '../../components/domain';
import { IconPlus } from '../../components/icons';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { day, label, money0, num } from '../../lib/format';
import { useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Activity, Customer, Lead, OrderSummary, Organisation } from '../../lib/types';

interface Detail { organisation: Organisation; members: Customer[]; leads: Lead[]; activities: Activity[]; orders: OrderSummary[] }

export default function OrganisationDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const { currency, staffName } = useRefData();
  const d = useLoad(() => get<Detail>(`/ops/organisations/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [newLead, setNewLead] = useState(false);
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const { organisation: o, members, leads, activities, orders } = d.data;
  const ltv = members.reduce((a, m) => a + (m.lifetime_value || 0), 0);
  return (
    <>
      <PageHeader crumbs={<><Link to="/crm/organisations">Organisations</Link> / {o.name}</>}
        title={<span className="row">{o.name} <StatusBadge status={o.status} /></span>}
        subtitle={<>{label(o.kind)}{o.city && ` · ${o.city}`}{o.state && `, ${o.state}`}{o.phone && ` · ${o.phone}`}{o.email && ` · ${o.email}`}</>}
        actions={can('crm') && <><Button onClick={() => setEditing(true)}>Edit</Button><Button variant="primary" icon={<IconPlus />} onClick={() => setNewLead(true)}>Lead</Button></>} />
      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <div className="kpis">
            <div className="kpi"><div className="k">Members</div><div className="v">{members.length}</div></div>
            <div className="kpi"><div className="k">Orders</div><div className="v">{orders.length}</div></div>
            <div className="kpi"><div className="k">Lifetime value</div><div className="v">{money0(ltv, currency)}</div></div>
            <div className="kpi"><div className="k">Open leads</div><div className="v">{leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length}</div></div>
          </div>
          <Card title="Members" flush>
            <DataTable rows={members} rowKey={(m) => m.id} compact onRowClick={(m) => nav(`/crm/customers/${m.id}`)} columns={[
              { key: 'n', header: 'Name', render: (m) => <Link to={`/crm/customers/${m.id}`}>{m.name || 'No name'}</Link> },
              { key: 'p', header: 'Phone', render: (m) => m.phone },
              { key: 'o', header: 'Orders', num: true, render: (m) => num(m.orders_count) },
              { key: 'v', header: 'Value', num: true, render: (m) => money0(m.lifetime_value, currency) },
            ]} empty="No members. Link customers to this organisation from their profile." />
          </Card>
          <Card title="Orders" flush>
            <DataTable rows={orders} rowKey={(x) => x.id} compact onRowClick={(x) => nav(`/orders/${x.id}`)} columns={[
              { key: 'n', header: 'Order', render: (x) => <Link to={`/orders/${x.id}`}>{x.number}</Link> },
              { key: 'c', header: 'Customer', render: (x) => x.customer_name },
              { key: 'd', header: 'Placed', render: (x) => day(x.created_at) },
              { key: 's', header: 'Status', render: (x) => <OrderStatus o={x} /> },
              { key: 't', header: 'Total', num: true, render: (x) => money0(x.total, x.currency) },
            ]} empty="No orders." />
          </Card>
          <Card title="Leads" flush>
            <DataTable rows={leads} rowKey={(l) => l.id} compact onRowClick={(l) => nav(`/crm/leads/${l.id}`)} columns={[
              { key: 't', header: 'Lead', render: (l) => <Link to={`/crm/leads/${l.id}`}>{l.title}</Link> },
              { key: 's', header: 'Stage', render: (l) => <StatusBadge status={l.stage} /> },
              { key: 'v', header: 'Value', render: (l) => <LeadValue l={l} currency={currency} /> },
              { key: 'o', header: 'Owner', render: (l) => staffName(l.owner) },
            ]} empty="No leads." />
          </Card>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Details">
            <dl className="kv">
              <dt>Owner</dt><dd>{o.owner ? staffName(o.owner) : <span className="muted">Unassigned</span>}</dd>
              <dt>Tags</dt><dd><span className="row tight">{o.tags.length ? o.tags.map((t) => <span key={t} className="tag">{t}</span>) : <span className="muted">None</span>}</span></dd>
              {o.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{o.notes}</dd></>}
            </dl>
          </Card>
          <Card title="Activity"><ActivityFeed subject={`organisation:${o.id}`} items={activities} onChange={d.reload} /></Card>
        </div>
      </div>
      {editing && <OrganisationForm org={o} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void d.reload(); }} />}
      {newLead && <LeadForm preset={{ organisation_id: o.id, title: `${o.name}: ` }} onClose={() => setNewLead(false)} onSaved={(l) => nav(`/crm/leads/${l.id}`)} />}
    </>
  );
}
