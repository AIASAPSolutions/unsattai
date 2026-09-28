import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DesignPreview, OrderFlags } from '../../components/domain';
import { IconBolt, IconDoc, IconDownload, IconPause, IconX } from '../../components/icons';
import { PricingBreakdown } from '../../components/Pricing';
import {
  Alert, Badge, Button, Card, DataTable, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useToast,
} from '../../components/ui';
import { download, get, openHtml, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, GARMENT_LABEL, label, money } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import { PAYMENT_METHODS, type Activity, type AuditRow, type Order, type Plan, type Shipment } from '../../lib/types';

interface Detail { order: Order; plan: Plan | null; shipments: Shipment[]; activities: Activity[]; audit: AuditRow[] }
type Dialog = null | 'payment' | 'hold' | 'cancel' | 'priority' | 'note';

export default function OrderDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { who } = useRefData();
  const toast = useToast();
  const d = useLoad(() => get<Detail>(`/ops/orders/${id}`), [id]);
  const { busy, run } = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);

  const o = d.data?.order;
  const f = o?.fulfilment;
  const nextStage = useMemo(() => f?.stages.find((s) => !s.done_at)?.id, [f]);

  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data || !o) return <Loading />;
  const { plan, shipments, audit } = d.data;
  const cur = o.pricing?.currency ?? 'INR';
  const status = f?.status ?? 'awaiting_payment';
  const open = !['dispatched', 'delivered', 'cancelled'].includes(status);
  const inProd = ['queued', 'in_production', 'ready'].includes(status);
  const canOrders = can('orders');
  const canProd = can('production');

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    await run(key, async () => { await fn(); toast.success(ok); setDialog(null); await d.reload(); }, toast.error);
  };
  const stage = (sid: string, undo = false) => act(`stage-${sid}`, () => post(`/ops/orders/${o.id}/stages/${sid}`, {}, undo ? { undo: true } : undefined),
    undo ? 'Stage reopened.' : 'Stage marked done.');

  const events = [...(o.events ?? [])].reverse();

  return (
    <>
      <PageHeader
        crumbs={<><Link to="/orders">Orders</Link> / {o.number}</>}
        title={<span className="row">Order {o.number ?? o.id} <StatusBadge status={status} /><OrderFlags o={{ rush: f?.rush, hold: f?.hold }} /></span>}
        subtitle={<>Placed {dateTime(o.created_at)} via {label(o.channel ?? 'app')} · <code>{o.id}</code></>}
        actions={<>
          {!o.payment && status !== 'cancelled' && <Button variant="primary" onClick={() => setDialog('payment')} disabled={!canOrders} title={canOrders ? '' : 'Your role cannot record payments'} data-testid="record-payment">Record payment</Button>}
          {open && status !== 'awaiting_payment' && <Button icon={<IconPause />} onClick={() => setDialog('hold')} disabled={!canOrders} data-testid="hold-toggle">{f?.hold ? 'Resume' : 'Hold'}</Button>}
          {open && <Button icon={<IconBolt />} onClick={() => setDialog('priority')} disabled={!canOrders} data-testid="priority">Priority &amp; date</Button>}
          <Button onClick={() => setDialog('note')} disabled={!canOrders} data-testid="add-note">Add note</Button>
          <Button icon={<IconDoc />} onClick={() => run('inv', () => openHtml(`/ops/orders/${o.id}/invoice`, `Invoice ${o.number}`), toast.error)} busy={busy === 'inv'} data-testid="open-invoice">Invoice</Button>
          {open && <Button variant="danger" icon={<IconX />} onClick={() => setDialog('cancel')} disabled={!canOrders} data-testid="cancel-order">Cancel</Button>}
        </>}
      />
      {f?.hold && <div style={{ marginBottom: 16 }}><Alert tone="warn"><b>On hold.</b> {f.hold_reason || 'No reason given.'} Held orders are left out of the production plan.</Alert></div>}
      {status === 'cancelled' && <div style={{ marginBottom: 16 }}><Alert tone="error"><b>Cancelled.</b> {f?.cancel_reason}</Alert></div>}
      {!canOrders && <div style={{ marginBottom: 16 }}><Alert tone="info">Your role can view this order but not change payments, holds or priority.</Alert></div>}

      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Design and lines">
            <div className="grid" style={{ gridTemplateColumns: 'minmax(180px, 260px) 1fr', alignItems: 'start' }}>
              <DesignPreview spec={o.spec} height={260} />
              <div className="stack tight">
                <div><b>{o.spec.style_name}</b> <span className="muted">· {GARMENT_LABEL[o.garment]} · {label(String(o.spec.sport ?? ''))}</span></div>
                {o.spec.typography?.team_name && <div>Team: <b>{o.spec.typography.team_name}</b></div>}
                <div>{o.manufacturing_ready ? <Badge tone="good">Print-ready</Badge> : <Badge tone="bad">Checks failing</Badge>} <span className="muted small">{o.total_pieces} pieces in {o.lines.length} lines</span></div>
                <table className="table compact">
                  <thead><tr><th>#</th><th>Name</th><th>No.</th><th>Size</th><th className="num">Qty</th></tr></thead>
                  <tbody>{o.lines.map((l) => <tr key={l.line}><td>{l.line}</td><td>{l.player_name || '—'}</td><td>{l.number || '—'}</td><td>{l.size}</td><td className="num">{l.quantity}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </Card>

          {o.pricing && <Card title="Pricing"><PricingBreakdown p={o.pricing} showLines testId="order-pricing" /></Card>}

          <Card title="Production stages" actions={plan && <span className="muted small">Planned ready {day(plan.ready_date)}</span>}>
            {!f?.stages.length ? <div className="muted">Stages start when the order is paid.</div> : (
              <div className="stages" data-testid="order-stages">
                {f.stages.map((s) => {
                  const p = plan?.stages.find((x) => x.id === s.id);
                  const isNext = s.id === nextStage;
                  return (
                    <div key={s.id} className={`stage-row ${s.done_at ? 'done' : ''} ${isNext ? 'next' : ''}`} data-stage={s.id}>
                      <span className="tick">{s.done_at ? '✓' : ''}</span>
                      <span className="name">{s.name}</span>
                      <span className="muted small">
                        {s.done_at ? <>Done {dateTime(s.done_at)}{s.done_by ? ` by ${who(s.done_by)}` : ''}</> : p ? <>Planned {day(p.start)}{p.end !== p.start ? ` – ${day(p.end)}` : ''}</> : ''}
                      </span>
                      {canProd && inProd && (s.done_at
                        ? <Button size="xs" onClick={() => stage(s.id, true)} busy={busy === `stage-${s.id}`}>Undo</Button>
                        : <Button size="xs" variant={isNext ? 'primary' : 'default'} disabled={!isNext} onClick={() => stage(s.id)} busy={busy === `stage-${s.id}`}>Mark done</Button>)}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Timeline" actions={<span className="muted small"><Badge tone="warn">Internal</Badge> not shown to the customer</span>}>
            <ul className="timeline" data-testid="timeline">
              {events.map((e, i) => (
                <li key={i} className={e.public ? '' : 'internal'}>
                  <div className="t">{e.text} {!e.public && <Badge tone="warn">Internal</Badge>}</div>
                  <div className="m">{dateTime(e.at)} · {who(e.actor)}{typeof e.reason === 'string' && e.reason ? ` · ${e.reason}` : ''}</div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Audit trail" flush>
            <DataTable rows={audit} rowKey={(a) => String(a.id)} compact pageSize={10} columns={[
              { key: 'at', header: 'When', render: (a) => <span className="nowrap">{dateTime(a.at)}</span> },
              { key: 'who', header: 'Who', render: (a) => who(a.actor) },
              { key: 'action', header: 'Action', render: (a) => <code>{a.action}</code> },
              { key: 'detail', header: 'Detail', render: (a) => <span className="muted small">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</span> },
            ]} empty="No changes recorded." />
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="Customer">
            <dl className="kv">
              <dt>Name</dt><dd>{o.customer_id ? <Link to={`/crm/customers/${o.customer_id}`} data-testid="customer-link">{o.customer.name}</Link> : o.customer.name}</dd>
              <dt>Phone</dt><dd><a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a></dd>
              {o.customer.email && <><dt>Email</dt><dd>{o.customer.email}</dd></>}
            </dl>
          </Card>

          <Card title="Dates">
            <dl className="kv" data-testid="order-dates">
              <dt>Promised ship</dt><dd>{day(f?.promised_ship_date)}</dd>
              <dt>Promised delivery</dt><dd className="strong">{day(f?.promised_delivery_date)}</dd>
              {plan ? <>
                <dt>Planned ready</dt><dd>{day(plan.ready_date)}</dd>
                <dt>Planned ship</dt><dd>{day(plan.ship_date)}</dd>
                <dt>Planned delivery</dt><dd className={plan.late ? 'bad-text strong' : 'good-text strong'}>{day(plan.delivery_date)} {plan.late ? <Badge tone="bad">Late</Badge> : <Badge tone="good">On time</Badge>}</dd>
              </> : <><dt>Plan</dt><dd className="muted">{status === 'awaiting_payment' ? 'Planned after payment' : f?.hold ? 'Not planned while on hold' : 'Not in the active plan'}</dd></>}
              {f?.estimate && status === 'awaiting_payment' && <><dt>Estimate if paid</dt><dd>{day(f.estimate.delivery_date)}</dd></>}
              {f?.dispatched_at && <><dt>Dispatched</dt><dd>{dateTime(f.dispatched_at)}</dd></>}
              {f?.delivered_at && <><dt>Delivered</dt><dd>{dateTime(f.delivered_at)}</dd></>}
            </dl>
          </Card>

          <Card title="Delivery">
            {o.delivery ? (
              <dl className="kv">
                <dt>Method</dt><dd>{o.delivery.method === 'pickup' ? 'Pickup' : 'Ship'}</dd>
                {o.delivery.zone && <><dt>Zone</dt><dd>{o.pricing?.shipping.zone_name ?? o.delivery.zone} · {o.delivery.transit_days} days transit</dd></>}
                {o.delivery.address && <><dt>Address</dt><dd>
                  {o.delivery.address.name && <>{o.delivery.address.name}<br /></>}
                  {o.delivery.address.line1}{o.delivery.address.line2 && <>, {o.delivery.address.line2}</>}<br />
                  {o.delivery.address.city}, {o.delivery.address.state} {o.delivery.address.pincode}
                  {o.delivery.address.phone && <><br />{o.delivery.address.phone}</>}
                </dd></>}
              </dl>
            ) : <span className="muted">No delivery details (older app version).</span>}
          </Card>

          <Card title="Payment">
            {o.payment ? (
              <dl className="kv" data-testid="payment-info">
                <dt>Method</dt><dd>{label(o.payment.method)} {o.payment.demo && <Badge tone="warn">Demo, no money taken</Badge>}</dd>
                <dt>Reference</dt><dd>{o.payment.reference || '—'}</dd>
                {o.payment.amount !== undefined && <><dt>Amount</dt><dd>{money(o.payment.amount, cur)}</dd></>}
                <dt>Received</dt><dd>{dateTime(o.payment.confirmed_at)}</dd>
                {o.payment.recorded_by && <><dt>Recorded by</dt><dd>{who(o.payment.recorded_by)}</dd></>}
              </dl>
            ) : <div className="muted">Not paid yet. {canOrders && 'Record cash, UPI, bank transfer, card or cheque payments here.'}</div>}
          </Card>

          <Card title="Shipments" actions={<Link to="/delivery/shipments">Delivery</Link>}>
            {shipments.length ? (
              <div className="stack tight">
                {shipments.map((s) => (
                  <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{s.carrier_name} {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer">{s.tracking_no}</a> : s.tracking_no}</span>
                    <StatusBadge status={s.status} />
                  </div>
                ))}
              </div>
            ) : <span className="muted">None yet. {status === 'ready' ? 'Create one in Delivery.' : ''}</span>}
          </Card>

          <Card title={`Print files (${o.files.length})`}>
            <div className="stack tight" data-testid="print-files">
              {o.files.map((fl) => (
                <div key={fl.name} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <span className="ellipsis small" title={fl.name}>Line {fl.line} · {fl.size} · {label(fl.panel)}{fl.player_name && ` · ${fl.player_name}`}{fl.number && ` #${fl.number}`}</span>
                  <Button size="xs" icon={<IconDownload />} busy={busy === fl.name}
                    onClick={() => run(fl.name, () => download(`/orders/${o.id}/files/${encodeURIComponent(fl.name)}`, fl.name, { method: 'POST' }), toast.error)}>SVG</Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <PaymentDialog key={`p-${dialog}`} open={dialog === 'payment'} total={o.pricing?.total ?? 0} currency={cur} onClose={() => setDialog(null)} busy={busy === 'pay'}
        onSubmit={(body) => act('pay', () => post(`/ops/orders/${o.id}/payments`, body), 'Payment recorded. The order is released to production.')} />
      <ReasonDialog key={`h-${dialog}`} open={dialog === 'hold'} title={f?.hold ? 'Resume order' : 'Put order on hold'} busy={busy === 'hold'} optional={!!f?.hold}
        prompt={f?.hold ? 'Note (optional)' : 'Why is it on hold? (internal)'} confirm={f?.hold ? 'Resume' : 'Hold order'} onClose={() => setDialog(null)}
        onSubmit={(reason) => act('hold', () => post(`/ops/orders/${o.id}/hold`, { hold: !f?.hold, reason }), f?.hold ? 'Order resumed.' : 'Order on hold.')} />
      <ReasonDialog key={`c-${dialog}`} open={dialog === 'cancel'} title="Cancel order" busy={busy === 'cancel'} danger min={3}
        prompt="Reason (at least 3 characters)" confirm="Cancel order" onClose={() => setDialog(null)}
        onSubmit={(reason) => act('cancel', () => post(`/ops/orders/${o.id}/cancel`, { reason }), 'Order cancelled.')}>
        <Alert tone="warn">Cancelling stops production planning. Refunds are handled outside the app.</Alert>
      </ReasonDialog>
      <PriorityDialog key={`r-${dialog}`} open={dialog === 'priority'} rush={!!f?.rush} promised={f?.promised_delivery_date ?? ''} busy={busy === 'prio'} onClose={() => setDialog(null)}
        onSubmit={(body) => act('prio', () => post(`/ops/orders/${o.id}/priority`, body), 'Priority updated.')} />
      <NoteDialog key={`n-${dialog}`} open={dialog === 'note'} busy={busy === 'note'} onClose={() => setDialog(null)}
        onSubmit={(body) => act('note', () => post(`/ops/orders/${o.id}/notes`, body), body.public ? 'Note added to the customer timeline.' : 'Internal note added.')} />
    </>
  );
}

function PaymentDialog({ open, total, currency, onClose, onSubmit, busy }: {
  open: boolean; total: number; currency: string; busy: boolean; onClose: () => void;
  onSubmit: (b: { method: string; reference: string; amount: number }) => void;
}) {
  const [method, setMethod] = useState<string>('upi');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(String(total));
  const amt = Number(amount);
  const bad = !(amt > 0);
  return (
    <Modal open={open} title="Record payment" onClose={onClose} testId="payment-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={busy} disabled={bad} onClick={() => onSubmit({ method, reference: reference.trim(), amount: amt })} data-testid="payment-submit">Record payment</Button></>}>
      <div className="form-grid">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="payment-method">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m === 'demo' ? 'Demo (no money)' : label(m)}</option>)}
          </select>
        </Field>
        <Field label={`Amount (${currency})`} errors={bad && amount !== '' ? ['Enter an amount above 0.'] : undefined} hint={`Order total ${money(total, currency)}`}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount" />
        </Field>
        <Field label="Reference" className="wide" hint="UPI transaction ID, cheque number, bank reference…">
          <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} data-testid="payment-reference" />
        </Field>
      </div>
      {Math.abs(amt - total) > 0.005 && !bad && <Alert tone="warn">The amount differs from the order total ({money(total, currency)}).</Alert>}
    </Modal>
  );
}

function ReasonDialog({ open, title, prompt, confirm, onClose, onSubmit, busy, danger, min = 0, optional, children }: {
  open: boolean; title: string; prompt: string; confirm: string; onClose: () => void; onSubmit: (r: string) => void; busy: boolean;
  danger?: boolean; min?: number; optional?: boolean; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const short = !optional && reason.trim().length < Math.max(min, 1);
  return (
    <Modal open={open} title={title} onClose={onClose} testId="reason-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant={danger ? 'danger-solid' : 'primary'} busy={busy} disabled={short} onClick={() => onSubmit(reason.trim())} data-testid="reason-submit">{confirm}</Button></>}>
      {children}
      <Field label={prompt}><textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus data-testid="reason-input" /></Field>
    </Modal>
  );
}

function PriorityDialog({ open, rush, promised, onClose, onSubmit, busy }: {
  open: boolean; rush: boolean; promised: string; busy: boolean; onClose: () => void;
  onSubmit: (b: { rush: boolean; promised_delivery_date: string | null }) => void;
}) {
  const [r, setR] = useState(rush);
  const [date, setDate] = useState(promised);
  return (
    <Modal open={open} title="Priority and promised date" onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={busy} onClick={() => onSubmit({ rush: r, promised_delivery_date: date || null })} data-testid="priority-submit">Save</Button></>}>
      <label className="check"><input type="checkbox" checked={r} onChange={(e) => setR(e.target.checked)} data-testid="priority-rush" /> Express production (planned before other orders)</label>
      <Field label="Promised delivery date" hint="Changing the promise is recorded in the audit trail. The express fee is not re-charged.">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Modal>
  );
}

function NoteDialog({ open, onClose, onSubmit, busy }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (b: { text: string; public: boolean }) => void }) {
  const [text, setText] = useState('');
  const [pub, setPub] = useState(false);
  return (
    <Modal open={open} title="Add note" onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => { onSubmit({ text: text.trim(), public: pub }); setText(''); }} data-testid="note-submit">Add note</Button></>}>
      <Field label="Note"><textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoFocus data-testid="note-text" /></Field>
      <label className="check"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} data-testid="note-public" /> Visible to the customer on their order timeline</label>
      {pub && <Alert tone="warn">The customer will see this text exactly as written.</Alert>}
    </Modal>
  );
}

