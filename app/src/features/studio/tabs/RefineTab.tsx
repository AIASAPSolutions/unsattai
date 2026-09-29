import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../../../api/client';
import { api } from '../../../api/endpoints';
import type { AiAllowance, RefineChange } from '../../../api/types';
import { VoiceInput } from '../../../components/VoiceInput';
import { errorMessage, useT } from '../../../i18n';
import { fitLayersToZone } from '../../../lib/spec';
import { usePrefs } from '../../../state/prefs';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { Field } from '../../../ui/Field';
import { T } from '../../../ui/Text';
import { colors, space } from '../../../ui/theme';
import { useVoiceGuide } from '../../../voice/useVoiceGuide';
import { latestSpec, type StudioTools } from './types';

const LIMIT = 300;

export function RefineTab({ edit }: StudioTools) {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const { speak } = useVoiceGuide();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'pass' | 'info' | 'fail'; text: string; changes: RefineChange[] } | null>(null);
  const [base, setBase] = useState('');
  const [ai, setAi] = useState<AiAllowance | null>(null);

  // How many AI edits are left today. Older servers without AI edits just show nothing.
  useEffect(() => {
    let live = true;
    api.aiAllowance().then((a) => live && setAi(a)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const apply = async () => {
    const spec = latestSpec();
    const instruction = text.trim();
    if (!spec || !instruction) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.refine(spec, instruction, lang);
      if (res.ai) setAi(res.ai);
      if (res.changes.length) {
        // "remove the sleeves" / "polo collar" can shrink the safe print area: keep the layers inside it.
        const optionsChanged = res.spec.sleeves !== spec.sleeves || res.spec.collar !== spec.collar;
        edit(optionsChanged ? fitLayersToZone(res.spec) : res.spec);
        const summary = res.source === 'ai' && res.message ? res.message : res.changes.map((c) => c.message).join('; ');
        const msg = `${res.source === 'ai' ? `✨ ${t('refineByAi')} · ` : ''}${t('refineDone', { summary })}`;
        setResult({ tone: 'pass', text: msg, changes: res.changes });
        speak(msg);
        setText('');
      } else {
        const msg = `${t('refineNothing')} ${res.message}`.trim();
        setResult({ tone: 'info', text: msg, changes: [] });
        speak(msg);
      }
    } catch (e) {
      const allowance = e instanceof ApiError && e.kind === 'quota' ? (e.data as { ai?: AiAllowance } | null)?.ai : null;
      if (allowance) setAi(allowance);
      const msg = errorMessage(t, e);
      setResult({ tone: e instanceof ApiError && e.kind === 'quota' ? 'info' : 'fail', text: msg, changes: [] });
      speak(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Card title={t('refineTitle')}>
        <Field testID="refine-input" label={t('refineTitle')} value={text} multiline maxLength={LIMIT}
          placeholder={t('refinePlaceholder')} counter={t('charsLeft', { n: LIMIT - text.length })}
          onFocus={() => setBase(text)} onChangeText={setText} />
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <VoiceInput testID="refine-voice" onText={(heard) => {
            setText(`${base ? `${base} ` : ''}${heard}`.slice(0, LIMIT));
          }} />
          <Button testID="refine-apply" compact label={t('refineCta')} onPress={apply} busy={busy} disabled={!text.trim() || busy} />
        </View>
        <T variant="caption" style={{ marginTop: space(3) }}>{t('refineExamples')}</T>
        {ai?.enabled ? (
          <>
            <T variant="caption" style={{ marginTop: space(2) }}>{t('aiHint')}</T>
            <T variant="label" style={{ marginTop: space(1) }} testID="ai-left">
              ✨ {t('aiLeft', { n: ai.remaining, limit: ai.limit })}
            </T>
          </>
        ) : null}
      </Card>
      {result ? (
        <Banner tone={result.tone} text={result.text} testID="refine-result">
          {result.changes.length > 1 ? result.changes.map((c, i) => (
            <T key={i} variant="caption" color={colors.ink}>• {c.message}</T>
          )) : null}
        </Banner>
      ) : null}
    </View>
  );
}
