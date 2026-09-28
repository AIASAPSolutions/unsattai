/** CRM building blocks shared by customer, organisation and lead screens. */
import { useState } from 'react';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ApiError, errorsAt, errorsByPath } from '../lib/errors';
import { ago, day, isoDate, label, money0 } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { useRefData } from '../lib/refdata';
import { ACTIVITY_KINDS, type Activity, type Customer, type Lead, type Organisation, type Page } from '../lib/types';
import { Alert, Badge, Button, Drawer, Field, TagInput, useToast } from './ui';

// ------------------------------------------------------------------ activity feed

export function ActivityFeed({ subject, items, onChange }: { subject: string; items: Activity[]; onChange: () => void }) {
  const { can } = useAuth();
  const { who, staffName } = useRefData();
  const toast = useToast();
  const [kind, setKind] = useState<Activity['kind']>('note');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const { busy, run } = useAction();
  const add = () => run('add', async () => {
    await post('/ops/activities', { kind, subject, body: body.trim(), due_at: kind === 'task' ? due || isoDate() : due || null });
    setBody(''); setDue('');
    toast.success(kind === 'task' ? 'Task added.' : 'Added to the activity feed.');
    onChange();
  }, toast.error);
  const toggle = (a: Activity) => run(a.id, async () => { await post(`/ops/activities/${a.id}/done`, {}, { done: !a.done }); onChange(); }, toast.error);
  const sorted = [...items].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const today = isoDate();
  return (
    <div className="stack">
      {can('crm') && (
        <div className="stack tight" data-testid="activity-form">
          <div className="row tight">
            {ACTIVITY_KINDS.map((k) => <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)} data-kind={k}>{label(k)}</button>)}
          </div>
          <textarea value={body} maxLength={4000} placeholder={kind === 'task' ? 'What needs doing?' : kind === 'call' ? 'What was discussed on the call?' : 'Write a note…'}
            onChange={(e) => setBody(e.target.value)} data-testid="activity-body" style={{ minHeight: 60 }} />
          <div className="row">
            {(kind === 'task' || kind === 'call' || kind === 'meeting') && (
              <label className="row tight small">{kind === 'task' ? 'Due' : 'Follow up'} <input type="date" className="sm" style={{ width: 'auto' }} value={due} onChange={(e) => setDue(e.target.value)} data-testid="activity-due" /></label>
            )}
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" disabled={!body.trim()} busy={busy === 'add'} onClick={add} data-testid="activity-add">Add {label(kind).toLowerCase()}</Button>
          </div>
        </div>
      )}
      <ul className="timeline" data-testid="activity-feed">
        {sorted.map((a) => (
          <li key={a.id} className={a.kind === 'task' && !a.done ? 'internal' : ''}>
            <div className="row tight" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <div style={{ flex: 1 }}>
                <div className="t"><Badge tone={a.kind === 'task' ? (a.done ? 'good' : 'warn') : 'neutral'}>{label(a.kind)}</Badge> <span style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{a.body}</span></div>
                <div className="m">
                  {ago(a.created_at)} · {who(a.created_by)}
                  {a.due_at && <> · due <span className={!a.done && a.due_at.slice(0, 10) < today ? 'bad-text strong' : ''}>{day(a.due_at)}</span></>}
                  {a.owner && a.owner !== a.created_by && <> · {staffName(a.owner)}</>}
                </div>
              </div>
              {a.kind === 'task' && can('crm') && (
                <Button size="xs" onClick={() => toggle(a)} busy={busy === a.id}>{a.done ? 'Reopen' : 'Done'}</Button>
              )}
            </div>
          </li>
        ))}
        {!sorted.length && <li className="muted" style={{ borderLeftColor: 'transparent' }}>No activity yet.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ customer form

type CustomerIn = Pick<Customer, 'name' | 'phone' | 'email' | 'organisation_id' | 'owner' | 'tags' | 'notes' | 'marketing_opt_in' | 'status'>;
const blankCustomer: CustomerIn = { name: '', phone: '', email: '', organisation_id: '', owner: '', tags: [], notes: '', marketing_opt_in: false, status: 'active' };

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const toast = useToast();
  const { staff } = useRefData();
  const [v, setV] = useState<CustomerIn>(customer ? { ...blankCustomer, ...customer } : blankCustomer);
  const [err, setErr] = useState<ApiError | null>(null);
  const orgs = useLoad(() => get<Page<Organisation>>('/ops/organisations').then((r) => r.items), []);
  const { busy, run } = useAction();
  const errs = errorsByPath(err?.fields ?? []);
  const setF = <K extends keyof CustomerIn>(k: K, x: CustomerIn[K]) => setV((c) => ({ ...c, [k]: x }));
  const save = () => run('save', async () => {
    setErr(null);
    const body = { ...v, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim() };
    const out = customer ? await put<Customer>(`/ops/customers/${customer.id}`, body) : await post<Customer>('/ops/customers', body);
    toast.success(customer ? 'Customer saved.' : 'Customer added.');
    onSaved(out);
  }, (e) => { if (e instanceof ApiError) setErr(e); toast.error(e); });
  return (
    <Drawer open title={customer ? `Edit ${customer.name || customer.phone}` : 'New customer'} onClose={onClose} testId="customer-form"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!v.phone.trim()} onClick={save} data-testid="customer-save">Save</Button></>}>
      {err && !err.fields.length && <Alert tone="error">{err.message}</Alert>}
      <div className="form-grid">
        <Field label="Name" errors={errorsAt(errs, 'name')}><input value={v.name} maxLength={80} onChange={(e) => setF('name', e.target.value)} data-testid="cust-name" /></Field>
        <Field label="Phone" errors={errorsAt(errs, 'phone')} hint="Customers are matched by phone."><input value={v.phone} maxLength={24} onChange={(e) => setF('phone', e.target.value)} data-testid="cust-phone" /></Field>
        <Field label="Email" errors={errorsAt(errs, 'email')}><input type="email" value={v.email} maxLength={120} onChange={(e) => setF('email', e.target.value)} /></Field>
        <Field label="Organisation">
          <select value={v.organisation_id} onChange={(e) => setF('organisation_id', e.target.value)}>
            <option value="">None</option>
            {(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <select value={v.owner} onChange={(e) => setF('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.name || s.email}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={v.status} onChange={(e) => setF('status', e.target.value as CustomerIn['status'])}><option value="active">Active</option><option value="blocked">Blocked</option></select>
        </Field>
        <Field label="Tags" className="wide"><TagInput value={v.tags} onChange={(t) => setF('tags', t.slice(0, 20))} placeholder="e.g. school, vip" /></Field>
        <Field label="Notes" className="wide"><textarea value={v.notes} maxLength={2000} onChange={(e) => setF('notes', e.target.value)} /></Field>
        <label className="check wide"><input type="checkbox" checked={v.marketing_opt_in} onChange={(e) => setF('marketing_opt_in', e.target.checked)} /> Agreed to receive offers</label>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ organisation form

type OrgIn = Pick<Organisation, 'name' | 'kind' | 'city' | 'state' | 'phone' | 'email' | 'owner' | 'tags' | 'notes' | 'status'>;

export function OrganisationForm({ org, onClose, onSaved }: { org?: Organisation | null; onClose: () => void; onSaved: (o: Organisation) => void }) {
  const toast = useToast();
  const { settings, staff } = useRefData();
  const kinds = settings?.crm.value.organisation_kinds ?? ['team'];
  const [v, setV] = useState<OrgIn>(org ? { ...org } : { name: '', kind: kinds[0], city: '', state: '', phone: '', email: '', owner: '', tags: [], notes: '', status: 'active' });
  const { busy, run } = useAction();
  const setF = <K extends keyof OrgIn>(k: K, x: OrgIn[K]) => setV((c) => ({ ...c, [k]: x }));
  const save = () => run('save', async () => {
    const out = org ? await put<Organisation>(`/ops/organisations/${org.id}`, v) : await post<Organisation>('/ops/organisations', v);
    toast.success('Organisation saved.');
    onSaved(out);
  }, toast.error);
  return (
    <Drawer open title={org ? `Edit ${org.name}` : 'New organisation'} onClose={onClose} testId="org-form"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!v.name.trim()} onClick={save} data-testid="org-save">Save</Button></>}>
      <div className="form-grid">
        <Field label="Name" className="wide"><input value={v.name} maxLength={120} onChange={(e) => setF('name', e.target.value)} data-testid="org-name" /></Field>
        <Field label="Kind"><select value={v.kind} onChange={(e) => setF('kind', e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select></Field>
        <Field label="City"><input value={v.city} maxLength={60} onChange={(e) => setF('city', e.target.value)} /></Field>
        <Field label="State"><input value={v.state} maxLength={40} onChange={(e) => setF('state', e.target.value)} /></Field>
        <Field label="Phone"><input value={v.phone} maxLength={24} onChange={(e) => setF('phone', e.target.value)} /></Field>
        <Field label="Email"><input value={v.email} maxLength={120} onChange={(e) => setF('email', e.target.value)} /></Field>
        <Field label="Owner">
          <select value={v.owner} onChange={(e) => setF('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.name || s.email}</option>)}
          </select>
        </Field>
        <Field label="Status"><select value={v.status} onChange={(e) => setF('status', e.target.value as OrgIn['status'])}><option value="active">Active</option><option value="archived">Archived</option></select></Field>
        <Field label="Tags" className="wide"><TagInput value={v.tags} onChange={(t) => setF('tags', t.slice(0, 20))} /></Field>
        <Field label="Notes" className="wide"><textarea value={v.notes} maxLength={2000} onChange={(e) => setF('notes', e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ lead form

export type LeadIn = Pick<Lead, 'title' | 'stage' | 'customer_id' | 'organisation_id' | 'value' | 'pieces' | 'source' | 'owner' | 'expected_close' | 'lost_reason' | 'notes'>;
export function leadInput(l: Lead, patch: Partial<LeadIn> = {}): LeadIn {
  return { title: l.title, stage: l.stage, customer_id: l.customer_id || '', organisation_id: l.organisation_id || '', value: l.value || 0,
    pieces: l.pieces || 0, source: l.source || 'other', owner: l.owner || '', expected_close: l.expected_close || null,
    lost_reason: l.lost_reason || '', notes: l.notes || '', ...patch };
}

export function LeadForm({ lead, preset, onClose, onSaved }: { lead?: Lead | null; preset?: Partial<LeadIn>; onClose: () => void; onSaved: (l: Lead) => void }) {
  const toast = useToast();
  const { settings, staff } = useRefData();
  const crm = settings?.crm.value;
  const [v, setV] = useState<LeadIn>(lead ? leadInput(lead) : {
    title: '', stage: crm?.lead_stages[0] ?? 'new', customer_id: '', organisation_id: '', value: 0, pieces: 0, source: crm?.lead_sources[0] ?? 'other',
    owner: '', expected_close: null, lost_reason: '', notes: '', ...preset,
  });
  const [value, setValue] = useState(String(v.value || ''));
  const [pieces, setPieces] = useState(String(v.pieces || ''));
  const [custQ, setCustQ] = useState('');
  const custs = useLoad(() => get<Page<Customer>>('/ops/customers', { q: custQ || undefined }).then((r) => r.items), [custQ]);
  const orgs = useLoad(() => get<Page<Organisation>>('/ops/organisations').then((r) => r.items), []);
  const { busy, run } = useAction();
  const setF = <K extends keyof LeadIn>(k: K, x: LeadIn[K]) => setV((c) => ({ ...c, [k]: x }));
  const save = () => run('save', async () => {
    const body = { ...v, title: v.title.trim(), value: Number(value) || 0, pieces: Math.round(Number(pieces) || 0) };
    const out = lead ? await put<Lead>(`/ops/leads/${lead.id}`, body) : await post<Lead>('/ops/leads', body);
    toast.success(lead ? 'Lead saved.' : 'Lead created.');
    onSaved(out);
  }, toast.error);
  const custOptions = custs.data ?? [];
  return (
    <Drawer open title={lead ? 'Edit lead' : 'New lead'} onClose={onClose} testId="lead-form"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!v.title.trim()} onClick={save} data-testid="lead-save">Save</Button></>}>
      <div className="form-grid">
        <Field label="Title" className="wide"><input value={v.title} maxLength={120} onChange={(e) => setF('title', e.target.value)} placeholder="e.g. St. Mary's school, 120 football jerseys" data-testid="lead-title" /></Field>
        <Field label="Stage"><select value={v.stage} onChange={(e) => setF('stage', e.target.value)}>{(crm?.lead_stages ?? [v.stage]).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
        <Field label="Source"><select value={v.source} onChange={(e) => setF('source', e.target.value)}>{(crm?.lead_sources ?? [v.source]).map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
        <Field label="Value"><input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Pieces"><input inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} /></Field>
        <Field label="Expected close"><input type="date" value={v.expected_close ?? ''} onChange={(e) => setF('expected_close', e.target.value || null)} /></Field>
        <Field label="Owner">
          <select value={v.owner} onChange={(e) => setF('owner', e.target.value)}>
            <option value="">Unassigned</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={`staff:${s.id}`}>{s.name || s.email}</option>)}
          </select>
        </Field>
        <Field label="Customer" className="wide" hint="Search by name or phone.">
          <div className="row tight" style={{ flexWrap: 'nowrap' }}>
            <input placeholder="Search…" value={custQ} onChange={(e) => setCustQ(e.target.value)} style={{ maxWidth: 160 }} />
            <select value={v.customer_id} onChange={(e) => setF('customer_id', e.target.value)}>
              <option value="">None</option>
              {v.customer_id && !custOptions.some((c) => c.id === v.customer_id) && <option value={v.customer_id}>Current customer</option>}
              {custOptions.map((c) => <option key={c.id} value={c.id}>{c.name || 'No name'} · {c.phone}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Organisation" className="wide">
          <select value={v.organisation_id} onChange={(e) => setF('organisation_id', e.target.value)}>
            <option value="">None</option>
            {(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        {v.stage === 'lost' && <Field label="Lost reason" className="wide"><input value={v.lost_reason} maxLength={300} onChange={(e) => setF('lost_reason', e.target.value)} /></Field>}
        <Field label="Notes" className="wide"><textarea value={v.notes} maxLength={2000} onChange={(e) => setF('notes', e.target.value)} /></Field>
      </div>
    </Drawer>
  );
}

export function LeadValue({ l, currency }: { l: Lead; currency: string }) {
  return <>{l.value ? money0(l.value, currency) : <span className="muted">No value</span>}{l.pieces ? <span className="muted"> · {l.pieces} pcs</span> : null}</>;
}
