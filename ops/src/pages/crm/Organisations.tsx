import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OrganisationForm } from '../../components/crm';
import { IconPlus } from '../../components/icons';
import { Button, Card, DataTable, ErrorBox, PageHeader, Pager, SearchInput, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { label } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Organisation, Page } from '../../lib/types';

export default function Organisations() {
  const nav = useNavigate();
  const { can } = useAuth();
  const { staffName } = useRefData();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const d = useLoad(() => get<Page<Organisation>>('/ops/organisations', { q: dq || undefined, page }), [dq, page]);
  return (
    <>
      <PageHeader title="Organisations" subtitle="Teams, clubs, schools, colleges and companies that buy together."
        actions={can('crm') && <Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)} data-testid="new-org">New organisation</Button>} />
      <Card flush>
        <div className="card-body"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, city, kind, tag…" /></div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable rows={d.data?.items ?? []} rowKey={(o) => o.id} onRowClick={(o) => nav(`/crm/organisations/${o.id}`)}
            empty={d.loading ? 'Loading…' : 'No organisations yet.'} columns={[
              { key: 'n', header: 'Name', sort: (o) => o.name, render: (o) => <Link to={`/crm/organisations/${o.id}`} className="strong">{o.name}</Link> },
              { key: 'k', header: 'Kind', sort: (o) => o.kind, render: (o) => label(o.kind) },
              { key: 'c', header: 'City', sort: (o) => o.city, render: (o) => [o.city, o.state].filter(Boolean).join(', ') || '—' },
              { key: 'p', header: 'Contact', render: (o) => [o.phone, o.email].filter(Boolean).join(' · ') || '—' },
              { key: 'o', header: 'Owner', render: (o) => (o.owner ? staffName(o.owner) : '—') },
              { key: 't', header: 'Tags', render: (o) => <span className="row tight">{o.tags.map((t) => <span key={t} className="tag">{t}</span>)}</span> },
              { key: 's', header: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            ]} />
        )}
        {d.data && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="organisations" />}
      </Card>
      {creating && <OrganisationForm onClose={() => setCreating(false)} onSaved={(o) => nav(`/crm/organisations/${o.id}`)} />}
    </>
  );
}
