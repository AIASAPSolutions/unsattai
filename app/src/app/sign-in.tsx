import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../api/client';
import { api, type Identifier } from '../api/endpoints';
import type { CodeSent } from '../api/types';
import { displayIdentifier, guessKind, isCode, toIdentifier, type IdKind } from '../features/account/identifier';
import { errorMessage, useT } from '../i18n';
import { normalizeDigits } from '../lib/digits';
import { useAuth } from '../state/auth';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Segmented } from '../ui/Segmented';
import { T } from '../ui/Text';
import { colors, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

type Method = 'code' | 'password';

/** Sign in with a mobile number or an email, by one-time code or password. */
export default function SignInScreen() {
  const t = useT();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const completeSignIn = useAuth((s) => s.completeSignIn);
  const { speak } = useVoiceGuide();
  const [kind, setKind] = useState<IdKind>('phone');
  const [method, setMethod] = useState<Method>('code');
  const [value, setValue] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [sent, setSent] = useState<{ who: Identifier; res: CodeSent } | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; locked?: boolean } | null>(null);
  const [touched, setTouched] = useState(false);
  const [wait, setWait] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);
  useEffect(() => {
    speak(t('signInTitle'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWait = () => {
    setWait(30);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setWait((w) => {
      if (w <= 1 && timer.current) clearInterval(timer.current);
      return Math.max(0, w - 1);
    }), 1000);
  };

  const who = method === 'password' ? toIdentifier(guessKind(value), value) : toIdentifier(kind, value);
  const idError = touched && !who ? t(method === 'password' ? 'enterPhoneOrEmail' : kind === 'email' ? 'emailInvalid' : 'mobileInvalid') : null;

  const done = async (res: Parameters<typeof completeSignIn>[0], via: 'code' | 'password') => {
    await completeSignIn(res, via);
    speak(t('signedInAs', { name: res.customer.name || displayIdentifier(who ?? { email: res.customer.email }) }));
    if (forgot) {
      router.replace({ pathname: '/account/security', params: { reset: '1' } });
      return;
    }
    if (next === 'checkout' || router.canGoBack()) router.back();
    else router.replace('/account');
  };

  const fail = (e: unknown) => {
    const locked = e instanceof ApiError && (e.kind === 'locked' || (e.kind === 'quota' && /password/i.test(e.message)));
    const text = errorMessage(t, e);
    setError({ text, locked });
    speak(text);
  };

  const sendCode = async () => {
    setTouched(true);
    setError(null);
    if (!who) return;
    setBusy('send');
    try {
      const res = await api.requestCode(who);
      setSent({ who, res });
      setCode('');
      startWait();
      speak(t('codeSent', { to: displayIdentifier(who) }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!sent || !isCode(code)) return;
    setBusy('verify');
    setError(null);
    try {
      await done(await api.verifyCode(sent.who, normalizeDigits(code).trim(), name.trim()), 'code');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const loginPw = async () => {
    setTouched(true);
    setError(null);
    if (!who || !password) return;
    setBusy('login');
    try {
      await done(await api.login(value.trim(), password), 'password');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const useCodeInstead = () => {
    setForgot(true);
    setMethod('code');
    setKind(guessKind(value));
    setError(null);
    setSent(null);
  };

  return (
    <Screen testID="screen-sign-in">
      <T variant="title" accessibilityRole="header">{t('signInTitle')}</T>
      <T variant="caption" style={{ marginBottom: space(4) }}>{t('signInHint')}</T>

      <Segmented testID="signin-method" value={method} onChange={(m) => { setMethod(m); setSent(null); setError(null); setForgot(false); }}
        options={[{ value: 'code', label: t('withCode') }, { value: 'password', label: t('withPassword') }]} />

      {method === 'code' ? (
        <Card style={{ marginTop: space(4) }}>
          {forgot ? <Banner tone="info" text={t('forgotFlowNote')} testID="forgot-note" /> : null}
          {!sent ? (
            <>
              <Segmented testID="signin-kind" value={kind} onChange={(k) => { setKind(k); setValue(''); setTouched(false); }}
                options={[{ value: 'phone', label: t('mobile') }, { value: 'email', label: t('email') }]} />
              <View style={{ height: space(3) }} />
              <Field testID="signin-id" label={kind === 'email' ? t('email') : t('mobileNumber')} value={value} onChangeText={setValue}
                keyboardType={kind === 'email' ? 'email-address' : 'phone-pad'} autoCapitalize="none" autoCorrect={false}
                autoComplete={kind === 'email' ? 'email' : 'tel'} placeholder={kind === 'email' ? 'name@example.com' : '98765 43210'}
                error={idError} onSubmitEditing={sendCode} returnKeyType="send" />
              <Button testID="send-code" label={t('sendCode')} onPress={sendCode} busy={busy === 'send'} disabled={!!busy} />
            </>
          ) : (
            <>
              <T variant="body" testID="code-sent">{t('codeSent', { to: displayIdentifier(sent.who) })}</T>
              {sent.res.dev_code ? (
                <T variant="caption" color={colors.info} testID="dev-code">{t('testCode', { code: sent.res.dev_code })}</T>
              ) : null}
              <View style={{ height: space(3) }} />
              <Field testID="signin-code" label={t('oneTimeCode')} value={code} onChangeText={(v) => setCode(normalizeDigits(v).replace(/\D/g, ''))}
                keyboardType="number-pad" maxLength={8} autoComplete="one-time-code" textContentType="oneTimeCode"
                onSubmitEditing={verify} returnKeyType="done" />
              <Field testID="signin-name" label={`${t('yourName')} (${t('newAccountsOnly')})`} value={name} onChangeText={setName}
                maxLength={80} autoComplete="name" />
              <Button testID="verify-code" label={t('verifyAndSignIn')} onPress={verify} busy={busy === 'verify'} disabled={!!busy || !isCode(code)} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: space(2) }}>
                <Button compact kind="ghost" testID="resend-code" label={wait ? t('resendIn', { s: wait }) : t('resendCode')} onPress={sendCode}
                  disabled={wait > 0 || !!busy} />
                <Button compact kind="ghost" label={t('changeNumber')} onPress={() => { setSent(null); setError(null); }} />
              </View>
            </>
          )}
        </Card>
      ) : (
        <Card style={{ marginTop: space(4) }}>
          <Field testID="signin-id" label={t('phoneOrEmail')} value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" autoComplete="username" error={idError} />
          <Field testID="signin-password" label={t('password')} value={password} onChangeText={setPassword} secureTextEntry={!showPw}
            autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" onSubmitEditing={loginPw} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space(2) }}>
            <Button compact kind="ghost" label={showPw ? t('hide') : t('show')} onPress={() => setShowPw(!showPw)} />
          </View>
          <Button testID="password-sign-in" label={t('signIn')} onPress={loginPw} busy={busy === 'login'} disabled={!!busy || !password} />
          <Button testID="forgot-password" compact kind="ghost" label={t('forgotPassword')} onPress={useCodeInstead} style={{ marginTop: space(2) }} />
        </Card>
      )}

      {error ? (
        <Banner tone="fail" text={error.text} testID="signin-error"
          action={error.locked || method === 'password' ? t('signInWithCode') : undefined} onAction={useCodeInstead} />
      ) : null}
      <T variant="caption" style={{ marginTop: space(2) }}>{t('signInPrivacy')}</T>
    </Screen>
  );
}
