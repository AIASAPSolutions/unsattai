'use client';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/providers/session';
import { Banner, Button, Tabs, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api, passwordLogin, verifyOtp } from '@/lib/api/endpoints';
import type { Me } from '@/lib/api/types';
import { isEmail, type Channel } from '@/lib/signin';
import { checkPhone } from '@/lib/validation';

/**
 * Sign in with a mobile number or an email: by one-time code (a new account is made on
 * first sign-in) or by password. Codes and passwords are checked by our own route
 * handlers, which keep the session token in an httpOnly cookie. When the server runs in
 * development mode it returns the code (dev_code) and we show it as a hint.
 */
export function SignInForm({ onSignedIn, initialPhone = '', initialEmail = '', initialName = '', askName = true, testId = 'otp' }: {
  onSignedIn?: (me: Me) => void; initialPhone?: string; initialEmail?: string; initialName?: string; askName?: boolean; testId?: string;
}) {
  const t = useT();
  const { setMe } = useSession();
  const [channel, setChannel] = useState<Channel>(initialEmail && !initialPhone ? 'email' : 'phone');
  const [method, setMethod] = useState<'code' | 'password'>('code');
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<{ phone: string } | { email: string } | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | 'login' | null>(null);
  const [error, setError] = useState<{ text: string; locked?: boolean } | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const value = channel === 'phone' ? phone : email;
  const invalid = () => (channel === 'phone' ? !!checkPhone(phone) : !isEmail(email));
  const invalidText = () => t(channel === 'phone' ? 'otpPhoneInvalid' : 'emailInvalid');

  const done = (customer: Me) => {
    setMe(customer);
    onSignedIn?.(customer);
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (invalid()) {
      setError({ text: invalidText() });
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const res = await api.requestOtp(channel === 'phone' ? { phone: phone.trim() } : { email: email.trim() });
      setSentTo(channel === 'phone' ? { phone: res.phone ?? phone.trim() } : { email: res.email ?? email.trim() });
      setDevCode(res.dev_code ?? null);
      setCode('');
      setWait(30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError({ text: err instanceof ApiError && err.kind === 'quota' ? t('otpTooSoon') : errorMessage(t, err) });
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sentTo || !/^\d{4,8}$/.test(code.trim())) {
      setError({ text: t('otpCodeInvalid') });
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      const { customer } = await verifyOtp(sentTo, code.trim(), name.trim());
      done(customer);
    } catch (err) {
      setError({
        text: err instanceof ApiError && err.status === 401 ? t('otpWrong')
          : err instanceof ApiError && err.status === 429 ? t('otpTooManyTries') : errorMessage(t, err),
      });
    } finally {
      setBusy(null);
    }
  };

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (invalid()) {
      setError({ text: invalidText() });
      return;
    }
    if (!password) {
      setError({ text: t('passwordRequired') });
      return;
    }
    setBusy('login');
    setError(null);
    try {
      const { customer } = await passwordLogin(value.trim(), password);
      done(customer);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError({ text: t('loginLocked'), locked: true });
      else if (err instanceof ApiError && err.status === 401) setError({ text: t('loginWrong') });
      else setError({ text: errorMessage(t, err) });
    } finally {
      setBusy(null);
    }
  };

  const useCode = () => {
    setMethod('code');
    setError(null);
    setPassword('');
  };

  const idField = channel === 'phone' ? (
    <TextField label={t('mobileNumber')} value={phone} onValue={setPhone} type="tel" autoComplete="tel" maxLength={24}
      hint={t('otpPhoneHint')} testId={`${testId}-phone`} />
  ) : (
    <TextField label={t('email')} value={email} onValue={setEmail} type="email" autoComplete="email" maxLength={120}
      testId={`${testId}-email`} />
  );

  const errorBox = error ? (
    <Banner tone="fail" testId={`${testId}-error`} action={error.locked ? t('signInWithCode') : undefined} onAction={error.locked ? useCode : undefined}>
      {error.text}
    </Banner>
  ) : null;

  if (sentTo) {
    const to = 'phone' in sentTo ? sentTo.phone : sentTo.email;
    return (
      <form onSubmit={verify} noValidate data-testid={testId}>
        <p className="small">{t('otpSentToAny', { to })}</p>
        {devCode ? (
          <Banner tone="info" testId={`${testId}-dev`}>
            {t('otpDevHint')} <strong className="tnum" data-testid={`${testId}-dev-code`}>{devCode}</strong>{' '}
            <Button size="sm" kind="secondary" onClick={() => setCode(devCode)}>{t('otpUseCode')}</Button>
          </Banner>
        ) : null}
        <div style={{ height: 8 }} />
        <TextField ref={codeRef} label={t('otpCode')} value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
          inputMode="numeric" autoComplete="one-time-code" maxLength={8} testId={`${testId}-code`} />
        {errorBox}
        <div className="row" style={{ marginTop: 10 }}>
          <Button type="submit" busy={busy === 'verify'} testId={`${testId}-verify`}>{t('otpVerify')}</Button>
          <Button kind="ghost" disabled={wait > 0 || busy !== null} onClick={() => void send()}>
            {wait > 0 ? t('otpResendIn', { n: wait }) : t('otpResend')}
          </Button>
          <Button kind="ghost" onClick={() => { setSentTo(null); setError(null); }}>
            {'phone' in sentTo ? t('otpChangePhone') : t('otpChangeEmail')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div data-testid={testId}>
      <Tabs value={channel} onChange={(c) => { setChannel(c); setError(null); }} label={t('signInWith')} testId={`${testId}-channel`}
        options={[{ value: 'phone', label: t('signInMobile') }, { value: 'email', label: t('signInEmail') }]} />
      <div style={{ height: 12 }} />
      {method === 'code' ? (
        <form onSubmit={send} noValidate>
          {askName ? <TextField label={t('nameForNewAccount')} value={name} onValue={setName} autoComplete="name" maxLength={80}
            optional={t('optional')} testId={`${testId}-name`} /> : null}
          {idField}
          {errorBox}
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <Button type="submit" busy={busy === 'send'} testId={`${testId}-send`}>{t('otpSend')}</Button>
            <Button kind="ghost" size="sm" onClick={() => { setMethod('password'); setError(null); }} testId={`${testId}-use-password`}>
              {t('usePassword')}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={login} noValidate>
          {idField}
          <TextField label={t('password')} value={password} onValue={setPassword} type="password" autoComplete="current-password"
            maxLength={200} testId={`${testId}-password`} />
          {errorBox}
          <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <Button type="submit" busy={busy === 'login'} testId={`${testId}-login`}>{t('signInTitle')}</Button>
            <Button kind="ghost" size="sm" onClick={useCode} testId={`${testId}-forgot`}>{t('forgotPassword')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Older name, kept for the places that sign in on the spot (studio save, team link, account). */
export const OtpSignIn = SignInForm;
