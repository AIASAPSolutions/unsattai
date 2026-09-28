import { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ButtonTabs, Card, DataTable, Empty, ErrorBox, Kpi, Loading, PageHeader, SearchInput, Tabs } from '../../components/ui';
import { get } from '../../lib/api';
import { addDays, dateTime, GARMENT_LABEL, isoDate, label, money0, num, shortDay } from '../../lib/format';
import { useDebounced, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { AuditRow } from '../../lib/types';

export default function Reports() {
  return (
    <>
      <PageHeader title="Reports" />
      <Tabs tabs={[{ to: '/reports/sales', label: 'Sales' }, { to: '/reports/audit', label: 'Audit log' }]} />
      <Routes>
        <Route index element={<Navigate to="sales" replace />} />
        <Route path="sales" element={<Sales />} />
        <Route path="audit" element={<Audit />} />
      </Routes>
    </>
  );
}

interface SalesReport { days: { date: string; orders: number; revenue: number; pieces: number }[]; by_garment: Record<string, number>; by_channel: Record<string, number>; orders: number; revenue: number; pieces: number }

/** Every calendar day in the range, so gaps show as zero instead of disappearing. */
export function fillDays(days: SalesReport['days'], since: string, until: string): SalesReport['days'] {
  const by = new Map(days.map((d) => [d.date, d]));
  const out: SalesReport['days'] = [];
  for (let d = since; d <= until && out.length < 800; d = addDays(d, 1)) out.push(by.get(d) ?? { date: d, orders: 0, revenue: 0, pieces: 0 });
  return out;
}

function Sales() {
  const { currency } = useRefData();
  const today = isoDate();
  const [since, setSince] = useState(addDays(today, -29));
  const [until, setUntil] = useState(today);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const d = useLoad(() => get<SalesReport>('/ops/reports/sales', { since, until }), [since, until]);
  const days = useMemo(() => (d.data ? fillDays(d.data.days, since, until) : []), [d.data, since, until]);
  const preset = (n: number) => { setSince(addDays(today, -(n - 1))); setUntil(today); };
  const r = d.data;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <label className="row tight">From <input type="date" value={since} max={until} onChange={(e) => e.target.value && setSince(e.target.value)} style={{ width: 'auto' }} /></label>
        <label className="row tight">to <input type="date" value={until} min={since} onChange={(e) => e.target.value && setUntil(e.target.value)} style={{ width: 'auto' }} /></label>
        <Button size="sm" onClick={() => preset(7)}>7 days</Button>
        <Button size="sm" onClick={() => preset(30)}>30 days</Button>
        <Button size="sm" onClick={() => preset(90)}>90 days</Button>
        <span className="muted small">Paid orders (not awaiting payment or cancelled), by order date.</span>
      </div>
      {d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : !r ? <Loading /> : (
        <>
          <div className="kpis">
            <Kpi k="Revenue" v={money0(r.revenue, currency)} testId="report-revenue" />
            <Kpi k="Orders" v={num(r.orders)} />
            <Kpi k="Pieces" v={num(r.pieces)} />
            <Kpi k="Average order" v={money0(r.orders ? r.revenue / r.orders : 0, currency)} />
          </div>
          <Card title="Per day" actions={<ButtonTabs value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />}>
            {!r.orders ? <Empty title="No paid orders in this period" /> : view === 'chart' ? (
              <div className="stack" style={{ gap: 20 }}>
                <DayChart title={`Revenue (${currency})`} data={days} dataKey="revenue" format={(v) => money0(v, currency)} height={220} />
                <div className="grid grid-2">
                  <DayChart title="Orders" data={days} dataKey="orders" format={num} height={150} />
                  <DayChart title="Pieces" data={days} dataKey="pieces" format={num} height={150} />
                </div>
              </div>
            ) : (
              <DataTable rows={[...days].reverse()} rowKey={(x) => x.date} compact pageSize={31} columns={[
                { key: 'd', header: 'Date', sort: (x) => x.date, render: (x) => x.date },
                { key: 'o', header: 'Orders', num: true, sort: (x) => x.orders, render: (x) => num(x.orders) },
                { key: 'p', header: 'Pieces', num: true, sort: (x) => x.pieces, render: (x) => num(x.pieces) },
                { key: 'r', header: 'Revenue', num: true, sort: (x) => x.revenue, render: (x) => money0(x.revenue, currency) },
              ]} />
            )}
          </Card>
          <div className="grid grid-2">
            <Breakdown title="By garment" data={r.by_garment} total={r.revenue} currency={currency} name={(k) => GARMENT_LABEL[k] ?? label(k)} />
            <Breakdown title="By channel" data={r.by_channel} total={r.revenue} currency={currency} name={label} />
          </div>
        </>
      )}
    </div>
  );
}

function DayChart({ title, data, dataKey, format, height }: { title: string; data: SalesReport['days']; dataKey: 'revenue' | 'orders' | 'pieces'; format: (v: number) => string; height: number }) {
  return (
    <figure style={{ margin: 0 }} aria-label={title}>
      <figcaption className="small strong" style={{ marginBottom: 6 }}>{title}</figcaption>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border-strong)' }} minTickGap={24} />
          <YAxis tickFormatter={(v: number) => (dataKey === 'revenue' ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'var(--surface-3)' }} formatter={(v) => [format(Number(v)), title]} labelFormatter={(l) => shortDay(String(l))}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text)' }} />
          <Bar dataKey={dataKey} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}

function Breakdown({ title, data, total, currency, name }: { title: string; data: Record<string, number>; total: number; currency: string; name: (k: string) => string }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] || 1;
  return (
    <Card title={title}>
      {!rows.length ? <span className="muted">No data.</span> : (
        <div className="stack tight">
          {rows.map(([k, v]) => (
            <div key={k} className="row" style={{ flexWrap: 'nowrap' }} title={`${name(k)}: ${money0(v, currency)}`}>
              <span style={{ width: 140 }} className="ellipsis">{name(k)}</span>
              <div className="util-bar" style={{ height: 12 }}><div style={{ width: `${(100 * v) / max}%` }} /></div>
              <span className="num" style={{ width: 100 }}>{money0(v, currency)}</span>
              <span className="num muted small" style={{ width: 44 }}>{total ? Math.round((100 * v) / total) : 0}%</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const SUBJECT_LINK: Record<string, string> = { order: '/orders/', customer: '/crm/customers/', lead: '/crm/leads/', quote: '/crm/quotes/', ticket: '/crm/tickets/', organisation: '/crm/organisations/' };

function Audit() {
  const [params, setParams] = useSearchParams();
  const { who } = useRefData();
  const [subject, setSubject] = useState(params.get('subject') ?? '');
  const ds = useDebounced(subject.trim(), 400);
  const d = useLoad(() => get<{ items: AuditRow[] }>('/ops/audit', { subject: ds || undefined }), [ds]);
  return (
    <Card flush>
      <div className="card-body row">
        <SearchInput value={subject} onChange={(v) => { setSubject(v); setParams(v ? { subject: v } : {}, { replace: true }); }} placeholder="Subject, e.g. order:ord_… or settings:price_book" />
        <span className="muted small">Exact subject match. The latest 200 entries are shown.</span>
        <span style={{ flex: 1 }} />
        {['settings:price_book', 'settings:production', 'settings:delivery'].map((s) => <button key={s} className="chip" onClick={() => setSubject(s)}>{s}</button>)}
      </div>
      {d.error ? <div className="card-body"><ErrorBox error={d.error} onRetry={d.reload} /></div> : (
        <DataTable rows={d.data?.items ?? []} rowKey={(a) => String(a.id)} compact pageSize={50} testId="audit-table" empty={d.loading ? 'Loading…' : 'No entries.'} columns={[
          { key: 'at', header: 'When', sort: (a) => a.at, render: (a) => <span className="nowrap">{dateTime(a.at)}</span> },
          { key: 'who', header: 'Who', sort: (a) => a.actor, render: (a) => who(a.actor) },
          { key: 'action', header: 'Action', sort: (a) => a.action, render: (a) => <code>{a.action}</code> },
          { key: 'subject', header: 'Subject', render: (a) => {
            const [kind, id] = a.subject.split(':');
            const to = SUBJECT_LINK[kind];
            return <span className="row tight">{to ? <Link to={`${to}${id}`}>{a.subject}</Link> : <code>{a.subject}</code>}<button className="linklike small" onClick={() => setSubject(a.subject)}>filter</button></span>;
          } },
          { key: 'detail', header: 'Detail', render: (a) => <span className="small muted">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</span> },
        ]} />
      )}
    </Card>
  );
}
