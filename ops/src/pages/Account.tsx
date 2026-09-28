import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, PageHeader, useToast } from '../components/ui';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { dateTime } from '../lib/format';
import { ROLE_HELP, ROLE_LABEL } from '../lib/permissions';

export default function Account() {
  const { staff, me, logout } = useAuth();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!staff) return null;
  const mismatch = again !== '' && again !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) return;
    setBusy(true);
    setError(null);
    try {
      await post('/ops/me/password', { current: cur, new: next });
      toast.success('Password changed.');
      setCur(''); setNext(''); setAgain('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Your account" actions={<Button onClick={() => void logout()}>Sign out</Button>} />
      <div className="grid grid-2">
        <Card title="Profile">
          <dl className="kv">
            <dt>Name</dt><dd>{staff.name || '—'}</dd>
            <dt>Email</dt><dd>{staff.email}</dd>
            <dt>Role</dt><dd>{ROLE_LABEL[staff.role]} <span className="muted">— {ROLE_HELP[staff.role]}</span></dd>
            <dt>Permissions</dt><dd>{me?.permissions.includes('*') ? 'Everything' : me?.permissions.join(', ')}</dd>
            <dt>Since</dt><dd>{dateTime(staff.created_at)}</dd>
          </dl>
        </Card>
        <Card title="Change password">
          <form className="stack" onSubmit={submit}>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Current password"><input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field label="New password" hint="At least 10 characters, upper and lower case letters and a digit.">
              <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="New password again" errors={mismatch ? ['The two passwords are different.'] : undefined}>
              <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
            </Field>
            <div><Button type="submit" variant="primary" busy={busy} disabled={!cur || !next || mismatch}>Change password</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
