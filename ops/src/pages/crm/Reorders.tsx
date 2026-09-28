import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, DataTable, ErrorBox, Loading, PageHeader, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { day, isoDate, money0, num } from '../../lib/format';
import { useAction, useLoad } from '../../lib/hooks';
import { useRefData } from '../../lib/refdata';
import type { Customer } from '../../lib/types';

export default function Reorders() {
  const toast = useToast();
  const { can } = useAuth();
  const { currency, settings, staffName } = useRefData();
  const d = useLoad(() => get<{ items: Customer[] }>('/ops/reorders'), []);
  const { busy, run } = useAction();
  const [queued, setQueued] = useState<Set<string>>(new Set());
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const days = settings?.crm.value.reorder_reminder_days;
  const remind = (c: Customer) => run(c.id, async () => {
    await post('/ops/activities', { kind: 'task', subject: `customer:${c.id}`, body: `Reorder reminder: call ${c.name || c.phone} (${c.phone}) about a new kit.`, due_at: isoDate() });
    setQueued((s) => new Set(s).add(c.id));
    toast.success('Task added for today.');
  }, toast.error);
  return (
    <>
      <PageHeader title="Reorder reminders" subtitle={days ? `Paying customers whose last order is more than ${days} days old, highest value first. Change the period in Settings → CRM lists.` : 'Reminders are off (Settings → CRM lists).'} />
      <Card flush>
        <DataTable rows={d.data.items} rowKey={(c) => c.id} testId="reorders" empty="No customers are due for a reminder." columns={[
          { key: 'n', header: 'Customer', sort: (c) => c.name, render: (c) => <div><Link to={`/crm/customers/${c.id}`} className="strong">{c.name || 'No name'}</Link><div className="muted small">{c.phone}</div></div> },
          { key: 'l', header: 'Last order', sort: (c) => c.last_order_at, render: (c) => day(c.last_order_at, true) },
          { key: 'o', header: 'Orders', num: true, sort: (c) => c.orders_count, render: (c) => num(c.orders_count) },
          { key: 'v', header: 'Lifetime value', num: true, sort: (c) => c.lifetime_value, render: (c) => money0(c.lifetime_value, currency) },
          { key: 'ow', header: 'Owner', render: (c) => staffName(c.owner) },
          { key: 'x', header: '', render: (c) => can('crm') && (queued.has(c.id) ? <span className="muted small">Task added</span> : <Button size="xs" onClick={() => remind(c)} busy={busy === c.id}>Add call task</Button>) },
        ]} />
      </Card>
    </>
  );
}
