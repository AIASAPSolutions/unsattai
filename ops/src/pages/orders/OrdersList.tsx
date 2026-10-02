import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderStatus } from '../../components/domain';
import { PaymentBadge, SellerFilter, SellerLink, useSellerParam } from '../../components/marketplace';
import { IconDownload } from '../../components/icons';
import { Button, Card, Chips, DataTable, ErrorBox, PageHeader, Pager, SearchInput, useToast } from '../../components/ui';
import { download, get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
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
  const { isSeller } = useAuth();
  const [seller, setSeller] = useSellerParam();
  const checkout = params.get('checkout') ?? '';

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  const data = useLoad(() => get<Page<OrderSummary>>('/ops/orders', {
    status: statuses.join(',') || undefined, q: dq || undefined, page, size: SIZE, seller_id: seller || undefined, checkout_id: checkout || undefined,
  }), [statuses.join(','), dq, page, seller, checkout]);
  // Status counts come from the dashboard, which covers every seller; they are left off when filtering by seller.
  const counts = useLoad(() => (isSeller ? Promise.resolve({}) : get<{ orders: { by_status: Record<string, number> } }>('/ops/dashboard').then((d) => d.orders.by_status).catch(() => ({}))), [isSeller]);
  const showCounts = !isSeller && !seller && !checkout;

  const exportCsv = async () => {
    setExporting(true);
    try { await download('/ops/exports/orders.csv', fileStamp('unsattai-orders', 'csv')); } catch (e) { toast.error(e); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Orders" subtitle={isSeller ? 'Orders placed with your unit.' : 'Every order from the web store, the app and sales quotes.'}
        actions={!isSeller && <Button icon={<IconDownload />} onClick={exportCsv} busy={exporting} data-testid="export-csv">Export CSV</Button>} />
      <Card flush>
        <div className="card-body stack">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); if (page !== 1) set({ page: null }); }} placeholder="Search number, customer, phone, team, player…" testId="orders-search" />
            <SellerFilter value={seller} onChange={setSeller} />
            {checkout && <span className="tag">One checkout<button type="button" aria-label="Show all orders" onClick={() => set({ checkout: null })}>×</button></span>}
          </div>
          <Chips multi value={statuses} onChange={(v) => set({ status: v.join(',') || null, page: null })}
            options={FULFILMENT.map((s) => ({ value: s, label: label(s), count: showCounts ? (counts.data as Record<string, number> | undefined)?.[s] ?? 0 : undefined }))} />
        </div>
        {data.error ? <div className="card-body"><ErrorBox error={data.error} onRetry={data.reload} /></div> : (
          <DataTable testId="orders-table" rows={data.data?.items ?? []} rowKey={(o) => o.id} onRowClick={(o) => nav(`/orders/${o.id}`)}
            empty={data.loading ? 'Loading…' : 'No orders match.'}
            columns={[
              { key: 'number', header: 'Order', sort: (o) => o.number, render: (o) => <Link to={`/orders/${o.id}`} className="strong">{o.number ?? o.id}</Link> },
              { key: 'created', header: 'Placed', sort: (o) => o.created_at, render: (o) => <span className="nowrap">{dateTime(o.created_at)}</span> },
              { key: 'customer', header: 'Customer', sort: (o) => o.customer_name, render: (o) => (
                <div><div>{o.customer_id && !isSeller ? <Link to={`/crm/customers/${o.customer_id}`}>{o.customer_name}</Link> : o.customer_name}</div><div className="muted small">{o.phone}</div></div>) },
              { key: 'design', header: 'Design', render: (o) => <div><div>{o.team_name || o.style_name}</div><div className="muted small">{GARMENT_LABEL[o.garment ?? ''] ?? o.garment}</div></div> },
              ...(isSeller ? [] : [{ key: 'seller', header: 'Seller', sort: (o: OrderSummary) => o.seller_name, render: (o: OrderSummary) => <SellerLink id={o.seller_id} name={o.seller_name} /> }]),
              { key: 'status', header: 'Status', sort: (o) => o.fulfilment_status, render: (o) => <span className="row tight"><OrderStatus o={o} /><PaymentBadge o={o} /></span> },
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
