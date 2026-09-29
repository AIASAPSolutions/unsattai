import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SellerFilter, SellerLink, useSellerParam } from '../../components/marketplace';
import {
  Alert, Badge, Button, Card, Chips, DataTable, Drawer, ErrorBox, Field, Kpi, Loading, PageHeader, Pager, SearchInput, StatusBadge, useToast, type Tone,
} from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, day, label, money, num } from '../../lib/format';
import { useAction, useDebounced, useLoad } from '../../lib/hooks';
import { OPEN_RETURN_STATUSES, RETURN_ACTION, RETURN_FLOW, returnStatusBody } from '../../lib/marketplace';
import { useRefData } from '../../lib/refdata';
import { RETURN_STATUSES, type Order, type Page, type ReturnRec, type ReturnStatus } from '../../lib/types';

const TONE: Record<string, Tone> = { requested: 'warn', approved: 'info', picked_up: 'accent', resolved: 'good', rejected: 'bad' };
export function ReturnBadge({ status }: { status: string }) {
  return <Badge tone={TONE[status] ?? 'neutral'} dot>{label(status)}</Badge>;
}

export default function Returns() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isSeller } = useAuth();
  const [params, setParams] = useSearchParams();
  const [seller, setSeller] = useSellerParam();
  const statuses = (params.get('status') ?? OPEN_RETURN_STATUSES.join(',')).split(',').filter(Boolean);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const d = useLoad(() => get<Page<ReturnRec>>('/ops/returns', { status: statuses.join(',') || undefined, seller_id: seller || undefined, q: dq || undefined, page }),
    [statuses.join(','), seller, dq, page]);
  const waiting = useLoad(() => get<Page<ReturnRec>>('/ops/returns', { status: 'requested', seller_id: seller || undefined }).then((r) => r.total), [seller, d.data]);
  const setStatus = (v: string[]) => {
    const p = new URLSearchParams(params);
    p.set('status', v.join(','));
    setParams(p, { replace: true });
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Returns" subtitle={isSeller ? 'Return requests for your orders. Approve, arrange pickup, then resolve with a replacement or refund.'
        : 'Return requests from customers. Printed goods are returnable only for the reasons in Settings → CRM, within the return window.'} />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi k="Waiting for a decision" v={waiting.data === undefined ? '…' : num(waiting.data)} s="Requested, not yet approved or rejected" alert={!!waiting.data} testId="kpi-returns-waiting" />
      </div>
      <Card flush>
        <div className="card-body stack">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Return number, order number or customer…" testId="returns-search" />
            <SellerFilter value={seller} onChange={setSeller} />
          </div>
          <Chips multi value={statuses} onChange={setStatus} options={RETURN_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        </div>
        {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
          <DataTable testId="returns-table" rows={d.data?.items ?? []} rowKey={(r) => r.id} onRowClick={(r) => nav(`/returns/${r.id}${window.location.search}`)}
            empty={d.loading ? 'Loading…' : statuses.length ? 'No returns with these statuses.' : 'No returns.'}
            columns={[
              { key: 'n', header: 'Return', sort: (r) => r.number, render: (r) => <Link to={`/returns/${r.id}${window.location.search}`} className="strong">{r.number}</Link> },
              { key: 'o', header: 'Order', render: (r) => <Link to={`/orders/${r.order_id}`}>{r.order_number ?? r.order_id}</Link> },
              { key: 'c', header: 'Customer', sort: (r) => r.customer_name, render: (r) => r.customer_name },
              ...(isSeller ? [] : [{ key: 'sel', header: 'Seller', render: (r: ReturnRec) => <SellerLink id={r.seller_id} /> }]),
              { key: 'why', header: 'Reason', render: (r) => <div><div>{label(r.reason)}</div>{r.details && <div className="muted small ellipsis" style={{ maxWidth: 260 }} title={r.details}>{r.details}</div>}</div> },
              { key: 'st', header: 'Status', sort: (r) => r.status, render: (r) => <div><ReturnBadge status={r.status} />{r.resolution && <div className="muted small">{label(r.resolution)}</div>}</div> },
              { key: 'at', header: 'Requested', sort: (r) => r.created_at, render: (r) => <span className="nowrap small">{dateTime(r.created_at)}</span> },
              { key: 'up', header: 'Updated', sort: (r) => r.updated_at, render: (r) => <span className="nowrap small muted">{dateTime(r.updated_at)}</span> },
            ]} />
        )}
        {d.data && d.data.pages > 1 && <Pager page={d.data.page} pages={d.data.pages} total={d.data.total} onPage={setPage} noun="returns" />}
      </Card>
      {id && <ReturnDrawer id={id} onClose={() => nav(`/returns${window.location.search}`)} onChanged={() => void d.reload()} />}
    </>
  );
}

// ------------------------------------------------------------------ detail

interface RetDetail { return: ReturnRec; order: (Order & { can_return?: boolean; return_until?: string | null }) | null }

function ReturnDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can, isSeller } = useAuth();
  const { who } = useRefData();
  const d = useLoad(() => get<RetDetail>(`/ops/returns/${id}`), [id]);
  const [to, setTo] = useState<ReturnStatus | null>(null);
  const [v, setV] = useState({ resolution: '' as '' | 'replacement' | 'refund', refund: '', note: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run } = useAction();
  const canAct = can('orders') || isSeller;
  const r = d.data?.return;
  const o = d.data?.order;

  const submit = () => {
    if (!to || !r) return;
    const { body, error } = returnStatusBody(to, v);
    if (error) { setProblem(error); return; }
    setProblem(null);
    void run('s', async () => {
      await post(`/ops/returns/${r.id}/status`, body);
      toast.success(`${r.number}: ${label(to)}.`);
      setTo(null);
      setV({ resolution: '', refund: '', note: '' });
      await d.reload();
      onChanged();
    }, toast.error);
  };

  const lineOf = (n: number) => o?.lines.find((l) => l.line === n);
  return (
    <Drawer open wide title={r ? <span className="row">Return {r.number} <ReturnBadge status={r.status} /></span> : 'Return'} onClose={onClose} testId="return-drawer">
      {d.error && !d.data ? <ErrorBox error={d.error} onRetry={d.reload} /> : !r ? <Loading /> : (
        <div className="stack" style={{ gap: 14 }}>
          <dl className="kv">
            <dt>Order</dt><dd><Link to={`/orders/${r.order_id}`}>{r.order_number ?? r.order_id}</Link>{o && <> · <StatusBadge status={o.fulfilment?.status} /> · {money(o.pricing?.total, o.pricing?.currency)} · {label(o.payment_method ?? 'online')}</>}</dd>
            <dt>Customer</dt><dd>{r.customer_name}{o?.customer.phone && <span className="muted"> · {o.customer.phone}</span>}</dd>
            {!isSeller && <><dt>Seller</dt><dd><SellerLink id={r.seller_id} /></dd></>}
            <dt>Reason</dt><dd className="strong">{label(r.reason)}</dd>
            <dt>Customer says</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.details || <span className="muted">No details given.</span>}</dd>
            {o?.fulfilment?.delivered_at && <><dt>Delivered</dt><dd>{dateTime(o.fulfilment.delivered_at)}{o.return_until && <span className="muted"> · return window until {day(o.return_until)}</span>}</dd></>}
            <dt>Requested</dt><dd>{dateTime(r.created_at)}</dd>
            {r.resolution && <><dt>Resolution</dt><dd><Badge tone="good">{label(r.resolution)}</Badge>{r.refund_amount != null && <> {money(r.refund_amount, o?.pricing?.currency)} refunded</>}</dd></>}
            {r.note && <><dt>Note to customer</dt><dd>{r.note}</dd></>}
          </dl>

          <Card title="Items to return" flush>
            <table className="table compact">
              <thead><tr><th>Line</th><th>Name</th><th>No.</th><th>Size</th><th className="num">Qty returned</th></tr></thead>
              <tbody>{r.lines.map((l) => {
                const ol = lineOf(l.line);
                return <tr key={l.line}><td>{l.line}</td><td>{ol?.player_name || '—'}</td><td>{ol?.number || '—'}</td><td>{ol?.size ?? '—'}</td><td className="num">{l.quantity}{ol ? ` of ${ol.quantity}` : ''}</td></tr>;
              })}</tbody>
            </table>
          </Card>

          {RETURN_FLOW[r.status].length > 0 && (
            <Card title="Next step">
              {!canAct ? <Alert>Your role can view returns but not change them.</Alert> : (
                <div className="stack">
                  <div className="row">
                    {RETURN_FLOW[r.status].map((s) => (
                      <Button key={s} variant={s === 'rejected' ? 'danger' : to === s ? 'primary' : 'default'} onClick={() => { setTo(s); setProblem(null); }} data-testid={`return-to-${s}`}>
                        {RETURN_ACTION[s]}
                      </Button>
                    ))}
                  </div>
                  {to && (
                    <div className="stack tight" data-testid="return-form">
                      {to === 'resolved' && (
                        <div className="form-grid">
                          <Field label="Resolution">
                            <select value={v.resolution} onChange={(e) => setV({ ...v, resolution: e.target.value as typeof v.resolution })} data-testid="return-resolution">
                              <option value="">Choose…</option><option value="replacement">Replacement (re-make and ship)</option><option value="refund">Refund</option>
                            </select>
                          </Field>
                          {v.resolution === 'refund' && (
                            <Field label="Refund amount" hint={`Empty refunds the order total (${money(o?.pricing?.total, o?.pricing?.currency)}). Recorded on the order; no money moves from here.`}>
                              <input inputMode="decimal" value={v.refund} onChange={(e) => setV({ ...v, refund: e.target.value })} data-testid="return-refund" />
                            </Field>
                          )}
                        </div>
                      )}
                      <Field label={to === 'rejected' ? 'Why (shown to the customer)' : 'Note to the customer (optional)'}>
                        <textarea value={v.note} maxLength={1000} onChange={(e) => setV({ ...v, note: e.target.value })} style={{ minHeight: 60 }} data-testid="return-note"
                          placeholder={to === 'approved' ? 'Our courier will pick it up on Monday.' : to === 'resolved' ? 'Replacement dispatched with tracking…' : ''} />
                      </Field>
                      {problem && <div className="small bad-text">{problem}</div>}
                      <div className="row">
                        <Button variant={to === 'rejected' ? 'danger-solid' : 'primary'} busy={busy === 's'} onClick={submit} data-testid="return-submit">{RETURN_ACTION[to]}</Button>
                        <Button variant="ghost" onClick={() => setTo(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card title="History">
            <ul className="timeline" data-testid="return-history">
              {[...r.history].reverse().map((h, i) => (
                <li key={i}>
                  <div className="t"><ReturnBadge status={h.status} />{h.note && <> {h.note}</>}</div>
                  <div className="m">{dateTime(h.at)} · {h.by.startsWith('customer:') ? 'Customer' : isSeller ? 'Staff' : who(h.by)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </Drawer>
  );
}
