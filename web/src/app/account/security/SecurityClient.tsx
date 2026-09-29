'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/components/providers/session';
import { Banner, Button, Card, ErrorState, Skeleton, StatusChip, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { Me, Session } from '@/lib/api/types';
import { formatDateTime } from '@/lib/price';
import { isEmail, passwordIssues } from '@/lib/signin';
import { checkPhone } from '@/lib/validation';
import s from '../account.module.css';

/** Login and security: password, verified mobile number and email, signed-in devices. */
export function SecurityClient() {
  const { me } = useSession();
  return me ? (
    <div className="stack" style={{ gap: 20 }} data-testid="account-security">
      <PasswordCard me={me} />
      <IdentifierCard me={me} kind="phone" />
      <IdentifierCard me={me} kind="email" />
      <SessionsCard />
    </div>
  ) : null;
}

function PasswordCard({ me }: { me: Me }) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const weak = passwordIssues(next);
  const mismatch = next !== again;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setMsg(null);
    if (weak.length || mismatch) return;
    setBusy(true);
    try {
      const r = await api.setPassword(next, current || undefined);
      setMsg({ tone: 'pass', text: r.other_sessions_signed_out ? t('passwordSavedOthers', { n: r.other_sessions_signed_out }) : t('passwordSaved') });
      setCurrent('');
      setNext('');
      setAgain('');
      setTried(false);
      await refresh();
    } catch (x) {
      setMsg({ tone: 'fail', text: x instanceof ApiError && x.status === 401 ? t('passwordCurrentWrong') : errorMessage(t, x) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={t('passwordTitle')} sub={me.has_password ? t('passwordIsSet') : t('passwordNotSet')} testId="password-card">
      <form className="stack" onSubmit={submit} noValidate>
        {me.has_password ? (
          <TextField label={t('passwordCurrent')} value={current} onValue={setCurrent} type="password" autoComplete="current-password"
            maxLength={200} hint={t('passwordCurrentHint')} testId="password-current" />
        ) : null}
        <TextField label={t('passwordNew')} value={next} onValue={setNext} type="password" autoComplete="new-password" maxLength={200}
          hint={t('passwordRule')} error={tried && weak.length ? t('passwordWeak') : null} testId="password-new" />
        <TextField label={t('passwordAgain')} value={again} onValue={setAgain} type="password" autoComplete="new-password" maxLength={200}
          error={tried && mismatch ? t('passwordMismatch') : null} testId="password-again" />
        {msg ? <Banner tone={msg.tone} live testId="password-msg">{msg.text}</Banner> : null}
        <div><Button type="submit" busy={busy} testId="password-save">{me.has_password ? t('passwordChange') : t('passwordSet')}</Button></div>
      </form>
    </Card>
  );
}

function IdentifierCard({ me, kind }: { me: Me; kind: 'phone' | 'email' }) {
  const { t } = useI18n();
  const { setMe } = useSession();
  const value = kind === 'phone' ? me.phone : me.email;
  const verified = kind === 'phone' ? me.phone_verified : me.email_verified;
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [dev, setDev] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);
  const id = `ident-${kind}`;

  const body = (v: string) => (kind === 'phone' ? { phone: v } : { email: v });
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = input.trim();
    if (kind === 'phone' ? checkPhone(v) : !isEmail(v)) {
      setMsg({ tone: 'fail', text: t(kind === 'phone' ? 'otpPhoneInvalid' : 'emailInvalid') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.requestIdentifier(body(v));
      setSent((kind === 'phone' ? r.phone : r.email) ?? v);
      setDev(r.dev_code ?? null);
    } catch (x) {
      setMsg({ tone: 'fail', text: errorMessage(t, x) });
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sent || !/^\d{4,8}$/.test(code)) {
      setMsg({ tone: 'fail', text: t('otpCodeInvalid') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.verifyIdentifier({ ...body(sent), code });
      setMe(updated);
      setEditing(false);
      setSent(null);
      setCode('');
      setInput('');
      setMsg({ tone: 'pass', text: t(kind === 'phone' ? 'phoneVerified' : 'emailVerified') });
    } catch (x) {
      setMsg({ tone: 'fail', text: x instanceof ApiError && x.status === 401 ? t('otpWrong') : errorMessage(t, x) });
    } finally {
      setBusy(false);
    }
  };
  const label = kind === 'phone' ? t('mobileNumber') : t('email');
  return (
    <Card title={label} testId={`${id}-card`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong className="tnum" data-testid={`${id}-value`}>{value || t('notAdded')}</strong>{' '}
          {value ? <StatusChip tone={verified ? 'pass' : 'warn'} testId={`${id}-status`}>{verified ? t('verified') : t('notVerified')}</StatusChip> : null}
          <div className="small muted">{kind === 'phone' ? t('phoneUse') : t('emailUse')}</div>
        </div>
        {!editing ? (
          <Button kind="secondary" size="sm" onClick={() => { setEditing(true); setInput(verified ? '' : value); setMsg(null); }} testId={`${id}-edit`}>
            {!value ? t('add') : verified ? t('change') : t('verify')}
          </Button>
        ) : null}
      </div>
      {editing ? (
        sent ? (
          <form onSubmit={verify} className="stack" style={{ marginTop: 12 }} noValidate>
            <p className="small" style={{ margin: 0 }}>{t('otpSentToAny', { to: sent })}</p>
            {dev ? <Banner tone="info">{t('otpDevHint')} <strong data-testid={`${id}-dev-code`}>{dev}</strong></Banner> : null}
            <TextField label={t('otpCode')} value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))} inputMode="numeric"
              autoComplete="one-time-code" testId={`${id}-code`} />
            <div className="row">
              <Button type="submit" busy={busy} testId={`${id}-verify`}>{t('verify')}</Button>
              <Button kind="ghost" onClick={() => { setSent(null); setCode(''); }}>{t('back')}</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={send} className="stack" style={{ marginTop: 12 }} noValidate>
            <TextField label={kind === 'phone' ? t('newMobile') : t('newEmail')} value={input} onValue={setInput}
              type={kind === 'phone' ? 'tel' : 'email'} autoComplete={kind === 'phone' ? 'tel' : 'email'} maxLength={kind === 'phone' ? 24 : 120}
              testId={`${id}-input`} />
            <div className="row">
              <Button type="submit" busy={busy} testId={`${id}-send`}>{t('otpSend')}</Button>
              <Button kind="ghost" onClick={() => { setEditing(false); setMsg(null); }}>{t('cancel')}</Button>
            </div>
          </form>
        )
      ) : null}
      {msg ? <div style={{ marginTop: 10 }}><Banner tone={msg.tone} live testId={`${id}-msg`}>{msg.text}</Banner></div> : null}
    </Card>
  );
}

function SessionsCard() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Session[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    api.sessions().then((r) => { setItems(r.items); setError(null); }).catch(setError);
  }, []);
  useEffect(() => {
    let live = true;
    api.sessions().then((r) => live && setItems(r.items)).catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, []);
  const drop = async (id: string) => {
    setBusy(id);
    try {
      await api.dropSession(id);
      setMsg(t('sessionSignedOut'));
      load();
    } catch (e) {
      setMsg(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };
  const others = async () => {
    setBusy('others');
    try {
      const r = await api.revokeOtherSessions();
      setMsg(t('sessionsSignedOut', { n: r.signed_out }));
      load();
    } catch (e) {
      setMsg(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card title={t('devicesTitle')} sub={t('devicesText')} testId="sessions-card">
      {error ? <ErrorState message={errorMessage(t, error)} retryLabel={t('retry')} onRetry={load} />
        : !items ? <Skeleton height={80} /> : (
          <ul className={s.list} data-testid="sessions">
            {items.map((x) => (
              <li key={x.id} className={s.item} data-testid={x.current ? 'session-current' : 'session-other'}>
                <div>
                  <div className={s.itemTitle}>{x.device_label || t('unknownDevice')} {x.current ? <StatusChip tone="pass">{t('thisDevice')}</StatusChip> : null}</div>
                  <div className={s.itemMeta}>{t('signedInOn', { date: formatDateTime(x.created_at, lang) })} · {t('lastSeen', { date: formatDateTime(x.last_seen_at, lang) })}</div>
                </div>
                {!x.current ? <Button kind="ghost" size="sm" busy={busy === x.id} onClick={() => void drop(x.id)} testId={`session-drop-${x.id}`}>{t('navSignOut')}</Button> : null}
              </li>
            ))}
          </ul>
        )}
      {msg ? <div style={{ marginTop: 10 }}><Banner tone="info" live testId="sessions-msg">{msg}</Banner></div> : null}
      {items && items.some((x) => !x.current) ? (
        <div style={{ marginTop: 12 }}>
          <Button kind="danger" busy={busy === 'others'} onClick={others} testId="sessions-revoke-others">{t('signOutOthers')}</Button>
        </div>
      ) : null}
    </Card>
  );
}
