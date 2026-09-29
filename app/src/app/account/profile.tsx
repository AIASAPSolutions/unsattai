import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch } from 'react-native';
import { api } from '../../api/endpoints';
import { errorMessage, useT } from '../../i18n';
import { checkEmail } from '../../lib/validation';
import { useAuth } from '../../state/auth';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Field } from '../../ui/Field';
import { Screen } from '../../ui/Screen';
import { Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';

export default function ProfileScreen() {
  const t = useT();
  const me = useAuth((s) => s.customer);
  const setCustomer = useAuth((s) => s.setCustomer);
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [optIn, setOptIn] = useState(me?.marketing_opt_in ?? false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);

  useEffect(() => {
    if (!me) router.replace('/sign-in');
  }, [me]);
  if (!me) return <Screen><Loading label={t('loading')} /></Screen>;

  const emailBad = !!checkEmail(email);
  const save = async () => {
    if (emailBad || !name.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const next = await api.updateMe({ name: name.trim(), email: email.trim(), marketing_opt_in: optIn });
      setCustomer(next);
      setResult({ tone: 'pass', text: t('saved') });
    } catch (e) {
      setResult({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-profile" footer={<Button testID="save-profile" label={t('save')} onPress={save} busy={busy} disabled={busy || emailBad || !name.trim()} />}>
      <Card title={t('profileTitle')}>
        <Field testID="profile-name" label={t('yourName')} value={name} onChangeText={setName} maxLength={80} autoComplete="name"
          error={!name.trim() ? t('required') : null} />
        <Field testID="profile-email" label={`${t('contactEmail')} (${t('optional')})`} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={emailBad ? t('invalid') : null}
          hint={me.email_verified && email.trim().toLowerCase() === me.email.toLowerCase() ? `✓ ${t('verified')}` : t('contactEmailHint')} />
        <Pressable style={styles.switchRow} onPress={() => setOptIn(!optIn)} accessibilityRole="switch" accessibilityState={{ checked: optIn }}>
          <T variant="body" style={{ flex: 1 }}>{t('marketingOptIn')}</T>
          <Switch value={optIn} onValueChange={setOptIn} />
        </Pressable>
        <T variant="caption" color={colors.muted}>{t('signInDetailsInSecurity')}</T>
        <Button compact kind="ghost" label={t('securityTitle')} onPress={() => router.push('/account/security')} style={{ alignSelf: 'flex-start' }} />
      </Card>
      {result ? <Banner tone={result.tone} text={result.text} testID="profile-result" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginVertical: space(2) },
});
