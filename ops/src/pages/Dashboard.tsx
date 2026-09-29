import { Link, useNavigate } from 'react-router-dom';
import { OrderStatus } from '../components/domain';
import { PaymentBadge, Stars } from '../components/marketplace';
import { IconRefresh } from '../components/icons';
import { Badge, Button, Card, DataTable, ErrorBox, Kpi, Loading, PageHeader } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRefData } from '../lib/refdata';
import { day, money0, num, pct, ago } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { OrderSummary, Page, Plan, ReturnRec, Seller, SellerDetail } from '../lib/types';

const OPEN = 'awaiting_payment,queued,in_production,ready';

/** Marketplace numbers the dashboard endpoint does not have yet (BACKEND_REQUESTS 13), from the list endpoints. */
function useMarketplace(sellers: Seller[], sellerId?: string) {
  const ids = sellers.map((x) => x.id).join(',');
  return useLoad(async () => {
    const q = sellerId ? { seller_id: sellerId } : {};
    const [waiting, open, cod, bySeller] = await Promise.all([
      get<Page<ReturnRec>>('/ops/returns', { ...q, status: 'requested' }).then((r) => r.total).catch(() => null),
      get<Page<ReturnRec>>('/ops/returns', { ...q, status: 'requested,approved,picked_up' }).then((r) => r.total).catch(() => null),
      get<Page<OrderSummary> & { outstanding: number }>('/ops/cod', { ...q, collected: false }).catch(() => null),
      sellerId ? Promise.resolve([]) : Promise.all(sellers.map(async (x) => {
        const [o, all] = await Promise.all([
          get<Page<OrderSummary>>('/ops/orders', { seller_id: x.id, status: OPEN, size: 1 }).then((r) => r.total).catch(() => null),
          get<Page<OrderSummary>>('/ops/orders', { seller_id: x.id, size: 1 }).then((r) => r.total).catch(() => null),
        ]);
        return { seller: x, open: o, all };
      })),
    ]);
    return { waiting, open, cod, bySeller };
  }, [ids, sellerId], { poll: 60_000 });
}

interface Dash {
  currency: string;
  orders: { today: number; last_7_days: number; by_status: Record<string, number> };
  revenue: { today: number; last_7_days: number; last_30_days: number; average_order_30_days: number };
  production: { active: number; late: number; late_orders: Plan[]; pieces_in_progress: number; bottleneck: string;
    utilisation_7_days: { stage: string; name: string; percent: number }[] };
  delivery: { ready_to_ship: number; ship_today: number };
  crm: { open_pipeline_value: number; win_rate: number | null; open_leads: number; open_tickets: number; tasks_due_today: number; reorder_candidates: number };
  recent_orders: OrderSummary[];
}

export default function Dashboard() {
  const { isSeller } = useAuth();
  return isSeller ? <SellerHome /> : <StaffDashboard />;
}

function StaffDashboard() {
  const nav = useNavigate();
  const { sellers } = useRefData();
  const m = useMarketplace(sellers);
  const d = useLoad(async () => {
    const [dash, plan] = await Promise.all([get<Dash>('/ops/dashboard'), get<{ orders: Plan[] }>('/ops/production/plan').catch(() => ({ orders: [] as Plan[] }))]);
    return { dash, summaries: Object.fromEntries(plan.orders.map((p) => [p.order_id, p.summary])) as Record<string, OrderSummary | undefined> };
  }, [], { poll: 60_000 });

  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const { dash: x, summaries } = d.data;
  const c = x.currency;
  const bottleneck = x.production.utilisation_7_days.find((u) => u.stage === x.production.bottleneck);
  const awaiting = x.orders.by_status.awaiting_payment ?? 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Today at a glance. Refreshes every minute."
        actions={<Button icon={<IconRefresh />} onClick={d.reload} busy={d.loading}>Refresh</Button>} />
      <div className="stack" style={{ gap: 16 }}>
        <div className="kpis" data-testid="kpis">
          <Kpi k="Orders today" v={num(x.orders.today)} s={`${num(x.orders.last_7_days)} in 7 days`} to="/orders" testId="kpi-orders-today" />
          <Kpi k="Revenue today" v={money0(x.revenue.today, c)} s={`${money0(x.revenue.last_7_days, c)} in 7 days`} testId="kpi-revenue-today" />
          <Kpi k="Revenue, 30 days" v={money0(x.revenue.last_30_days, c)} s={`Average order ${money0(x.revenue.average_order_30_days, c)}`} to="/reports" testId="kpi-revenue-30" />
          <Kpi k="Awaiting payment" v={num(awaiting)} s="Placed, not paid" to="/orders?status=awaiting_payment" />
          <Kpi k="Active production" v={num(x.production.active)} s={`${num(x.production.pieces_in_progress)} pieces`} to="/production" testId="kpi-active" />
          <Kpi k="Late orders" v={num(x.production.late)} s="Planned after promise" alert={x.production.late > 0} to="/production" testId="kpi-late" />
          <Kpi k="Ready to ship" v={num(x.delivery.ready_to_ship)} s={`${num(x.delivery.ship_today)} planned to ship today`} to="/delivery" testId="kpi-ready" />
          <Kpi k="Open leads" v={num(x.crm.open_leads)} s={`${money0(x.crm.open_pipeline_value, c)} pipeline · win ${x.crm.win_rate === null ? '—' : pct(x.crm.win_rate)}`} to="/crm/leads" testId="kpi-leads" />
          <Kpi k="Open tickets" v={num(x.crm.open_tickets)} s="Open or pending" to="/crm/tickets" testId="kpi-tickets" />
          <Kpi k="Tasks due" v={num(x.crm.tasks_due_today)} s="Today or overdue" alert={x.crm.tasks_due_today > 0} to="/crm/tasks" testId="kpi-tasks" />
          <Kpi k="Reorder reminders" v={num(x.crm.reorder_candidates)} s="Customers due to reorder" to="/crm/reorders" />
          <Kpi k="Returns awaiting action" v={m.data?.waiting == null ? '…' : num(m.data.waiting)} s={m.data?.open == null ? 'Requested, not decided' : `${num(m.data.open)} open in all`}
            alert={!!m.data?.waiting} to="/returns" testId="kpi-returns" />
          <Kpi k="Cash on delivery to collect" v={m.data?.cod ? money0(m.data.cod.outstanding, c) : '…'} s={m.data?.cod ? `${num(m.data.cod.total)} order${m.data.cod.total === 1 ? '' : 's'}` : 'COD orders not yet paid'} to="/cod" testId="kpi-cod" />
        </div>

        {(m.data?.bySeller.length ?? 0) > 1 && (
          <Card title="Orders by seller" flush actions={<Link to="/sellers">Sellers</Link>}>
            <DataTable rows={m.data!.bySeller} rowKey={(r) => r.seller.id} compact testId="orders-by-seller" onRowClick={(r) => nav(`/orders?seller=${r.seller.id}`)}
              initialSort={{ key: 'open', dir: 'desc' }} columns={[
                { key: 'n', header: 'Seller', sort: (r) => r.seller.name, render: (r) => <Link to={`/sellers/${r.seller.id}`}>{r.seller.name}</Link> },
                { key: 'st', header: '', render: (r) => (!r.seller.active ? <Badge>Switched off</Badge> : null) },
                { key: 'open', header: 'Open orders', num: true, sort: (r) => r.open ?? -1, render: (r) => <Link to={`/orders?seller=${r.seller.id}&status=${OPEN}`}>{num(r.open)}</Link> },
                { key: 'all', header: 'All orders', num: true, sort: (r) => r.all ?? -1, render: (r) => num(r.all) },
                { key: 'r', header: 'Rating', render: (r) => <Stars rating={r.seller.rating} /> },
              ]} />
          </Card>
        )}

        <div className="grid grid-main">
          <Card title="Recent orders" flush actions={<Link to="/orders">All orders</Link>}>
            <DataTable rows={x.recent_orders} rowKey={(o) => o.id} onRowClick={(o) => nav(`/orders/${o.id}`)} compact
              columns={[
                { key: 'number', header: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.number ?? o.id}</Link> },
                { key: 'customer', header: 'Customer', render: (o) => <>{o.customer_name}{o.team_name && <span className="muted"> · {o.team_name}</span>}</> },
                { key: 'status', header: 'Status', render: (o) => <OrderStatus o={o} /> },
                { key: 'pieces', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
                { key: 'total', header: 'Total', num: true, render: (o) => money0(o.total, o.currency || c) },
                { key: 'at', header: 'Placed', render: (o) => <span className="muted">{ago(o.created_at)}</span> },
              ]} empty="No orders yet." />
          </Card>

          <Card title="Utilisation, next 7 working days" actions={<Link to="/production/capacity">Capacity</Link>}>
            <div className="stack" style={{ gap: 10 }} data-testid="utilisation">
              {x.production.utilisation_7_days.map((u) => {
                const hot = u.stage === x.production.bottleneck;
                return (
                  <div key={u.stage} title={`${u.name}: ${u.percent}% of capacity on average`}>
                    <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 3 }}>
                      <span className={`ellipsis ${hot ? 'strong' : ''}`} style={{ flex: 1 }}>{u.name}</span>
                      {hot && <Badge tone="bad">Bottleneck</Badge>}
                      <span className="num strong" style={{ width: 44 }}>{u.percent}%</span>
                    </div>
                    <div className={`util-bar ${hot ? 'hot' : ''}`}><div style={{ width: `${Math.min(100, Math.max(u.percent, u.percent > 0 ? 1 : 0))}%` }} /></div>
                  </div>
                );
              })}
            </div>
            {bottleneck && <p className="muted small" style={{ marginBottom: 0 }}>The bottleneck is the stage with the highest planned load against its capacity. Raise its capacity in Settings → Production, or move work.</p>}
          </Card>
        </div>

        <Card title={<>Late orders {x.production.late > 0 && <Badge tone="bad">{x.production.late}</Badge>}</>} flush>
          <DataTable rows={x.production.late_orders} rowKey={(p) => p.order_id} onRowClick={(p) => nav(`/orders/${p.order_id}`)} compact
            columns={[
              { key: 'order', header: 'Order', render: (p) => <Link to={`/orders/${p.order_id}`}>{summaries[p.order_id]?.number ?? p.order_id}</Link> },
              { key: 'customer', header: 'Customer', render: (p) => summaries[p.order_id]?.customer_name ?? '—' },
              { key: 'pieces', header: 'Pieces', num: true, render: (p) => num(p.pieces) },
              { key: 'promised', header: 'Promised', render: (p) => day(p.promised_delivery_date) },
              { key: 'planned', header: 'Planned delivery', render: (p) => <span className="bad-text strong">{day(p.delivery_date)}</span> },
              { key: 'ship', header: 'Ship', render: (p) => day(p.ship_date) },
              { key: 'rush', header: '', render: (p) => p.rush && <Badge tone="warn">Rush</Badge> },
            ]} empty="No late orders. Everything is planned to arrive on time." />
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ a seller login's home

function SellerHome() {
  const nav = useNavigate();
  const { sellerId } = useAuth();
  const { sellers, currency } = useRefData();
  const me = sellers.find((x) => x.id === sellerId);
  const m = useMarketplace(me ? [me] : [], sellerId ?? undefined);
  const d = useLoad(async () => {
    const [det, work, plan] = await Promise.all([
      get<SellerDetail>(`/ops/sellers/${sellerId}`),
      get<Page<OrderSummary>>('/ops/orders', { status: 'queued,in_production,ready', size: 50 }),
      get<{ orders: Plan[] }>('/ops/production/plan').catch(() => ({ orders: [] as Plan[] })),
    ]);
    return { det, work: work.items, late: plan.orders.filter((p) => p.late) };
  }, [sellerId], { poll: 60_000 });
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const by = d.data.det.orders_by_status;
  return (
    <>
      <PageHeader title={`Welcome, ${d.data.det.seller.name}`} subtitle="Your orders, what to make next and what to ship. Refreshes every minute."
        actions={<Button icon={<IconRefresh />} onClick={() => { void d.reload(); void m.reload(); }} busy={d.loading}>Refresh</Button>} />
      <div className="stack" style={{ gap: 16 }}>
        <div className="kpis" data-testid="kpis">
          <Kpi k="To start" v={num(by.queued ?? 0)} s="Paid, waiting for production" to="/production/board" testId="kpi-seller-queued" />
          <Kpi k="In production" v={num(by.in_production ?? 0)} to="/production/board" />
          <Kpi k="Ready to ship" v={num(by.ready ?? 0)} to="/delivery/ready" />
          <Kpi k="Late" v={num(d.data.late.length)} s="Planned after the promise" alert={d.data.late.length > 0} to="/production/plan" />
          <Kpi k="Returns to handle" v={m.data?.open == null ? '…' : num(m.data.open)} s={m.data?.waiting ? `${num(m.data.waiting)} waiting for a decision` : 'Open returns'} alert={!!m.data?.waiting} to="/returns" />
          <Kpi k="Cash to collect" v={m.data?.cod ? money0(m.data.cod.outstanding, currency) : '…'} s="Cash on delivery" to="/cod" />
          <Kpi k="Delivered" v={num(by.delivered ?? 0)} s="All time" />
        </div>
        <Card title="Orders to work on" flush actions={<Link to="/orders">All orders</Link>}>
          <DataTable rows={d.data.work} rowKey={(o) => o.id} onRowClick={(o) => nav(`/orders/${o.id}`)} compact testId="seller-work"
            initialSort={{ key: 'prom', dir: 'asc' }} columns={[
              { key: 'n', header: 'Order', render: (o) => <Link to={`/orders/${o.id}`}>{o.number}</Link> },
              { key: 'c', header: 'Customer', render: (o) => <>{o.customer_name}{o.team_name && <span className="muted"> · {o.team_name}</span>}</> },
              { key: 's', header: 'Status', render: (o) => <span className="row tight"><OrderStatus o={o} /><PaymentBadge o={o} /></span> },
              { key: 'p', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
              { key: 'prom', header: 'Promised', sort: (o) => o.promised_delivery_date, render: (o) => day(o.promised_delivery_date) },
            ]} empty="Nothing to make right now." />
        </Card>
      </div>
    </>
  );
}
