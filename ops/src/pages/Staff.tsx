import { useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, ErrorBox, Field, Loading, Modal, PageHeader, StatusBadge, useToast } from '../components/ui';
import { IconPlus } from '../components/icons';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ApiError, errorText } from '../lib/errors';
import { dateTime } from '../lib/format';
import { useAction, useLoad } from '../lib/hooks';
import { ROLE_HELP, ROLE_LABEL, type Role } from '../lib/permissions';
import { useRefData } from '../lib/refdata';
import type { Staff } from '../lib/types';

const ROLES: Role[] = ['admin', 'manager', 'sales', 'production', 'dispatch', 'viewer'];

export default function StaffPage() {
  const { can, staff: me } = useAuth();
  const { reload: reloadRef } = useRefData();
  const toast = useToast();
  const d = useLoad(() => get<{ items: Staff[] }>('/ops/staff'), []);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Staff | null>(null);
  const { busy, run } = useAction();
  if (!can('staff')) return <><PageHeader title="Staff" /><Alert tone="warn">Only admins manage staff accounts.</Alert></>;
  if (d.error && !d.data) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const change = (s: Staff, body: Record<string, unknown>, ok: string) => run(s.id, async () => {
    await patch(`/ops/staff/${s.id}`, body);
    toast.success(ok);
    await d.reload();
    void reloadRef();
  }, toast.error);
  return (
    <>
      <PageHeader title="Staff" subtitle="Who can sign in to UrJersey Ops, and what their role lets them do."
        actions={<Button variant="primary" icon={<IconPlus />} onClick={() => setCreating(true)} data-testid="new-staff">Add staff</Button>} />
      <Card flush>
        <DataTable rows={d.data.items} rowKey={(s) => s.id} testId="staff-table" columns={[
          { key: 'n', header: 'Name', sort: (s) => s.name, render: (s) => <div><b>{s.name || '—'}</b> {s.id === me?.id && <Badge tone="accent">You</Badge>}<div className="muted small">{s.email}</div></div> },
          { key: 'r', header: 'Role', sort: (s) => s.role, render: (s) => (
            <select className="sm" style={{ width: 'auto' }} value={s.role} disabled={s.id === me?.id || busy === s.id} aria-label={`Role of ${s.email}`}
              onChange={(e) => change(s, { role: e.target.value }, `${s.email} is now ${ROLE_LABEL[e.target.value as Role]}.`)} data-testid={`role-${s.email}`}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>) },
          { key: 'a', header: 'Status', sort: (s) => String(s.active), render: (s) => <StatusBadge status={s.active ? 'active' : 'inactive'} /> },
          { key: 'c', header: 'Added', sort: (s) => s.created_at, render: (s) => <span className="small muted">{dateTime(s.created_at)}</span> },
          { key: 'x', header: '', render: (s) => s.id !== me?.id && (
            <div className="row tight" style={{ flexWrap: 'nowrap' }}>
              <Button size="xs" onClick={() => setResetting(s)}>Reset password</Button>
              {s.active
                ? <Button size="xs" variant="danger" busy={busy === s.id} onClick={() => change(s, { active: false }, `${s.email} deactivated. Their sessions stop working.`)}>Deactivate</Button>
                : <Button size="xs" busy={busy === s.id} onClick={() => change(s, { active: true }, `${s.email} reactivated.`)}>Reactivate</Button>}
            </div>) },
        ]} />
      </Card>
      <Card title="Roles" className="" >
        <dl className="kv">{ROLES.map((r) => <div key={r} style={{ display: 'contents' }}><dt>{ROLE_LABEL[r]}</dt><dd>{ROLE_HELP[r]}</dd></div>)}</dl>
      </Card>
      {creating && <NewStaff onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await d.reload(); void reloadRef(); }} />}
      {resetting && <ResetPassword s={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function NewStaff({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: '', email: '', role: 'sales' as Role, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useAction();
  const submit = () => run('c', async () => {
    setErr(null);
    await post('/ops/staff', { ...v, email: v.email.trim(), name: v.name.trim() });
    toast.success(`${v.email} can now sign in. Share the password securely; they should change it.`);
    onDone();
  }, (e) => setErr(e instanceof ApiError && e.fields.length ? e.fields.map((f) => `${f.path}: ${f.message}`).join(' ') : errorText(e)));
  return (
    <Modal open title="Add staff" onClose={onClose} testId="staff-dialog"
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!v.name.trim() || !v.email.trim() || !v.password} onClick={submit} data-testid="staff-submit">Add staff</Button></>}>
      {err && <Alert tone="error">{err}</Alert>}
      <div className="form-grid">
        <Field label="Name"><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} data-testid="staff-name" /></Field>
        <Field label="Email"><input type="email" value={v.email} maxLength={120} onChange={(e) => setV({ ...v, email: e.target.value })} data-testid="staff-email" /></Field>
        <Field label="Role" hint={ROLE_HELP[v.role]}>
          <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })} data-testid="staff-role">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </Field>
        <Field label="Initial password" hint="10+ characters with upper and lower case and a digit.">
          <input type="text" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} data-testid="staff-password" />
        </Field>
      </div>
    </Modal>
  );
}

function ResetPassword({ s, onClose }: { s: Staff; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useAction();
  return (
    <Modal open title={`Reset password for ${s.email}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" busy={!!busy} disabled={!pw} onClick={() => run('r', async () => {
        setErr(null);
        await patch(`/ops/staff/${s.id}`, { password: pw });
        toast.success('Password reset. Share it securely.');
        onClose();
      }, (e) => setErr(errorText(e)))}>Reset password</Button></>}>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="New password" hint="10+ characters with upper and lower case and a digit."><input type="text" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Alert tone="warn">Existing sessions stay signed in until they expire (one day). Deactivate the account to lock someone out at once.</Alert>
    </Modal>
  );
}
