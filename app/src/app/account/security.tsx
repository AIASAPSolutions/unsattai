import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, type Identifier } from '../../api/endpoints';
import type { SessionInfo } from '../../api/types';
import { displayIdentifier, isCode, passwordProblems, toIdentifier, type IdKind } from '../../features/account/identifier';
import { errorMessage, useT } from '../../i18n';
import { normalizeDigits } from '../../lib/digits';
import { canResetPassword, useAuth } from '../../state/auth';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { Screen } from '../../ui/Screen';
import { Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

type Note = { tone: 'pass' | 'fail' | 'info'; text: string } | null;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function SecurityScreen() {
  const t = useT();
  const { reset } = useLocalSearchParams<{ reset?: string }>();
  const me = useAuth((s) => s.customer);
  const codeSignInAt = useAuth((s) => s.codeSignInAt);
  const refresh = useAuth((s) => s.refresh);

  useEffect(() => {
    if (!me) router.replace('/sign-in');
  }, [me]);
  if (!me) return <Screen><Loading label={t('loading')} /></Screen>;

  const noCurrent = !me.has_password || canResetPassword(codeSignInAt);
  return (
    <Screen testID="screen-security">
      {reset === '1' ? <Banner tone="info" text={t('resetPasswordNow')} testID="reset-note" /> : null}
      <PasswordCard hasPassword={me.has_password} needCurrent={!noCurrent} onDone={() => refresh().catch(() => undefined)} />
      <IdentifierCard kind="phone" value={me.phone} verified={me.phone_verified} />
      <IdentifierCard kind="email" value={me.email} verified={me.email_verified} />
      <SessionsCard />
    </Screen>
  );
}

function PasswordCard({ hasPassword, needCurrent, onDone }: { hasPassword: boolean; needCurrent: boolean; onDone: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [touched, setTouched] = useState(false);
  const rules = passwordProblems(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async () => {
    setTouched(true);
    setNote(null);
    if (rules.length || next !== confirm || (needCurrent && !current)) return;
    setBusy(true);
    try {
      const res = await api.setPassword(next, needCurrent ? current : undefined);
      setNote({ tone: 'pass', text: res.other_sessions_signed_out ? t('passwordSavedOthers', { n: res.other_sessions_signed_out }) : t('passwordSaved') });
      setCurrent('');
      setNext('');
      setConfirm('');
      setTouched(false);
      onDone();
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  const ruleText: Record<string, string> = { length: t('pwRuleLength'), upper: t('pwRuleUpper'), lower: t('pwRuleLower'), digit: t('pwRuleDigit') };
  return (
    <Card title={hasPassword ? t('changePassword') : t('setPassword')} testID="password-card">
      <T variant="caption" style={{ marginBottom: space(3) }}>{hasPassword ? t('changePasswordHint') : t('setPasswordHint')}</T>
      {needCurrent ? (
        <Field testID="pw-current" label={t('currentPassword')} value={current} onChangeText={setCurrent} secureTextEntry={!show}
          autoCapitalize="none" autoComplete="current-password" error={touched && !current ? t('required') : null} />
      ) : null}
      <Field testID="pw-new" label={t('newPassword')} value={next} onChangeText={setNext} secureTextEntry={!show} autoCapitalize="none"
        autoComplete="new-password" textContentType="newPassword" />
      <View style={{ marginTop: -space(2), marginBottom: space(3) }} accessible accessibilityLabel={t('pwRules')}>
        {(['length', 'upper', 'lower', 'digit'] as const).map((r) => (
          <T key={r} variant="caption" color={rules.includes(r) ? (touched ? colors.fail : colors.muted) : colors.pass}>
            {rules.includes(r) ? '○' : '✓'} {ruleText[r]}
          </T>
        ))}
      </View>
      <Field testID="pw-confirm" label={t('confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry={!show}
        autoCapitalize="none" autoComplete="new-password" error={mismatch ? t('passwordsDiffer') : null} />
      <View style={styles.row}>
        <Button compact kind="ghost" label={show ? t('hide') : t('show')} onPress={() => setShow(!show)} />
        <Button testID="save-password" compact label={t('savePassword')} onPress={submit} busy={busy} disabled={busy} />
      </View>
      {note ? <Banner tone={note.tone} text={note.text} testID="password-result" /> : null}
    </Card>
  );
}

function IdentifierCard({ kind, value, verified }: { kind: IdKind; value: string; verified: boolean }) {
  const t = useT();
  const setCustomer = useAuth((s) => s.setCustomer);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState<{ who: Identifier; dev?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const who = toIdentifier(kind, text);
  const label = kind === 'phone' ? t('mobileNumber') : t('email');
  const shown = value ? (kind === 'phone' ? displayIdentifier({ phone: value.startsWith('+') ? value : `+91${value}` }) : value) : t('notAdded');

  const send = async () => {
    if (!who) {
      setNote({ tone: 'fail', text: kind === 'phone' ? t('mobileInvalid') : t('emailInvalid') });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const res = await api.requestIdentifierCode(who);
      setSent({ who, dev: res.dev_code });
      setCode('');
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!sent || !isCode(code)) return;
    setBusy(true);
    setNote(null);
    try {
      setCustomer(await api.verifyIdentifier(sent.who, normalizeDigits(code).trim()));
      setNote({ tone: 'pass', text: t('identifierVerified', { what: label }) });
      setEditing(false);
      setSent(null);
      setText('');
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={label} testID={`${kind}-card`} right={!editing ? (
      <Button compact kind="ghost" testID={`${kind}-change`} label={value ? t('change') : t('add')} onPress={() => { setEditing(true); setNote(null); }} />
    ) : undefined}>
      <T variant="body" testID={`${kind}-value`}>{shown}</T>
      {value ? (
        <T variant="caption" color={verified ? colors.pass : colors.warn}>{verified ? `✓ ${t('verified')}` : t('notVerified')}</T>
      ) : null}
      {editing ? (
        <View style={{ marginTop: space(3) }}>
          {!sent ? (
            <>
              <Field testID={`${kind}-new`} label={kind === 'phone' ? t('newMobile') : t('newEmail')} value={text} onChangeText={setText}
                keyboardType={kind === 'phone' ? 'phone-pad' : 'email-address'} autoCapitalize="none" autoCorrect={false} />
              <View style={styles.row}>
                <Button compact kind="ghost" label={t('cancel')} onPress={() => { setEditing(false); setNote(null); }} />
                <Button testID={`${kind}-send`} compact label={t('sendCode')} onPress={send} busy={busy} disabled={busy} />
              </View>
            </>
          ) : (
            <>
              <T variant="body">{t('codeSent', { to: displayIdentifier(sent.who) })}</T>
              {sent.dev ? <T variant="caption" color={colors.info} testID={`${kind}-dev-code`}>{t('testCode', { code: sent.dev })}</T> : null}
              <Field testID={`${kind}-code`} label={t('oneTimeCode')} value={code} onChangeText={(v) => setCode(normalizeDigits(v).replace(/\D/g, ''))}
                keyboardType="number-pad" maxLength={8} autoComplete="one-time-code" />
              <View style={styles.row}>
                <Button compact kind="ghost" label={t('back')} onPress={() => setSent(null)} />
                <Button testID={`${kind}-verify`} compact label={t('verify')} onPress={verify} busy={busy} disabled={busy || !isCode(code)} />
              </View>
            </>
          )}
        </View>
      ) : null}
      {note ? <Banner tone={note.tone} text={note.text} testID={`${kind}-result`} /> : null}
    </Card>
  );
}

function SessionsCard() {
  const t = useT();
  const [items, setItems] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.sessions()).items);
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const end = async (id: string | 'others') => {
    setBusy(id);
    setNote(null);
    try {
      if (id === 'others') {
        const res = await api.endOtherSessions();
        setNote({ tone: 'pass', text: t('signedOutOthers', { n: res.signed_out }) });
      } else {
        await api.endSession(id);
        setNote({ tone: 'pass', text: t('signedOutDevice') });
      }
      await load();
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const others = (items ?? []).filter((s) => !s.current);
  return (
    <Card title={t('devicesTitle')} testID="sessions-card">
      {!items ? <Loading label={t('loading')} /> : items.map((s) => (
        <View key={s.id} style={styles.session} testID={s.current ? 'session-current' : `session-${s.id}`}>
          <View style={{ flex: 1 }}>
            <T variant="label">{s.device_label}{s.current ? ` · ${t('thisDevice')}` : ''}</T>
            <T variant="caption">{t('lastActive', { time: formatTime(s.last_seen_at) })}</T>
          </View>
          {!s.current ? (
            <Button compact kind="ghost" label={t('signOut')} onPress={() => end(s.id)} busy={busy === s.id} disabled={!!busy} />
          ) : null}
        </View>
      ))}
      {others.length ? (
        <Button testID="sign-out-others" kind="secondary" label={t('signOutOthers')} onPress={() => end('others')} busy={busy === 'others'}
          disabled={!!busy} style={{ marginTop: space(3) }} />
      ) : null}
      {note ? <Banner tone={note.tone} text={note.text} testID="sessions-result" /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: space(2) },
  session: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line, minHeight: 56,
  },
});
