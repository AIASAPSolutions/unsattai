import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { configuredUrl, getApiKey, getApiUrl, isValidUrl, normalizeUrl, setApiKey, setApiUrl } from '../api/config';
import { api } from '../api/endpoints';
import type { Language } from '../api/types';
import { errorMessage, LANGUAGE_OPTIONS, useT } from '../i18n';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { T } from '../ui/Text';
import { space } from '../ui/theme';

export default function SettingsScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const setLanguage = usePrefs((s) => s.setLanguage);
  const voiceGuide = usePrefs((s) => s.voiceGuide);
  const setVoiceGuide = usePrefs((s) => s.setVoiceGuide);
  const remember = usePrefs((s) => s.rememberCustomer);
  const setRemember = usePrefs((s) => s.setRememberCustomer);

  const [url, setUrl] = useState(getApiUrl());
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'pass' | 'fail' | 'info'; text: string } | null>(null);

  useEffect(() => {
    getApiKey().then((k) => setHasKey(!!k)).catch(() => setHasKey(false));
  }, []);

  const urlOk = isValidUrl(url);

  const test = async () => {
    setBusy(true);
    setResult(null);
    try {
      await setApiUrl(normalizeUrl(url) === configuredUrl() ? null : url);
      if (key.trim()) {
        await setApiKey(key);
        setKey('');
        setHasKey(true);
      }
      const h = await api.health();
      // /meta needs the key when the server requires one, so this also checks the key.
      await api.meta();
      setUrl(getApiUrl());
      setResult({ tone: 'pass', text: t('connected', { app: 'Unsattai API', version: h.version }) });
    } catch (e) {
      setResult({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="screen-settings">
      <Card title={t('language')}>
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {LANGUAGE_OPTIONS.map((o) => (
            <Chip key={o.code} testID={`settings-lang-${o.code}`} label={o.label} selected={lang === o.code}
              onPress={() => setLanguage(o.code as Language)} />
          ))}
        </View>
        <Pressable style={styles.switchRow} onPress={() => setVoiceGuide(!voiceGuide)} accessibilityRole="switch" accessibilityState={{ checked: voiceGuide }}>
          <T variant="body" style={{ flex: 1 }}>{t('voiceGuide')}</T>
          <Switch value={voiceGuide} onValueChange={setVoiceGuide} />
        </Pressable>
        <Pressable style={styles.switchRow} onPress={() => setRemember(!remember)} accessibilityRole="switch" accessibilityState={{ checked: remember }}>
          <T variant="body" style={{ flex: 1 }}>{t('rememberMe')}</T>
          <Switch value={remember} onValueChange={(on) => setRemember(on)} />
        </Pressable>
      </Card>

      <Card title={t('apiUrl')}>
        <Field testID="api-url" label={t('apiUrl')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false}
          keyboardType="url" placeholder="http://192.168.1.20:8000" error={urlOk ? null : t('invalid')} hint={t('apiUrlHelp')} />
        <Field testID="api-key" label={t('apiKey')} value={key} onChangeText={setKey} autoCapitalize="none" autoCorrect={false}
          secureTextEntry={!showKey} placeholder={hasKey ? '••••••••' : ''} hint={t('apiKeyHelp')} />
        <View style={styles.wrap}>
          <Button compact kind="ghost" label={showKey ? t('hide') : t('show')} onPress={() => setShowKey(!showKey)} />
          {hasKey ? (
            <Button compact kind="ghost" label={t('removeKey')} onPress={async () => {
              await setApiKey(null);
              setHasKey(false);
              setResult({ tone: 'info', text: t('keyRemoved') });
            }} />
          ) : null}
          <Button compact kind="ghost" label={t('resetUrl')} onPress={async () => {
            await setApiUrl(null);
            setUrl(getApiUrl());
          }} />
        </View>
        <Button testID="test-connection" label={t('testConnection')} onPress={test} busy={busy} disabled={!urlOk || busy} style={{ marginTop: space(2) }} />
        {result ? <Banner tone={result.tone} text={result.text} testID="connection-result" /> : null}
      </Card>

      <Card title={t('about')}>
        <T variant="body">Unsattai {Constants.expoConfig?.version ?? ''}</T>
        <T variant="caption" style={{ marginTop: space(2) }}>{t('staffOnly')}</T>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
});
