import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconPlus } from '../../components/icons';
import { Button, Card, Chips, DataTable, ErrorBox, PageHeader, SearchInput, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, label, money0, num } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { QUOTE_STATUSES, type Quote } from '../../lib/types';

export default function Quotes() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { who } = useRefData();
  const [status, setStatus] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const d = useLoad(() => get<{ items: Quote[]; total: number }>('/ops/quotes', { status: status[0], q: dq || undefined }), [status[0], dq]);
  return (
    <>
      <PageHeader title="Quotes" subtitle="Priced offers the customer accepts online at the web store link."
        actions={can('quotes') && <Button variant="primary" icon={<IconPlus />} onClick={() => nav('/crm/quotes/new')} data-testid="new-quote">New quote</Button>} />
      <Card flush>
        <div className="card-body stack">
          <SearchInput value={q} onChange={setQ} placeholder="Search number, title, customer…" />
          <Chips value={status} onChange={setStatus} options={QUOTE_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        </div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable rows={d.data?.items ?? []} rowKey={(x) => x.id} onRowClick={(x) => nav(`/crm/quotes/${x.id}`)} testId="quotes-table"
            empty={d.loading ? 'Loading…' : 'No quotes.'} initialSort={{ key: 'upd', dir: 'desc' }} columns={[
              { key: 'n', header: 'Quote', sort: (x) => x.number, render: (x) => <Link to={`/crm/quotes/${x.id}`} className="strong">{x.number}</Link> },
              { key: 't', header: 'Title', render: (x) => x.title || x.spec?.style_name },
              { key: 'c', header: 'Customer', sort: (x) => x.customer.name, render: (x) => <Link to={`/crm/customers/${x.customer_id}`}>{x.customer.name || x.customer.phone}</Link> },
              { key: 's', header: 'Status', sort: (x) => x.status, render: (x) => <StatusBadge status={x.status} /> },
              { key: 'p', header: 'Pieces', num: true, render: (x) => num(x.pricing.pieces) },
              { key: 'tot', header: 'Total', num: true, sort: (x) => x.pricing.total, render: (x) => money0(x.pricing.total, x.pricing.currency) },
              { key: 'v', header: 'Valid until', sort: (x) => x.valid_until, render: (x) => day(x.valid_until) },
              { key: 'by', header: 'By', render: (x) => who(x.created_by) },
              { key: 'upd', header: 'Updated', sort: (x) => x.updated_at, render: (x) => <span className="muted small nowrap">{dateTime(x.updated_at)}</span> },
            ]} />
        )}
      </Card>
    </>
  );
}
