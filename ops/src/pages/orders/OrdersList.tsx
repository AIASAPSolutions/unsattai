import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderStatus } from '../../components/domain';
import { IconDownload } from '../../components/icons';
import { Button, Card, Chips, DataTable, ErrorBox, PageHeader, Pager, SearchInput, useToast } from '../../components/ui';
import { download, get } from '../../lib/api';
import { day, dateTime, fileStamp, GARMENT_LABEL, label, money0, num } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { FULFILMENT, type OrderSummary, type Page } from '../../lib/types';

const SIZE = 25;

export default function OrdersList() {
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q);
  const statuses = (params.get('status') ?? '').split(',').filter(Boolean);
  const page = Number(params.get('page') ?? 1) || 1;
  const [exporting, setExporting] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const data = useLoad(() => get<Page<OrderSummary>>('/ops/orders', { status: statuses.join(',') || undefined, q: dq || undefined, page, size: SIZE }),
    [statuses.join(','), dq, page]);
  const counts = useLoad(() => get<{ orders: { by_status: Record<string, number> } }>('/ops/dashboard').then((d) => d.orders.by_status).catch(() => ({})), []);

  const exportCsv = async () => {
    setExporting(true);
    try { await download('/ops/exports/orders.csv', fileStamp('urjersey-orders', 'csv')); } catch (e) { toast.error(e); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order from the web store, the app and sales quotes."
        actions={<Button icon={<IconDownload />} onClick={exportCsv} busy={exporting} data-testid="export-csv">Export CSV</Button>} />
      <Card flush>
        <div className="card-body stack">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); if (page !== 1) set({ page: null }); }} placeholder="Search number, customer, phone, team, player…" testId="orders-search" />
          </div>
          <Chips multi value={statuses} onChange={(v) => set({ status: v.join(',') || null, page: null })}
            options={FULFILMENT.map((s) => ({ value: s, label: label(s), count: (counts.data as Record<string, number> | undefined)?.[s] ?? 0 }))} />
        </div>
        {data.error ? <div className="card-body"><ErrorBox error={data.error} onRetry={data.reload} /></div> : (
          <DataTable testId="orders-table" rows={data.data?.items ?? []} rowKey={(o) => o.id} onRowClick={(o) => nav(`/orders/${o.id}`)}
            empty={data.loading ? 'Loading…' : 'No orders match.'}
            columns={[
              { key: 'number', header: 'Order', sort: (o) => o.number, render: (o) => <Link to={`/orders/${o.id}`} className="strong">{o.number ?? o.id}</Link> },
              { key: 'created', header: 'Placed', sort: (o) => o.created_at, render: (o) => <span className="nowrap">{dateTime(o.created_at)}</span> },
              { key: 'customer', header: 'Customer', sort: (o) => o.customer_name, render: (o) => (
                <div><div>{o.customer_id ? <Link to={`/crm/customers/${o.customer_id}`}>{o.customer_name}</Link> : o.customer_name}</div><div className="muted small">{o.phone}</div></div>) },
              { key: 'design', header: 'Design', render: (o) => <div><div>{o.team_name || o.style_name}</div><div className="muted small">{GARMENT_LABEL[o.garment ?? ''] ?? o.garment}</div></div> },
              { key: 'status', header: 'Status', sort: (o) => o.fulfilment_status, render: (o) => <OrderStatus o={o} /> },
              { key: 'promised', header: 'Promised', sort: (o) => o.promised_delivery_date, render: (o) => day(o.promised_delivery_date) },
              { key: 'channel', header: 'Channel', sort: (o) => o.channel, render: (o) => label(o.channel) },
              { key: 'pieces', header: 'Pieces', num: true, sort: (o) => o.pieces, render: (o) => num(o.pieces) },
              { key: 'total', header: 'Total', num: true, sort: (o) => o.total, render: (o) => money0(o.total, o.currency) },
            ]} />
        )}
        {data.data && <Pager page={data.data.page} pages={data.data.pages} total={data.data.total} noun="orders" onPage={(p) => set({ page: p > 1 ? String(p) : null })} />}
      </Card>
    </>
  );
}
