import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Stars } from '../../components/marketplace';
import { IconPlus } from '../../components/icons';
import { Badge, Button, Card, Chips, DataTable, ErrorBox, PageHeader, SearchInput, StatusBadge } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { GARMENT_LABEL, num, pct } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { coverageSummary } from '../../lib/sellerForm';
import type { Page, OrderSummary, Seller } from '../../lib/types';

const OPEN = 'awaiting_payment,queued,in_production,ready';

export default function SellersList() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState<string[]>([]);
  const d = useLoad(() => get<{ items: Seller[]; total: number }>('/ops/sellers', { q: dq || undefined, status: status[0] }), [dq, status.join(',')]);
  // Open orders per seller: one small count query each (the list endpoint has no counts yet; BACKEND_REQUESTS 13).
  const ids = (d.data?.items ?? []).map((s) => s.id).join(',');
  const counts = useLoad(async () => {
    const out: Record<string, number> = {};
    await Promise.all((d.data?.items ?? []).map(async (s) => {
      const r = await get<Page<OrderSummary>>('/ops/orders', { seller_id: s.id, status: OPEN, size: 1 }).catch(() => null);
      if (r) out[s.id] = r.total;
    }));
    return out;
  }, [ids]);

  return (
    <>
      <PageHeader title="Sellers" subtitle="Production partners, including the house unit. Each has its own delivery coverage, capacity, garments, price and cash on delivery."
        actions={can('settings') && <Button variant="primary" icon={<IconPlus />} onClick={() => nav('/sellers/new')} data-testid="new-seller">New seller</Button>} />
      <Card flush>
        <div className="card-body row">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, legal name, GSTIN, city…" testId="seller-search" />
          <Chips value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Switched off' }]} />
        </div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="sellers-table" rows={d.data?.items ?? []} rowKey={(s) => s.id} onRowClick={(s) => nav(`/sellers/${s.id}`)}
            empty={d.loading ? 'Loading…' : q || status.length ? 'No sellers match.' : 'No sellers yet.'}
            columns={[
              { key: 'name', header: 'Seller', sort: (s) => s.name, render: (s) => (
                <div>
                  <Link to={`/sellers/${s.id}`} className="strong">{s.name}</Link> {s.house && <Badge tone="accent">House</Badge>}
                  <div className="muted small">{[s.address?.city, s.address?.state].filter(Boolean).join(', ') || s.legal_name || s.id}</div>
                </div>) },
              { key: 'status', header: 'Status', sort: (s) => String(s.active), render: (s) => <StatusBadge status={s.active ? 'active' : 'inactive'} text={s.active ? 'Active' : 'Switched off'} /> },
              { key: 'coverage', header: 'Coverage', render: (s) => (
                <div className="small" style={{ maxWidth: 320 }} title={s.service_areas.map((a) => `${a.match}: ${a.transit_days} days${a.cod ? ', COD' : ''}`).join('\n')}>
                  {coverageSummary(s.service_areas, s.blocked_pincodes.length)}
                </div>) },
              { key: 'makes', header: 'Makes', render: (s) => <span className="small">{s.garments.map((g) => GARMENT_LABEL[g] ?? g).join(', ')}</span> },
              { key: 'cap', header: 'Capacity', sort: (s) => s.capacity_factor, render: (s) => (
                <div className="small nowrap">×{s.capacity_factor}{s.handling_days ? ` · +${s.handling_days}d handling` : ''}
                  <div className="muted">{num(s.min_pieces)}–{num(s.max_pieces)} pcs</div></div>) },
              { key: 'price', header: 'Price', sort: (s) => s.price_adjust, render: (s) => (s.price_adjust ? <span className="small">{s.price_adjust > 0 ? '+' : '−'}{pct(Math.abs(s.price_adjust), 1)}</span> : <span className="muted small">Price book</span>) },
              { key: 'rating', header: 'Rating', sort: (s) => s.rating?.average ?? -1, render: (s) => <Stars rating={s.rating} /> },
              { key: 'open', header: 'Open orders', num: true, sort: (s) => counts.data?.[s.id] ?? -1, render: (s) => (
                counts.data?.[s.id] === undefined ? <span className="muted">…</span> : <Link to={`/orders?seller=${s.id}`}>{num(counts.data[s.id])}</Link>) },
            ]} />
        )}
      </Card>
    </>
  );
}
