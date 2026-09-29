import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { OrderFlags, stageColor } from '../../components/domain';
import { SellerFilter, useSellerParam, withSeller } from '../../components/marketplace';
import { IconPrint, IconRefresh } from '../../components/icons';
import { Alert, Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Tabs, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, day, num, shortDay, weekday } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Order, Plan } from '../../lib/types';

interface StageCfg { id: string; name: string; capacity_per_day: number; fixed_days: number }

export default function Production() {
  const [seller, setSeller] = useSellerParam();
  const { isSeller } = useAuth();
  return (
    <>
      <PageHeader title="Production" subtitle={isSeller ? 'Your plan, board, capacity and daily worklists. Express orders first, then earliest promise.'
        : 'Finite-capacity plan per seller: express orders first, then earliest promise, then payment time.'}
        actions={<SellerFilter value={seller} onChange={setSeller} />} />
      <Tabs tabs={[
        { to: withSeller('/production/plan', seller), label: 'Plan' }, { to: withSeller('/production/board', seller), label: 'Board' },
        { to: withSeller('/production/capacity', seller), label: 'Capacity' }, { to: withSeller('/production/worklist', seller), label: 'Worklist' },
      ]} />
      <Routes>
        <Route index element={<Navigate to="plan" replace />} />
        <Route path="plan" element={<PlanView />} />
        <Route path="board" element={<Board />} />
        <Route path="capacity" element={<Capacity />} />
        <Route path="worklist" element={<Worklist />} />
      </Routes>
    </>
  );
}

// ------------------------------------------------------------------ plan (Gantt)

function PlanView() {
  const [seller] = useSellerParam();
  const { isSeller } = useAuth();
  const { sellerName } = useRefData();
  const d = useLoad(() => get<{ today: string; stages: StageCfg[]; orders: (Plan & { seller_id?: string })[] }>('/ops/production/plan', { seller_id: seller || undefined }), [seller], { poll: 60_000 });
  const [lateOnly, setLateOnly] = useState(false);
  const data = d.data;
  const days = useMemo(() => {
    if (!data?.orders.length) return [] as string[];
    const end = data.orders.reduce((m, p) => (p.delivery_date > m ? p.delivery_date : m), data.today);
    const out: string[] = [];
    for (let x = data.today; x <= end && out.length < 60; x = addDays(x, 1)) out.push(x);
    return out;
  }, [data]);
  if (d.error && !data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!data) return <Loading />;
  const idx = Object.fromEntries(data.stages.map((s, i) => [s.id, i]));
  const rows = [...data.orders].filter((p) => !lateOnly || p.late)
    .sort((a, b) => (Number(b.rush) - Number(a.rush)) || a.ship_date.localeCompare(b.ship_date));
  const late = data.orders.filter((p) => p.late).length;

  return (
    <Card title={<>Plan from {day(data.today)} <span className="muted small">· {data.orders.length} active orders</span></>}
      actions={<>
        <label className="check small"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Late only {late > 0 && <Badge tone="bad">{late}</Badge>}</label>
        <Button size="sm" icon={<IconRefresh />} onClick={d.reload} busy={d.loading}>Refresh</Button>
      </>}>
      <div className="legend" style={{ marginBottom: 10 }}>
        {data.stages.map((s, i) => <span key={s.id}><i style={{ background: stageColor(i) }} />{s.name}</span>)}
        <span><i style={{ background: 'transparent', border: '2px dashed var(--bad)' }} />Promised delivery</span>
        <span><i style={{ background: 'var(--surface-3)', border: '1px solid var(--border-strong)' }} />In transit</span>
      </div>
      {!rows.length ? <Empty title={lateOnly ? 'No late orders' : 'Nothing in production'}>Paid orders appear here with a day-by-day plan.</Empty> : (
        <div className="gantt" data-testid="gantt">
          <table>
            <thead>
              <tr>
                <th className="label" style={{ textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface-2)' }}>Order</th>
                {days.map((x) => <th key={x} className={`day ${x === data.today ? 'today' : ''}`}>{weekday(x)}<br />{shortDay(x)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = p.summary;
                return (
                  <tr key={p.order_id} className={p.late ? 'late' : ''}>
                    <td className="label">
                      <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                        <Link to={`/orders/${p.order_id}`} className="strong">{s?.number ?? p.order_id}</Link>
                        <OrderFlags o={{ rush: p.rush, hold: false }} />
                        {p.late && <Badge tone="bad">Late</Badge>}
                      </div>
                      <div className="muted small ellipsis">{s?.customer_name} · {num(p.pieces)} pcs · promised {day(p.promised_delivery_date)}{!seller && !isSeller && p.seller_id ? ` · ${sellerName(p.seller_id)}` : ''}</div>
                    </td>
                    {days.map((x) => {
                      const st = p.stages.filter((st) => st.start <= x && x <= st.end);
                      const transit = !st.length && x > p.ready_date && x <= p.delivery_date;
                      return (
                        <td key={x} className={`cell ${x === p.promised_delivery_date ? 'promised' : ''}`}
                          title={st.length ? st.map((q) => `${q.name}: ${day(q.start)} – ${day(q.end)}`).join('\n') : transit ? (x <= p.ship_date ? 'Waiting to ship' : 'In transit') : ''}>
                          {st.length > 0 && (
                            <div className="bar" style={{ background: st.length === 1 ? stageColor(idx[st[0].id]) : `linear-gradient(90deg, ${st.map((q, i) => `${stageColor(idx[q.id])} ${(i / st.length) * 100}% ${((i + 1) / st.length) * 100}%`).join(', ')})` }} />
                          )}
                          {transit && <div className="bar" style={{ background: 'var(--surface-3)', border: '1px solid var(--border-strong)', inset: '12px 1px' }} />}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ board (kanban)

interface BoardCard { id: string; number?: string; customer: string; pieces: number; garment: string; rush?: boolean; hold?: boolean;
  promised_delivery_date?: string | null; plan?: Plan | null; style_name?: string; seller_id?: string }
interface Column { stage: string; name: string; orders: BoardCard[] }

function Board() {
  const { can } = useAuth();
  const toast = useToast();
  const [seller] = useSellerParam();
  const { sellerName } = useRefData();
  const { isSeller } = useAuth();
  const d = useLoad(() => get<{ columns: Column[] }>('/ops/production/board', { seller_id: seller || undefined }), [seller], { poll: 30_000 });
  const { busy, run } = useAction();
  const canDo = can('production');
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;

  const done = (o: BoardCard, stage: string) => run(o.id, async () => {
    const r = await post<Order>(`/ops/orders/${o.id}/stages/${stage}`);
    const next = r.fulfilment?.stages.find((s) => !s.done_at);
    toast.success(`${o.number}: ${next ? `moved to ${next.name}` : 'ready to ship'}.`);
    await d.reload();
  }, toast.error);
  const undo = (o: BoardCard, cols: Column[], ci: number) => run(o.id, async () => {
    const prev = cols[ci - 1];
    if (!prev) return;
    await post(`/ops/orders/${o.id}/stages/${prev.stage}`, {}, { undo: true });
    toast.info(`${o.number}: back to ${prev.name}.`);
    await d.reload();
  }, toast.error);

  const cols = d.data.columns;
  return (
    <>
      {!canDo && <div style={{ marginBottom: 12 }}><Alert>Your role can view the board but not move orders between stages.</Alert></div>}
      <div className="board" data-testid="board">
        {cols.map((c, ci) => (
          <div key={c.stage} className="col" data-column={c.stage}>
            <div className="col-head">{c.name} <span className="muted">{c.orders.length} · {num(c.orders.reduce((a, o) => a + o.pieces, 0))} pcs</span></div>
            <div className="col-body">
              {c.orders.map((o) => (
                <div key={o.id} className={`kcard ${o.plan?.late ? 'late' : ''}`} data-order={o.number}>
                  <div className="t"><Link to={`/orders/${o.id}`}>{o.number}</Link><OrderFlags o={o} />{o.plan?.late && <Badge tone="bad">Late</Badge>}</div>
                  <div className="ellipsis">{o.customer}</div>
                  <div className="muted small">{num(o.pieces)} pcs · promised {day(o.promised_delivery_date)}</div>
                  {!seller && !isSeller && o.seller_id && <div className="muted small ellipsis">{sellerName(o.seller_id)}</div>}
                  {canDo && c.stage !== 'ready' && (
                    <div className="row tight" style={{ marginTop: 4 }}>
                      <Button size="xs" variant="primary" busy={busy === o.id} disabled={!!busy} onClick={() => done(o, c.stage)} data-testid="stage-done">Done</Button>
                      {ci > 0 && <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => undo(o, cols, ci)}>Back</Button>}
                    </div>
                  )}
                  {canDo && c.stage === 'ready' && ci > 0 && (
                    <div className="row tight" style={{ marginTop: 4 }}>
                      <Link to={withSeller('/delivery/ready', seller)} className="small">Ship it</Link>
                      <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => undo(o, cols, ci)}>Back</Button>
                    </div>
                  )}
                </div>
              ))}
              {!c.orders.length && <div className="muted small" style={{ padding: 8 }}>Empty</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ capacity heatmap

interface Util { dates: string[]; stages: { stage: string; name: string; days: { date: string; load: number; capacity: number; percent: number }[] }[]; bottleneck: string; today: string }

function heat(p: number): string {
  if (p > 100) return 'var(--heat-over)';
  if (p >= 85) return 'var(--heat-4)';
  if (p >= 60) return 'var(--heat-3)';
  if (p >= 30) return 'var(--heat-2)';
  if (p > 0) return 'var(--heat-1)';
  return 'var(--heat-0)';
}

function Capacity() {
  const [days, setDays] = useState(14);
  const [seller] = useSellerParam();
  const { isSeller } = useAuth();
  const { sellerName } = useRefData();
  const d = useLoad(() => get<Util>('/ops/production/utilisation', { days, seller_id: seller || undefined }), [days, seller]);
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const u = d.data;
  const b = u.stages.find((s) => s.stage === u.bottleneck);
  const total = (s: Util['stages'][number]) => s.days.reduce((a, c) => a + c.load, 0);
  const bLoad = b ? total(b) : 0;
  return (
    <div className="stack" style={{ gap: 16 }}>
      {b && bLoad > 0 && (
        <Alert tone="warn">
          <b>Bottleneck: {b.name}.</b> {num(bLoad)} pieces planned over {u.dates.length} working days against {num(b.days[0].capacity)} per day
          ({Math.round((100 * bLoad) / (b.days[0].capacity * u.dates.length))}% average). Adding capacity here shortens every promise.
          {!isSeller && <>{' '}{seller ? <Link to={`/sellers/${seller}`}>Change {sellerName(seller)}'s capacity factor</Link> : <Link to="/settings/production">Change capacity</Link>}</>}
        </Alert>
      )}
      {!seller && !isSeller && <Alert tone="info">All sellers added together: each seller's capacity counts only on its own working days. Pick a seller to see one unit.</Alert>}
      <Card title="Load against capacity, per stage and working day" actions={
        <select className="sm" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days">
          {[7, 14, 21, 30].map((n) => <option key={n} value={n}>{n} working days</option>)}
        </select>}>
        <div className="legend" style={{ marginBottom: 10 }}>
          <span><i style={{ background: 'var(--heat-0)', border: '1px solid var(--border)' }} />0%</span>
          <span><i style={{ background: 'var(--heat-1)' }} />1–29%</span>
          <span><i style={{ background: 'var(--heat-2)' }} />30–59%</span>
          <span><i style={{ background: 'var(--heat-3)' }} />60–84%</span>
          <span><i style={{ background: 'var(--heat-4)' }} />85–100%</span>
          <span><i style={{ background: 'var(--heat-over)' }} />Over capacity</span>
        </div>
        <div className="table-wrap">
          <table className="heat" data-testid="heatmap">
            <thead>
              <tr><th />{u.dates.map((x) => <th key={x}>{weekday(x)}<br />{shortDay(x)}</th>)}<th>Pieces</th></tr>
            </thead>
            <tbody>
              {u.stages.map((s) => (
                <tr key={s.stage} className={s.stage === u.bottleneck ? 'bottleneck' : ''}>
                  <th className="stage">{s.name}{s.stage === u.bottleneck && <> <Badge tone="bad">Bottleneck</Badge></>}<div className="muted small" style={{ fontWeight: 400 }}>{num(s.days[0]?.capacity)}/day</div></th>
                  {s.days.map((c) => (
                    <td key={c.date} style={{ background: heat(c.percent), color: c.percent >= 85 ? '#fff' : 'var(--text)' }}
                      title={`${s.name}, ${day(c.date)}: ${num(c.load)} of ${num(c.capacity)} pieces (${c.percent}%)`}>
                      {c.load ? `${c.percent}%` : ''}
                    </td>
                  ))}
                  <td style={{ background: 'transparent', fontWeight: 600 }}>{num(total(s))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ worklist

interface Work { stage: string; day: string; items: { order_id: string; number?: string; customer: string; pieces: number; rush: boolean; start: string; end: string;
  lines: { line: number; size: string; quantity: number; player_name: string; number: string }[]; files: string[] }[] }

function Worklist() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [seller] = useSellerParam();
  const plan = useLoad(() => get<{ today: string; stages: StageCfg[] }>('/ops/production/plan', { seller_id: seller || undefined }), [seller]);
  const stages = plan.data?.stages ?? [];
  const stage = params.get('stage') || stages[0]?.id || '';
  const dayIso = params.get('day') || plan.data?.today || '';
  const d = useLoad(() => (stage ? get<Work>('/ops/production/worklist', { stage, day: dayIso || undefined, seller_id: seller || undefined }) : Promise.resolve(null)), [stage, dayIso, seller]);
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };
  if (plan.error) return <ErrorBox error={plan.error} onRetry={plan.reload} />;
  if (!plan.data) return <Loading />;
  const w = d.data;
  const stageName = stages.find((s) => s.id === stage)?.name ?? stage;
  const pieces = w?.items.reduce((a, i) => a + i.pieces, 0) ?? 0;

  return (
    <Card title={<span>Worklist: {stageName}, {day(w?.day ?? dayIso, true)}</span>} actions={
      <div className="row no-print">
        <select className="sm" style={{ width: 'auto' }} value={stage} onChange={(e) => set('stage', e.target.value)} aria-label="Stage" data-testid="worklist-stage">
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className="sm" type="date" style={{ width: 'auto' }} value={dayIso} onChange={(e) => set('day', e.target.value)} aria-label="Day" />
        <Button size="sm" icon={<IconPrint />} onClick={() => window.print()}>Print</Button>
      </div>}>
      {d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !w ? <Loading /> : !w.items.length ? <Empty title="Nothing planned">No orders are planned for this stage on this day.</Empty> : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{w.items.length} orders · {num(pieces)} pieces · express first</p>
          <table className="table compact" data-testid="worklist">
            <thead><tr><th>Order</th><th>Customer</th><th className="num">Pieces</th><th>Window</th><th>Lines</th>{(stage === 'prepress' || stage === 'print') && <th>Files</th>}</tr></thead>
            <tbody>
              {w.items.map((i) => (
                <tr key={i.order_id} className="clickable" onClick={() => nav(`/orders/${i.order_id}`)}>
                  <td className="strong nowrap">{i.number} {i.rush && <Badge tone="warn">Rush</Badge>}</td>
                  <td>{i.customer}</td>
                  <td className="num">{num(i.pieces)}</td>
                  <td className="nowrap">{shortDay(i.start)}{i.end !== i.start && ` – ${shortDay(i.end)}`}</td>
                  <td className="small">{i.lines.map((l) => `${l.size}×${l.quantity}${l.player_name ? ` ${l.player_name}` : ''}${l.number ? ` #${l.number}` : ''}`).join(' · ')}</td>
                  {(stage === 'prepress' || stage === 'print') && <td className="small muted">{i.files.length} SVG</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="print-only small">Printed {new Date().toLocaleString()} · tick each order as it leaves the stage.</p>
        </>
      )}
    </Card>
  );
}
