import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ColorPickerModal } from '../../components/ColorPickerModal';
import { DeliverToBar } from '../../components/shop/DeliverTo';
import { VoiceInput } from '../../components/VoiceInput';
import { GARMENTS, MAX_LOCKED_COLORS, PROMPT_LIMIT, TEXT_LIMITS, type Language } from '../../api/types';
import { errorMessage, LANGUAGE_OPTIONS, useT } from '../../i18n';
import { checkNumber, checkPlayer, checkPrompt, checkTeam, cleanNumber } from '../../lib/validation';
import { useFlow } from '../../state/flow';
import { usePrefs } from '../../state/prefs';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Swatch } from '../../ui/ColorPicker';
import { Field } from '../../ui/Field';
import { Screen } from '../../ui/Screen';
import { T } from '../../ui/Text';
import { colors, space } from '../../ui/theme';
import { useVoiceGuide } from '../../voice/useVoiceGuide';

export default function DescribeScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const setLanguage = usePrefs((s) => s.setLanguage);
  const brief = useFlow((s) => s.brief);
  const setBrief = useFlow((s) => s.setBrief);
  const understand = useFlow((s) => s.understand);
  const hasDraft = useFlow((s) => !!s.history || s.designs.length > 0);
  const reset = useFlow((s) => s.reset);
  const { speak, notice } = useVoiceGuide();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [picker, setPicker] = useState(false);
  const dictationBase = useRef<string | null>(null);

  useEffect(() => {
    speak(t('describeTitle') + '. ' + t('describeHint'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const promptIssue = checkPrompt(brief.prompt);
  const teamIssue = checkTeam(brief.team_name);
  const playerIssue = checkPlayer(brief.player_name);
  const numberIssue = checkNumber(brief.number);
  const valid = !promptIssue && !teamIssue && !playerIssue && !numberIssue;

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await understand(lang);
      router.push('/confirm');
    } catch (e) {
      const msg = errorMessage(t, e);
      setError(msg);
      speak(msg);
    } finally {
      setBusy(false);
    }
  };

  const onDictation = (text: string, final: boolean) => {
    // Interim results replace the in-progress phrase; a final result is kept.
    if (dictationBase.current === null) dictationBase.current = brief.prompt;
    const base = dictationBase.current;
    const joined = (base ? `${base.trimEnd()} ` : '') + text;
    setBrief({ prompt: joined.slice(0, PROMPT_LIMIT) });
    if (final) dictationBase.current = null;
  };

  const examples = [t('example1'), t('example2'), t('example3'), t('example4')];

  return (
    <Screen
      testID="screen-describe"
      footer={<Button testID="understand" label={t('understandCta')} onPress={submit} busy={busy} disabled={touched && !valid} />}
    >
      <View style={styles.langRow} accessibilityRole="radiogroup" accessibilityLabel={t('language')}>
        {LANGUAGE_OPTIONS.map((o) => (
          <Chip key={o.code} testID={`lang-${o.code}`} label={o.label} selected={lang === o.code}
            onPress={() => setLanguage(o.code as Language)} />
        ))}
      </View>
      <DeliverToBar garment={brief.garment} />
      {notice ? <Banner tone="info" text={notice} /> : null}
      {hasDraft ? (
        <Banner tone="info" text={t('restoreDraft')}>
          <View style={styles.row}>
            <Button compact kind="secondary" label={t('resume')} onPress={() => router.push(useFlow.getState().history ? '/studio' : '/designs')} />
            <Button compact kind="ghost" label={t('startOver')} onPress={reset} />
          </View>
        </Banner>
      ) : null}

      <T variant="title" accessibilityRole="header">{t('describeTitle')}</T>
      <T variant="caption" style={{ marginBottom: space(4) }}>{t('describeHint')}</T>

      <Field
        testID="brief"
        label={t('briefLabel')}
        placeholder={t('briefPlaceholder')}
        value={brief.prompt}
        onChangeText={(prompt) => setBrief({ prompt })}
        multiline
        maxLength={PROMPT_LIMIT}
        counter={t('charsLeft', { n: PROMPT_LIMIT - brief.prompt.length })}
        error={touched && promptIssue ? (promptIssue === 'tooLong' ? t('promptTooLong') : t('promptTooShort')) : null}
      />
      <VoiceInput testID="dictate" onText={onDictation} />

      <T variant="label" style={{ marginTop: space(5), marginBottom: space(2) }}>{t('examples')}</T>
      <View style={styles.wrap}>
        {examples.map((ex, i) => (
          <Chip key={i} testID={`example-${i}`} label={ex} onPress={() => setBrief({ prompt: ex })} />
        ))}
      </View>

      <Card title={t('shopEntryTitle')} style={{ marginTop: space(4) }}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('shopEntryHint')}</T>
        <Button testID="go-shop" compact kind="secondary" label={t('shopEntryCta')} onPress={() => router.navigate('/shop')} />
      </Card>

      <Card title={t('pictureEntryTitle')}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('pictureEntryHint')}</T>
        <Button testID="use-picture" compact kind="secondary" label={t('pictureEntryCta')} onPress={() => router.push('/from-picture')} />
      </Card>

      <Card title={t('garmentLabel')}>
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {GARMENTS.map((g) => (
            <Chip key={g} testID={`garment-${g}`} label={t(`garment_${g}`)} selected={brief.garment === g} onPress={() => setBrief({ garment: g })} />
          ))}
        </View>
      </Card>

      <Card title={t('lockedColors')}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('lockedColorsHint')}</T>
        <View style={styles.wrap}>
          {brief.locked_colors.map((c) => (
            <View key={c} style={styles.locked}>
              <Swatch hex={c} label={`${c}, ${t('delete')}`}
                onPress={() => setBrief({ locked_colors: brief.locked_colors.filter((x) => x !== c) })} />
              <T variant="caption">{c}</T>
            </View>
          ))}
          {brief.locked_colors.length < MAX_LOCKED_COLORS ? (
            <Button testID="add-color" compact kind="secondary" label={`+ ${t('addColor')}`} onPress={() => setPicker(true)} />
          ) : null}
        </View>
      </Card>

      <Card title={`${t('teamName')} · ${t('playerName')} · ${t('number')} (${t('optional')})`}>
        <Field testID="team" label={t('teamName')} value={brief.team_name} maxLength={TEXT_LIMITS.team_name}
          onChangeText={(team_name) => setBrief({ team_name })} error={teamIssue ? t('tooLong') : null} />
        <Field testID="player" label={t('playerName')} value={brief.player_name} maxLength={TEXT_LIMITS.player_name}
          onChangeText={(player_name) => setBrief({ player_name })} error={playerIssue ? t('tooLong') : null} />
        <Field testID="number" label={t('number')} hint={t('numberHint')} value={brief.number} keyboardType="number-pad"
          maxLength={3} onChangeText={(v) => setBrief({ number: cleanNumber(v) })} error={numberIssue ? t('digitsOnly') : null} />
      </Card>

      {error ? <Banner tone="fail" text={error} action={t('retry')} onAction={submit} testID="describe-error" /> : null}

      <ColorPickerModal
        visible={picker}
        initial="#1f5fbf"
        onClose={() => setPicker(false)}
        onPick={(hex) => {
          if (!brief.locked_colors.includes(hex)) setBrief({ locked_colors: [...brief.locked_colors, hex].slice(0, MAX_LOCKED_COLORS) });
          setPicker(false);
        }}
      />
      <T variant="caption" color={colors.muted} style={{ marginTop: space(2) }}>{t('exactSpelling')}</T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space(2) },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', gap: space(2), marginTop: space(2) },
  locked: { alignItems: 'center', marginRight: space(3), marginBottom: space(2) },
});
