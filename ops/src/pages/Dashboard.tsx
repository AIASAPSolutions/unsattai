import { Link, useNavigate } from 'react-router-dom';
import { OrderStatus } from '../components/domain';
import { IconRefresh } from '../components/icons';
import { Badge, Button, Card, DataTable, ErrorBox, Kpi, Loading, PageHeader } from '../components/ui';
import { get } from '../lib/api';
import { day, money0, num, pct, ago } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { OrderSummary, Plan } from '../lib/types';

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
  const nav = useNavigate();
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
        </div>

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
