'use client';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/components/providers/session';
import { Banner, Button, TextField } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api, verifyOtp } from '@/lib/api/endpoints';
import type { Me } from '@/lib/api/types';
import { checkPhone } from '@/lib/validation';

/**
 * Phone sign-in with a one-time code. The code is verified by our own route handler,
 * which keeps the session token in an httpOnly cookie. When the server runs in
 * development mode it returns the code (dev_code) and we show it as a hint.
 */
export function OtpSignIn({ onSignedIn, initialPhone = '', initialName = '', askName = true, testId = 'otp' }: {
  onSignedIn?: (me: Me) => void; initialPhone?: string; initialName?: string; askName?: boolean; testId?: string;
}) {
  const t = useT();
  const { setMe } = useSession();
  const [phone, setPhone] = useState(initialPhone);
  const [name, setName] = useState(initialName);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (checkPhone(phone)) {
      setError(t('otpPhoneInvalid'));
      return;
    }
    setBusy('send');
    setError(null);
    try {
      const res = await api.requestOtp(phone.trim());
      setSentTo(res.phone);
      setDevCode(res.dev_code ?? null);
      setCode('');
      setWait(30);
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sentTo || !/^\d{4,8}$/.test(code.trim())) {
      setError(t('otpCodeInvalid'));
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      const { customer } = await verifyOtp(sentTo, code.trim(), name.trim());
      setMe(customer);
      onSignedIn?.(customer);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  };

  if (!sentTo) {
    return (
      <form onSubmit={send} noValidate data-testid={testId}>
        {askName ? <TextField label={t('customerName')} value={name} onValue={setName} autoComplete="name" maxLength={80}
          optional={t('optional')} testId={`${testId}-name`} /> : null}
        <TextField label={t('phone')} value={phone} onValue={setPhone} type="tel" autoComplete="tel" maxLength={24}
          hint={t('otpPhoneHint')} testId={`${testId}-phone`} />
        {error ? <Banner tone="fail">{error}</Banner> : null}
        <div style={{ marginTop: 10 }}>
          <Button type="submit" busy={busy === 'send'} testId={`${testId}-send`}>{t('otpSend')}</Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate data-testid={testId}>
      <p className="small">{t('otpSentTo', { phone: sentTo })}</p>
      {devCode ? (
        <Banner tone="info" testId={`${testId}-dev`}>
          {t('otpDevHint')} <strong className="tnum" data-testid={`${testId}-dev-code`}>{devCode}</strong>{' '}
          <Button size="sm" kind="secondary" onClick={() => setCode(devCode)}>{t('otpUseCode')}</Button>
        </Banner>
      ) : null}
      <div style={{ height: 8 }} />
      <TextField ref={codeRef} label={t('otpCode')} value={code} onValue={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
        inputMode="numeric" autoComplete="one-time-code" maxLength={8} testId={`${testId}-code`} />
      {error ? <Banner tone="fail">{error}</Banner> : null}
      <div className="row" style={{ marginTop: 10 }}>
        <Button type="submit" busy={busy === 'verify'} testId={`${testId}-verify`}>{t('otpVerify')}</Button>
        <Button kind="ghost" disabled={wait > 0 || busy !== null} onClick={() => void send()}>
          {wait > 0 ? t('otpResendIn', { n: wait }) : t('otpResend')}
        </Button>
        <Button kind="ghost" onClick={() => { setSentTo(null); setError(null); }}>{t('otpChangePhone')}</Button>
      </div>
    </form>
  );
}
