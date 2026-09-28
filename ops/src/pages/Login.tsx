import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { env } from '../lib/env';
import { errorText } from '../lib/errors';

export function LoginPage() {
  const { me, login, notice, ready } = useAuth();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (ready && me) return <Navigate to={(loc.state as { from?: string } | null)?.from || '/dashboard'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit} data-testid="login-form">
        <div className="card-body">
          <div className="row" style={{ gap: 10 }}>
            <span className="brand-mark" style={{ width: 36, height: 36, borderRadius: 9, background: '#1f5fbf', display: 'grid', placeItems: 'center' }}>
              <svg viewBox="0 0 32 32" width="24" height="24"><path d="M9 8l4-2h6l4 2 3 5-4 2v11H10V15l-4-2z" fill="white" /></svg>
            </span>
            <div><h1>UrJersey Ops</h1><div className="muted small">Staff sign-in</div></div>
          </div>
          {notice && <Alert tone="warn">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email" htmlFor="email">
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" busy={busy} data-testid="login-submit">Sign in</Button>
          <div className="muted small">Server: {env.apiBase}. Sessions last one day. Forgot your password? Ask an admin to reset it.</div>
        </div>
      </form>
    </div>
  );
}
