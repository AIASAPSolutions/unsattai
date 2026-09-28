import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { OrderFlags } from '../../components/domain';
import { IconPrint, IconTruck } from '../../components/icons';
import {
  Alert, Badge, Button, Card, Chips, DataTable, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Pager, SearchInput, StatusBadge, Tabs, useToast,
} from '../../components/ui';
import { get, openHtml, patch, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, isoDate, label, num } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { SHIPMENT_STATUSES, type OrderSummary, type Page, type Shipment } from '../../lib/types';

export default function Delivery() {
  return (
    <>
      <PageHeader title="Delivery" subtitle="Dispatch plan, shipments and labels." />
      <Tabs tabs={[{ to: '/delivery/plan', label: 'Dispatch plan' }, { to: '/delivery/ready', label: 'Ready to ship' }, { to: '/delivery/shipments', label: 'Shipments' }]} />
      <Routes>
        <Route index element={<Navigate to="plan" replace />} />
        <Route path="plan" element={<DispatchPlan />} />
        <Route path="ready" element={<ReadyToShip />} />
        <Route path="shipments" element={<Shipments />} />
      </Routes>
    </>
  );
}

// ------------------------------------------------------------------ dispatch plan

interface DPlan { today: string; days: { date: string; pieces: number; zones: Record<string, number>; orders: { id: string; number?: string; customer: string; pieces: number; zone: string;
  method?: string; ready: boolean; rush?: boolean; promised_delivery_date?: string | null; city?: string }[] }[] }

function DispatchPlan() {
  const [days, setDays] = useState(7);
  const d = useLoad(() => get<DPlan>('/ops/delivery/plan', { days }), [days]);
  const { settings } = useRefData();
  const zoneName = (z: string) => (z === 'pickup' ? 'Pickup' : settings?.delivery.value.zones.find((x) => x.id === z)?.name ?? z);
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <span className="muted">Orders are planned to ship on the first dispatch day after they are ready. Ready orders count for today.</span>
        <span style={{ flex: 1 }} />
        <select className="sm" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Horizon">
          {[3, 7, 14, 30].map((n) => <option key={n} value={n}>Next {n} days</option>)}
        </select>
      </div>
      {!d.data.days.length && <Card><Empty title="Nothing to dispatch">No ready or planned orders in this period.</Empty></Card>}
      {d.data.days.map((x) => (
        <Card key={x.date} title={<>{day(x.date, true)} {x.date === d.data!.today && <Badge tone="accent">Today</Badge>}</>}
          actions={<span className="muted small">{x.orders.length} orders · {num(x.pieces)} pieces</span>} flush>
          <div className="card-body row" style={{ paddingBottom: 0 }}>
            {Object.entries(x.zones).map(([z, n]) => <Badge key={z} tone="info">{zoneName(z)}: {n}</Badge>)}
          </div>
          <DataTable rows={x.orders} rowKey={(o) => o.id} compact columns={[
            { key: 'n', header: 'Order', render: (o) => <span className="row tight"><Link to={`/orders/${o.id}`}>{o.number}</Link><OrderFlags o={{ rush: o.rush }} /></span> },
            { key: 'c', header: 'Customer', render: (o) => o.customer },
            { key: 'z', header: 'Zone', render: (o) => zoneName(o.zone) },
            { key: 'city', header: 'City', render: (o) => o.city || '—' },
            { key: 'p', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
            { key: 'prom', header: 'Promised', render: (o) => day(o.promised_delivery_date) },
            { key: 's', header: 'State', render: (o) => (o.ready ? <Badge tone="good">Ready</Badge> : <Badge>In production</Badge>) },
          ]} />
        </Card>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ ready to ship

function ReadyToShip() {
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useAuth();
  const d = useLoad(async () => {
    const [orders, ships] = await Promise.all([
      get<Page<OrderSummary>>('/ops/orders', { status: 'ready', size: 200 }),
      get<Page<Shipment>>('/ops/shipments', { status: 'planned,packed' }),
    ]);
    return { orders: orders.items, open: new Map(ships.items.map((s) => [s.order_id, s])) };
  }, []);
  const [target, setTarget] = useState<OrderSummary | null>(null);
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const canShip = can('delivery');
  return (
    <>
      {!canShip && <div style={{ marginBottom: 12 }}><Alert>Your role can see ready orders but cannot create shipments.</Alert></div>}
      <Card title="Orders ready to ship" flush>
        <DataTable rows={d.data.orders} rowKey={(o) => o.id} testId="ready-table" columns={[
          { key: 'n', header: 'Order', render: (o) => <span className="row tight"><Link to={`/orders/${o.id}`} className="strong">{o.number}</Link><OrderFlags o={o} /></span> },
          { key: 'c', header: 'Customer', render: (o) => o.customer_name },
          { key: 'p', header: 'Pieces', num: true, render: (o) => num(o.pieces) },
          { key: 'prom', header: 'Promised', sort: (o) => o.promised_delivery_date, render: (o) => day(o.promised_delivery_date) },
          { key: 's', header: 'Shipment', render: (o) => {
            const s = d.data!.open.get(o.id);
            return s ? <span className="row tight"><StatusBadge status={s.status} /><button className="linklike small" onClick={() => nav('/delivery/shipments')}>{s.carrier_name} {s.tracking_no}</button></span>
              : <Button size="sm" variant="primary" icon={<IconTruck />} disabled={!canShip} onClick={() => setTarget(o)} data-testid="create-shipment">Create shipment</Button>;
          } },
        ]} empty="No orders are ready. Orders arrive here when every production stage is done." />
      </Card>
      {target && <ShipmentDialog order={target} onClose={() => setTarget(null)} onDone={async () => { setTarget(null); toast.success('Shipment created.'); await d.reload(); }} />}
    </>
  );
}

function ShipmentDialog({ order, onClose, onDone }: { order: OrderSummary; onClose: () => void; onDone: () => void }) {
  const { settings } = useRefData();
  const toast = useToast();
  const carriers = (settings?.delivery.value.carriers ?? []).filter((c) => c.active);
  const [carrier, setCarrier] = useState(carriers[0]?.id ?? '');
  const [tracking, setTracking] = useState('');
  const [planned, setPlanned] = useState(isoDate());
  const { busy, run } = useAction();
  const tpl = carriers.find((c) => c.id === carrier)?.tracking_url;
  return (
    <Modal open title={`Create shipment for ${order.number}`} onClose={onClose} testId="shipment-dialog"
      footer={<><Button onClick={onClose}>Close</Button>
        <Button variant="primary" busy={!!busy} disabled={!carrier} data-testid="shipment-submit"
          onClick={() => run('s', async () => { await post(`/ops/orders/${order.id}/shipments`, { carrier, tracking_no: tracking.trim(), planned_date: planned || null }); onDone(); }, toast.error)}>Create shipment</Button></>}>
      <div className="muted">{order.customer_name} · {num(order.pieces)} pieces</div>
      {!carriers.length && <Alert tone="warn">No active carriers. Add one in Settings → Delivery.</Alert>}
      <div className="form-grid">
        <Field label="Carrier">
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)} data-testid="shipment-carrier">
            {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Tracking number" hint={tpl ? `Tracking link: ${tpl}` : 'Can be added later.'}>
          <input value={tracking} maxLength={60} onChange={(e) => setTracking(e.target.value)} data-testid="shipment-tracking" />
        </Field>
        <Field label="Planned dispatch"><input type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ shipments

const NEXT: Record<string, string | undefined> = { planned: 'packed', packed: 'dispatched', dispatched: 'delivered' };

function Shipments() {
  const toast = useToast();
  const { can } = useAuth();
  const [status, setStatus] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const d = useLoad(() => get<Page<Shipment>>('/ops/shipments', { status: status.join(',') || undefined, q: dq || undefined, page }), [status.join(','), dq, page]);
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Shipment | null>(null);
  const canShip = can('delivery');

  const move = (s: Shipment, to: string, tracking?: string) => run(s.id, async () => {
    await patch(`/ops/shipments/${s.id}`, { status: to, tracking_no: tracking });
    toast.success(`${s.order_number}: ${label(to)}.`);
    setEdit(null);
    await d.reload();
  }, toast.error);

  const rows = useMemo(() => d.data?.items ?? [], [d.data]);
  return (
    <Card flush>
      <div className="card-body stack">
        <div className="row"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, tracking number, customer…" /></div>
        <Chips multi value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={SHIPMENT_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        {!canShip && <Alert>Your role can view shipments but not update them.</Alert>}
      </div>
      {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
        <DataTable rows={rows} rowKey={(s) => s.id} testId="shipments-table" empty={d.loading ? 'Loading…' : 'No shipments.'} columns={[
          { key: 'o', header: 'Order', sort: (s) => s.order_number, render: (s) => <Link to={`/orders/${s.order_id}`} className="strong">{s.order_number}</Link> },
          { key: 'c', header: 'Customer', sort: (s) => s.customer_name, render: (s) => <div>{s.customer_name}<div className="muted small">{s.address ? `${s.address.city}, ${s.address.state} ${s.address.pincode}` : label(s.method)}</div></div> },
          { key: 'carrier', header: 'Carrier', render: (s) => <div>{s.carrier_name}<div className="small">{s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer">{s.tracking_no}</a> : s.tracking_no || <span className="muted">No tracking</span>}</div></div> },
          { key: 'p', header: 'Pieces', num: true, render: (s) => num(s.pieces) },
          { key: 'st', header: 'Status', sort: (s) => s.status, render: (s) => <StatusBadge status={s.status} /> },
          { key: 'at', header: 'Updated', sort: (s) => s.updated_at, render: (s) => <span className="small muted nowrap">{dateTime(s.delivered_at || s.dispatched_at || s.packed_at || s.updated_at)}</span> },
          { key: 'act', header: '', render: (s) => (
            <div className="row tight" style={{ flexWrap: 'nowrap' }}>
              {canShip && NEXT[s.status] && <Button size="xs" variant="primary" busy={busy === s.id} onClick={() => move(s, NEXT[s.status]!)} data-testid={`ship-${NEXT[s.status]}`}>Mark {NEXT[s.status]}</Button>}
              {canShip && <Button size="xs" onClick={() => setEdit(s)}>Update</Button>}
              <Button size="xs" icon={<IconPrint />} onClick={() => run(`l${s.id}`, () => openHtml(`/ops/shipments/${s.id}/label`, `Label ${s.order_number}`), toast.error)} data-testid="label">Label</Button>
            </div>) },
        ]} />
      )}
      {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="shipments" />}
      {edit && <UpdateDialog s={edit} busy={busy === edit.id} onClose={() => setEdit(null)} onSave={(to, t) => move(edit, to, t)} />}
    </Card>
  );
}

function UpdateDialog({ s, onClose, onSave, busy }: { s: Shipment; busy: boolean; onClose: () => void; onSave: (status: string, tracking: string) => void }) {
  const [status, setStatus] = useState<string>(s.status);
  const [tracking, setTracking] = useState(s.tracking_no);
  return (
    <Modal open title={`Shipment for ${s.order_number}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={busy} onClick={() => onSave(status, tracking)}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>{SHIPMENT_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></Field>
        <Field label="Tracking number"><input value={tracking} maxLength={60} onChange={(e) => setTracking(e.target.value)} /></Field>
      </div>
      {status === 'dispatched' && <Alert tone="info">Dispatching needs every production stage done. The customer sees "Dispatched with {s.carrier_name}".</Alert>}
      {(status === 'returned' || status === 'cancelled') && <Alert tone="warn">This changes the shipment only; the order keeps its status. Add an order note to explain.</Alert>}
    </Modal>
  );
}
