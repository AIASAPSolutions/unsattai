import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DesignPreview, OrderFlags } from '../../components/domain';
import { SellerLink } from '../../components/marketplace';
import { CollectDialog } from '../marketplace/Cod';
import { ReturnBadge } from '../marketplace/Returns';
import { IconBolt, IconDoc, IconDownload, IconPause, IconX } from '../../components/icons';
import { PricingBreakdown } from '../../components/Pricing';
import {
  Alert, Badge, Button, Card, DataTable, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useToast,
} from '../../components/ui';
import { download, get, openHtml, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, GARMENT_LABEL, label, money } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { filesByLine, fitOf, fitSize, measureColumns, MEASUREMENT_SHEET, optionsText, pieceLabel, piecesParts, printFileRequest } from '../../lib/production';
import { useHealth } from '../../lib/meta';
import { useRefData } from '../../lib/refdata';
import {
  FIT_LABEL, PAYMENT_METHODS, type Activity, type AuditRow, type CheckoutRef, type Order, type OrderSummary, type Page, type Plan, type ReturnRec, type Seller, type Shipment,
} from '../../lib/types';

interface Detail {
  order: Order; plan: Plan | null; shipments: Shipment[]; activities: Activity[]; audit: AuditRow[];
  checkout?: CheckoutRef | null; returns?: ReturnRec[]; seller?: Seller | null;
}
type Dialog = null | 'payment' | 'hold' | 'cancel' | 'priority' | 'note' | 'cod';

export default function OrderDetail() {
  const { id = '' } = useParams();
  const { can, isSeller } = useAuth();
  const { who } = useRefData();
  const toast = useToast();
  const d = useLoad(() => get<Detail>(`/ops/orders/${id}`), [id]);
  const ckId = d.data?.checkout?.id;
  const siblings = useLoad(() => (ckId ? get<Page<OrderSummary>>('/ops/orders', { checkout_id: ckId }).then((r) => r.items) : Promise.resolve([] as OrderSummary[])), [ckId]);
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
  const cod = o.payment_method === 'cod';
  const codCollected = cod && !!o.payment?.collected;
  const { checkout, returns = [], seller } = d.data;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    await run(key, async () => { await fn(); toast.success(ok); setDialog(null); await d.reload(); }, toast.error);
  };
  const stage = (sid: string, undo = false) => act(`stage-${sid}`, () => post(`/ops/orders/${o.id}/stages/${sid}`, {}, undo ? { undo: true } : undefined),
    undo ? 'Stage reopened.' : 'Stage marked done.');

  const events = [...(o.events ?? [])].reverse();
  const opts = optionsText(o);
  const mcols = measureColumns(o.lines);

  return (
    <>
      <PageHeader
        crumbs={<><Link to="/orders">Orders</Link> / {o.number}</>}
        title={<span className="row">Order {o.number ?? o.id} <StatusBadge status={status} /><OrderFlags o={{ rush: f?.rush, hold: f?.hold }} /></span>}
        subtitle={<>Placed {dateTime(o.created_at)} via {label(o.channel ?? 'app')} · <code>{o.id}</code></>}
        actions={isSeller ? <>
          <Button icon={<IconDoc />} onClick={() => run('inv', () => openHtml(`/ops/orders/${o.id}/invoice`, `Invoice ${o.number}`), toast.error)} busy={busy === 'inv'} data-testid="open-invoice">Invoice</Button>
        </> : <>
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
      {!canOrders && !isSeller && <div style={{ marginBottom: 16 }}><Alert tone="info">Your role can view this order but not change payments, holds or priority.</Alert></div>}
      {isSeller && <div style={{ marginBottom: 16 }}><Alert tone="info">Mark production stages as you finish them. Ship it from Delivery when every stage is done.</Alert></div>}

      <div className="grid grid-main">
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Design and lines">
            <div className="grid order-design">
              <DesignPreview spec={o.spec} height={260} />
              <div className="stack tight">
                <div><b>{o.spec.style_name}</b> <span className="muted">· {GARMENT_LABEL[o.garment]} · {label(String(o.spec.sport ?? ''))}</span></div>
                {opts.length > 0 && <div className="row tight" data-testid="order-options">{opts.map((x) => <Badge key={x} tone="info">{x}</Badge>)}</div>}
                {o.spec.typography?.team_name && <div>Team: <b>{o.spec.typography.team_name}</b></div>}
                <div>{o.manufacturing_ready ? <Badge tone="good">Print-ready</Badge> : <Badge tone="bad">Checks failing</Badge>} <span className="muted small">{o.total_pieces} pieces in {o.lines.length} lines</span></div>
                <p className="muted small" style={{ margin: 0 }}>Each line is cut to its fit and size. Measurements are the finished garment laid flat, in cm; piece sizes are the cut line in mm (width × height) without bleed.</p>
              </div>
            </div>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table compact" data-testid="order-lines">
                <thead><tr><th>#</th><th>Name</th><th>No.</th><th>Fit</th><th>Size</th><th className="num">Qty</th>
                  {mcols.map(([, h]) => <th key={h} className="num">{h}</th>)}<th>Pieces (mm)</th></tr></thead>
                <tbody>{o.lines.map((l) => (
                  <tr key={l.line} data-line={l.line}>
                    <td>{l.line}</td><td>{l.player_name || '—'}</td><td>{l.number || '—'}</td>
                    <td className="nowrap" title={FIT_LABEL[fitOf(l)]}>{FIT_LABEL[fitOf(l)].split(' /')[0]}</td><td className="strong">{l.size}</td><td className="num">{l.quantity}</td>
                    {mcols.map(([k]) => <td key={k} className="num">{l.measurements?.[k] ?? '—'}</td>)}
                    <td className="measure">{piecesParts(l.pieces_mm).map(([lbl, size]) => <div key={lbl}>{lbl} <span className="nowrap strong">{size}</span></div>)}{!l.pieces_mm && <span className="muted">On the measurement sheet</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
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

          {!isSeller && <Card title="Timeline" actions={<span className="muted small"><Badge tone="warn">Internal</Badge> not shown to the customer</span>}>
            <ul className="timeline" data-testid="timeline">
              {events.map((e, i) => (
                <li key={i} className={e.public ? '' : 'internal'}>
                  <div className="t">{e.text} {!e.public && <Badge tone="warn">Internal</Badge>}</div>
                  <div className="m">{dateTime(e.at)} · {who(e.actor)}{typeof e.reason === 'string' && e.reason ? ` · ${e.reason}` : ''}</div>
                </li>
              ))}
            </ul>
          </Card>}

          {!isSeller && <Card title="Audit trail" flush>
            <DataTable rows={audit} rowKey={(a) => String(a.id)} compact pageSize={10} columns={[
              { key: 'at', header: 'When', render: (a) => <span className="nowrap">{dateTime(a.at)}</span> },
              { key: 'who', header: 'Who', render: (a) => who(a.actor) },
              { key: 'action', header: 'Action', render: (a) => <code>{a.action}</code> },
              { key: 'detail', header: 'Detail', render: (a) => <span className="muted small">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</span> },
            ]} empty="No changes recorded." />
          </Card>}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="Seller">
            <dl className="kv" data-testid="order-seller">
              <dt>Sold by</dt><dd className="strong"><SellerLink id={o.seller?.id ?? seller?.id} name={o.seller?.name ?? seller?.name} /></dd>
              {seller?.gstin && <><dt>GSTIN</dt><dd>{seller.gstin}</dd></>}
              {!isSeller && seller?.phone && <><dt>Contact</dt><dd>{seller.phone}{seller.email && ` · ${seller.email}`}</dd></>}
            </dl>
          </Card>

          {checkout && (
            <Card title={<>Checkout {checkout.number}</>} actions={!isSeller && <Link to={`/orders?checkout=${checkout.id}`}>List</Link>}>
              <div className="stack tight" data-testid="order-checkout">
                <div className="small muted">{checkout.order_ids.length} order{checkout.order_ids.length === 1 ? '' : 's'} placed together · {checkout.payment_method === 'cod' ? 'cash on delivery' : 'paid online'} · {label(checkout.status)}</div>
                <div className="checkout-sibs">
                  {checkout.order_ids.map((oid) => {
                    const row = siblings.data?.find((x) => x.id === oid);
                    if (oid === o.id) return <span key={oid} className="cur">{o.number} (this)</span>;
                    if (!row) return isSeller ? <span key={oid} className="muted" title="Made by another seller">Another seller</span> : <span key={oid} className="muted">…</span>;
                    return <Link key={oid} to={`/orders/${oid}`} data-testid="checkout-sibling">{row.number}{!isSeller && row.seller_name ? ` · ${row.seller_name}` : ''}</Link>;
                  })}
                </div>
              </div>
            </Card>
          )}

          <Card title="Customer">
            <dl className="kv">
              <dt>Name</dt><dd>{o.customer_id && !isSeller ? <Link to={`/crm/customers/${o.customer_id}`} data-testid="customer-link">{o.customer.name}</Link> : o.customer.name}</dd>
              <dt>Phone</dt><dd><a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a></dd>
              {o.customer.email && <><dt>Email</dt><dd>{o.customer.email}</dd></>}
              {!isSeller && <><dt>Messages</dt><dd><Link to={`/messages?order=${o.id}`}>SMS and email sent</Link></dd></>}
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

          <Card title="Payment" actions={<Badge tone={cod ? 'warn' : 'info'}>{cod ? 'Cash on delivery' : 'Online'}</Badge>}>
            {cod ? (
              <dl className="kv" data-testid="payment-info">
                <dt>Due on delivery</dt><dd className="strong">{money(o.payment?.amount ?? o.pricing?.total, cur)}</dd>
                <dt>Cash</dt><dd data-testid="cod-status">{codCollected ? <Badge tone="good" dot>Collected</Badge> : status === 'cancelled' ? <Badge>Not due (cancelled)</Badge> : <Badge tone="warn" dot>To collect</Badge>}</dd>
                {codCollected && <><dt>Collected</dt><dd>{dateTime(o.payment?.collected_at)}{o.payment?.collected_by ? ` by ${who(o.payment.collected_by)}` : ''}</dd></>}
                {o.payment?.reference && <><dt>Reference</dt><dd>{o.payment.reference}</dd></>}
                {!codCollected && status !== 'cancelled' && can('delivery') && (
                  <><dt /><dd><Button size="sm" variant="primary" onClick={() => setDialog('cod')} data-testid="cod-collect">Mark cash collected</Button></dd></>
                )}
              </dl>
            ) : o.payment ? (
              <dl className="kv" data-testid="payment-info">
                <dt>Method</dt><dd>{label(o.payment.method)} {o.payment.demo && <Badge tone="warn">Demo, no money taken</Badge>}</dd>
                <dt>Reference</dt><dd>{o.payment.reference || '—'}</dd>
                {o.payment.amount !== undefined && <><dt>Amount</dt><dd>{money(o.payment.amount, cur)}</dd></>}
                <dt>Received</dt><dd>{dateTime(o.payment.confirmed_at)}</dd>
                {o.payment.recorded_by && <><dt>Recorded by</dt><dd>{who(o.payment.recorded_by)}</dd></>}
              </dl>
            ) : <div className="muted">Not paid yet. {canOrders && 'Record cash, UPI, bank transfer, card or cheque payments here.'}</div>}
            {(o.refunds ?? []).map((r) => (
              <div key={r.id} className="small" style={{ marginTop: 8 }}><Badge tone="bad">Refund</Badge> {money(r.amount, cur)} · {dateTime(r.at)} · {r.method === 'demo' ? 'recorded, no money moved' : 'paid back by hand'}{r.note && ` · ${r.note}`}</div>
            ))}
          </Card>

          {returns.length > 0 && (
            <Card title={`Returns (${returns.length})`}>
              <div className="stack tight">
                {returns.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span><Link to={`/returns/${r.id}`}>{r.number}</Link> <span className="muted small">{label(r.reason)}</span></span>
                    <ReturnBadge status={r.status} />
                  </div>
                ))}
              </div>
            </Card>
          )}

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
              <div className="line-files" data-testid="measurement-sheet">
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <span className="small"><b>Measurement sheet</b><br /><span className="muted">Every line's fit, size, measurements and piece sizes, for cutting and sewing.</span></span>
                  <span className="row tight" style={{ flexWrap: 'nowrap' }}>
                    <Button size="xs" icon={<IconDoc />} busy={busy === 'sheet-open'} data-testid="measurement-sheet-open"
                      onClick={() => run('sheet-open', () => { const r = printFileRequest(o.id, MEASUREMENT_SHEET, canProd); return openHtml(r.path, `Measurement sheet ${o.number ?? o.id}`, { method: r.method }); }, toast.error)}>Open</Button>
                    <Button size="xs" icon={<IconDownload />} busy={busy === 'sheet'} data-testid="measurement-sheet-download"
                      onClick={() => run('sheet', () => { const r = printFileRequest(o.id, MEASUREMENT_SHEET, canProd); return download(r.path, `${o.number ?? o.id}_measurements.svg`, { method: r.method }); }, toast.error)}>SVG</Button>
                  </span>
                </div>
              </div>
              {filesByLine(o).map((g) => (
                <div key={g.lineNo} className="line-files" data-testid="print-file-line" data-line={g.lineNo}>
                  <div className="head">Line {g.lineNo} · {fitSize(g.line ?? g.files[0], true)}{g.line ? ` × ${g.line.quantity}` : ''}
                    {g.files[0]?.player_name && ` · ${g.files[0].player_name}`}{g.files[0]?.number && ` #${g.files[0].number}`}</div>
                  {g.files.map((fl) => (
                    <div key={fl.name} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                      <span className="ellipsis small" title={fl.name}>{pieceLabel(fl.panel)} <span className="muted">{fl.name}</span></span>
                      <Button size="xs" icon={<IconDownload />} busy={busy === fl.name} data-testid="print-file-download"
                        onClick={() => run(fl.name, () => { const r = printFileRequest(o.id, fl.name, canProd); return download(r.path, fl.name, { method: r.method }); }, toast.error)}>SVG</Button>
                    </div>
                  ))}
                </div>
              ))}
              {!o.files.length && <span className="muted small">No print files for this order.</span>}
              {o.files.length > 0 && <span className="muted small">Vector SVG at 1:1 in mm, graded to each line's fit and size; raster logos are checked for 300 dpi. Print at 100%.</span>}
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
      {dialog === 'cod' && <CollectDialog order={{ id: o.id, number: o.number, total: o.payment?.amount ?? o.pricing?.total, currency: cur }} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); await d.reload(); }} />}
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
  // The server refuses "demo" (no money) payments when demo payments are off (health.demo_payments).
  const demoOk = useHealth().data?.demo_payments !== false;
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
            {PAYMENT_METHODS.filter((m) => m !== 'demo' || demoOk).map((m) => <option key={m} value={m}>{m === 'demo' ? 'Demo (no money)' : label(m)}</option>)}
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

