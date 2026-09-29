import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerForm } from '../../components/crm';
import { IconPlus } from '../../components/icons';
import { Badge, Button, Card, DataTable, ErrorBox, PageHeader, Pager, SearchInput, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { day, label, money0, num } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Customer, Page } from '../../lib/types';

export default function Customers() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { currency, staffName } = useRefData();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const d = useLoad(() => get<Page<Customer>>('/ops/customers', { q: dq || undefined, page }), [dq, page]);
  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who ordered, signed in, enquired or was added by sales. Matched by verified mobile number or email."
        actions={can('crm') && <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)}>New customer</Button>} />
      <Card flush>
        <div className="card-body"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, phone, email, tag…" testId="customer-search" /></div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable rows={d.data?.items ?? []} rowKey={(c) => c.id} onRowClick={(c) => nav(`/crm/customers/${c.id}`)} testId="customers-table"
            empty={d.loading ? 'Loading…' : 'No customers match.'} columns={[
              { key: 'name', header: 'Customer', sort: (c) => c.name, render: (c) => <div><Link to={`/crm/customers/${c.id}`} className="strong">{c.name || 'No name'}</Link><div className="muted small">{c.phone}{c.email && ` · ${c.email}`}</div></div> },
              { key: 'verified', header: 'Signed in with', render: (c) => (
                <span className="row tight">
                  {c.phone_verified && <Badge tone="good" title={`Mobile ${c.phone} verified`}>Mobile</Badge>}
                  {c.email_verified && <Badge tone="good" title={`Email ${c.email} verified`}>Email</Badge>}
                  {c.has_password && <Badge title="Has set a password">Password</Badge>}
                  {!c.phone_verified && !c.email_verified && <span className="muted small">Not verified</span>}
                </span>) },
              { key: 'tags', header: 'Tags', render: (c) => <span className="row tight">{c.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span> },
              { key: 'source', header: 'Source', sort: (c) => c.source, render: (c) => label(c.source) },
              { key: 'owner', header: 'Owner', render: (c) => (c.owner ? staffName(c.owner) : <span className="muted">—</span>) },
              { key: 'orders', header: 'Orders', num: true, sort: (c) => c.orders_count, render: (c) => num(c.orders_count) },
              { key: 'ltv', header: 'Lifetime value', num: true, sort: (c) => c.lifetime_value, render: (c) => money0(c.lifetime_value, currency) },
              { key: 'last', header: 'Last order', sort: (c) => c.last_order_at, render: (c) => day(c.last_order_at) },
              { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
            ]} />
        )}
        {d.data && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="customers" />}
      </Card>
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(c) => nav(`/crm/customers/${c.id}`)} />}
    </>
  );
}
