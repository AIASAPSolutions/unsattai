import { useState } from 'react';
import { Alert, Badge, Button, Card, Field } from '../../components/ui';
import { get, post } from '../../lib/api';
import { useLoad } from '../../lib/hooks';

interface MessagingInfo { sms: string; email: string; problems: string[] }
interface TestResult { channel: 'sms' | 'email'; to: string; provider: string; result: 'sent' | 'logged' | 'failed' }

const NAMES: Record<string, string> = {
  log: 'Not connected (server log only)', msg91: 'MSG91', twilio: 'Twilio', webhook: 'Webhook', smtp: 'SMTP', resend: 'Resend',
};

/** Which SMS and email services the server uses, and a test send. The services are set in the
 * server's environment variables (SMS_PROVIDER, EMAIL_PROVIDER, …), never in this app. */
export function MessagingSetup() {
  const d = useLoad(() => get<MessagingInfo>('/ops/messaging'), []);
  const [channel, setChannel] = useState<'sms' | 'email'>('email');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  async function send() {
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await post<TestResult>('/ops/messaging/test', { channel, to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const info = d.data;
  return (
    <Card title="SMS and email services" className="messaging-setup">
      <div className="card-body stack">
        {info && (
          <div className="row">
            <span>SMS: <Badge tone={info.sms === 'log' ? 'warn' : 'good'} dot>{NAMES[info.sms] ?? info.sms}</Badge></span>
            <span>Email: <Badge tone={info.email === 'log' ? 'warn' : 'good'} dot>{NAMES[info.email] ?? info.email}</Badge></span>
          </div>
        )}
        {info?.problems.map((p) => <Alert key={p} tone="warn">{p}</Alert>)}
        <p className="muted small">These are set in the server's environment variables (SMS_PROVIDER, EMAIL_PROVIDER and their keys), then the API is restarted. See docs/configuration.md.</p>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Send a test" htmlFor="msg-test-channel">
            <select id="msg-test-channel" value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')}>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </Field>
          <Field label={channel === 'sms' ? 'Mobile number' : 'Email address'} htmlFor="msg-test-to">
            <input id="msg-test-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'sms' ? '98765 43210' : 'you@example.com'} />
          </Field>
          <Button variant="primary" busy={busy} disabled={to.trim().length < 5} onClick={send} data-testid="messaging-test-send">Send test</Button>
        </div>
        {result && (
          <Alert tone={result.result === 'sent' ? 'good' : result.result === 'failed' ? 'error' : 'info'}>
            {result.result === 'sent' && `Sent to ${result.to} through ${NAMES[result.provider] ?? result.provider}. Check that it arrived.`}
            {result.result === 'failed' && `Sending through ${NAMES[result.provider] ?? result.provider} failed. The server log has the reason.`}
            {result.result === 'logged' && 'No service is connected, so the message was only written to the server log.'}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Card>
  );
}
