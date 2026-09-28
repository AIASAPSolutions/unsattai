import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, DataTable, ErrorBox, Kpi, Loading, PageHeader, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addDays, day, isoDate, label } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Activity } from '../../lib/types';

const LINK: Record<string, string> = { customer: '/crm/customers/', organisation: '/crm/organisations/', lead: '/crm/leads/', order: '/orders/', ticket: '/crm/tickets/', quote: '/crm/quotes/' };

export function subjectLink(subject: string): { to: string; text: string } {
  const [kind, id] = subject.split(':');
  return { to: `${LINK[kind] ?? '/'}${id}`, text: label(kind) };
}

export default function Tasks() {
  const toast = useToast();
  const { can } = useAuth();
  const { staffName } = useRefData();
  const [mine, setMine] = useState(false);
  const today = isoDate();
  const week = addDays(today, 7);
  const d = useLoad(() => get<{ items: Activity[] }>('/ops/tasks', { mine: mine || undefined, until: week }), [mine]);
  const { busy, run } = useAction();
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const items = d.data.items;
  const due = (a: Activity) => (a.due_at ?? '').slice(0, 10);
  const overdue = items.filter((a) => due(a) < today);
  const todays = items.filter((a) => due(a) === today);
  const later = items.filter((a) => due(a) > today);
  const done = (a: Activity) => run(a.id, async () => { await post(`/ops/activities/${a.id}/done`, {}, { done: true }); toast.success('Task done.'); await d.reload(); }, toast.error);

  const table = (rows: Activity[], empty: string) => (
    <DataTable rows={rows} rowKey={(a) => a.id} compact empty={empty} columns={[
      { key: 'due', header: 'Due', sort: due, render: (a) => <span className={due(a) < today ? 'bad-text strong' : ''}>{day(a.due_at)}</span> },
      { key: 'b', header: 'Task', render: (a) => <span style={{ whiteSpace: 'pre-wrap' }}>{a.body}</span> },
      { key: 's', header: 'About', render: (a) => { const l = subjectLink(a.subject); return <Link to={l.to}>{l.text}</Link>; } },
      { key: 'o', header: 'Owner', render: (a) => staffName(a.owner) },
      { key: 'x', header: '', render: (a) => can('crm') && <Button size="xs" onClick={() => done(a)} busy={busy === a.id} data-testid="task-done">Mark done</Button> },
    ]} />
  );
  return (
    <>
      <PageHeader title="Tasks" subtitle="Follow-ups from leads, customers, orders and tickets."
        actions={<label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>} />
      <div className="kpis" style={{ marginBottom: 16 }}>
        <Kpi k="Overdue" v={overdue.length} alert={overdue.length > 0} />
        <Kpi k="Due today" v={todays.length} />
        <Kpi k="Rest of the week" v={later.length} />
      </div>
      <div className="stack" style={{ gap: 16 }}>
        <Card title={<>Overdue {overdue.length > 0 && <Badge tone="bad">{overdue.length}</Badge>}</>} flush>{table(overdue, 'Nothing overdue.')}</Card>
        <Card title="Due today" flush>{table(todays, 'Nothing due today.')}</Card>
        <Card title="This week" flush>{table(later, 'Nothing else this week.')}</Card>
      </div>
    </>
  );
}
