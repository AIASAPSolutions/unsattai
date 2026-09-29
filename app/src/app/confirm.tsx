import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ColorPickerModal } from '../components/ColorPickerModal';
import { GarmentOptionsPicker } from '../components/GarmentOptionsPicker';
import { GARMENTS, MAX_LOCKED_COLORS, PROMPT_LIMIT, SPORTS, TEXT_LIMITS, type Question } from '../api/types';
import { errorMessage, tMaybe, useT, type T as Tr } from '../i18n';
import { hasSleeves } from '../lib/sizing';
import { useCatalogue } from '../state/shopInfo';
import { checkNumber, checkPlayer, checkPrompt, checkTeam, cleanNumber } from '../lib/validation';
import { canGenerate, unansweredQuestions, useFlow } from '../state/flow';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { Swatch } from '../ui/ColorPicker';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Empty } from '../ui/States';
import { T } from '../ui/Text';
import { colors, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

function questionText(t: Tr, q: Question): string {
  const [a, b] = q.options.map((o) => o.value);
  const label = (v: string) => (q.field === 'sport' ? tMaybe(t, `sport_${v}`, v) : q.field === 'garment' ? tMaybe(t, `garment_${v}`, v) : v);
  switch (q.id) {
    case 'team_name_conflict': return t('conflictTeam', { a, b });
    case 'player_name_conflict': return t('conflictPlayer', { a, b });
    case 'number_conflict': return t('conflictNumber', { a, b });
    case 'sport_conflict': return t('conflictSport', { a: label(a), b: label(b) });
    case 'garment_conflict': return t('conflictGarment', { a: label(a), b: label(b) });
    case 'sport_missing': return t('chooseSport');
    default: return q.message;
  }
}

export default function ConfirmScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const understanding = useFlow((s) => s.understanding);
  const confirmed = useFlow((s) => s.confirmed);
  const answers = useFlow((s) => s.answers);
  const answer = useFlow((s) => s.answer);
  const editConfirmed = useFlow((s) => s.editConfirmed);
  const setBrief = useFlow((s) => s.setBrief);
  const understand = useFlow((s) => s.understand);
  const generate = useFlow((s) => s.generate);
  const ready = useFlow(canGenerate);
  const { speak } = useVoiceGuide();
  const [busy, setBusy] = useState<'generate' | 'recheck' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const catalogue = useCatalogue();

  const open = unansweredQuestions(understanding, answers);

  useEffect(() => {
    if (!understanding) return;
    const parts = [t('weUnderstood')];
    if (understanding.sport) parts.push(`${t('sport')}: ${tMaybe(t, `sport_${understanding.sport}`, understanding.sport)}`);
    parts.push(`${t('garment')}: ${t(`garment_${understanding.garment}`)}`);
    if (understanding.colors.length) parts.push(`${t('colours')}: ${understanding.colors.map((c) => c.name).join(', ')}`);
    open.forEach((q) => parts.push(questionText(t, q)));
    speak(parts.join('. '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [understanding]);

  if (!understanding || !confirmed) {
    return (
      <Screen>
        <Empty label={t('noDesigns')} />
        <Button label={t('back')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  const recheck = async () => {
    setBusy('recheck');
    setError(null);
    try {
      setBrief({
        prompt: confirmed.prompt, garment: confirmed.garment, team_name: confirmed.team_name,
        player_name: confirmed.player_name, number: confirmed.number, locked_colors: confirmed.locked_colors,
        options: confirmed.options,
      });
      await understand(lang);
      setPromptDirty(false);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const go = async () => {
    setBusy('generate');
    setError(null);
    try {
      await generate(lang);
      router.push('/designs');
    } catch (e) {
      const msg = errorMessage(t, e);
      setError(msg);
      speak(msg);
    } finally {
      setBusy(null);
    }
  };

  const issues = {
    prompt: checkPrompt(confirmed.prompt),
    team: checkTeam(confirmed.team_name),
    player: checkPlayer(confirmed.player_name),
    number: checkNumber(confirmed.number),
  };
  const fieldsOk = !issues.prompt && !issues.team && !issues.player && !issues.number;
  const sourceLabel = (s: string | null) => (s === 'prompt' ? t('fromBrief') : s === 'form' ? t('fromForm') : '');
  const locked = confirmed.locked_colors;
  const toggleLock = (hex: string) => {
    const next = locked.includes(hex) ? locked.filter((c) => c !== hex) : [...locked, hex].slice(0, MAX_LOCKED_COLORS);
    editConfirmed({ locked_colors: next });
  };

  return (
    <Screen
      testID="screen-confirm"
      footer={
        <View>
          {open.length ? <T variant="caption" color={colors.warn} style={{ marginBottom: space(2) }}>{t('answerQuestions', { n: open.length })}</T> : null}
          <Button testID="generate" label={t('generateCta')} onPress={go} busy={busy === 'generate'}
            disabled={!ready || !fieldsOk || promptDirty || busy !== null} />
        </View>
      }
    >
      <T variant="title" accessibilityRole="header">{t('weUnderstood')}</T>

      {open.map((q) => (
        <Card key={q.id} title={t('whichIsCorrect')} style={styles.question}>
          <T variant="body" style={{ marginBottom: space(3) }} testID={`question-${q.id}`}>{questionText(t, q)}</T>
          <View style={styles.wrap}>
            {q.options.map((o) => (
              <Chip
                key={`${q.id}-${o.value}`}
                testID={`answer-${q.id}-${o.value}`}
                label={(q.field === 'sport' ? tMaybe(t, `sport_${o.value}`, o.value) : q.field === 'garment'
                  ? tMaybe(t, `garment_${o.value}`, o.value) : `“${o.value}”`) + (o.source === 'prompt' || o.source === 'form' ? ` · ${sourceLabel(o.source)}` : '')}
                onPress={() => answer(q, o.value)}
              />
            ))}
          </View>
        </Card>
      ))}

      <Card title={t('recognizedPrompt')}>
        <Field
          testID="confirm-prompt"
          label={t('briefLabel')}
          value={confirmed.prompt}
          multiline
          maxLength={PROMPT_LIMIT}
          onChangeText={(prompt) => {
            editConfirmed({ prompt });
            setPromptDirty(true);
          }}
          error={issues.prompt ? (issues.prompt === 'tooLong' ? t('promptTooLong') : t('promptTooShort')) : null}
        />
        {promptDirty ? <Button testID="recheck" kind="secondary" label={t('understandCta')} onPress={recheck} busy={busy === 'recheck'} /> : null}
      </Card>

      <Card title={t('sport')}>
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {SPORTS.map((s) => (
            <Chip key={s} testID={`sport-${s}`} label={t(`sport_${s}`)} selected={confirmed.sport === s}
              onPress={() => editConfirmed({ sport: s })} />
          ))}
        </View>
      </Card>

      <Card title={t('garment')}>
        <View style={styles.wrap} accessibilityRole="radiogroup">
          {GARMENTS.map((g) => (
            <Chip key={g} testID={`confirm-garment-${g}`} label={t(`garment_${g}`)} selected={confirmed.garment === g}
              onPress={() => editConfirmed({ garment: g })} />
          ))}
        </View>
      </Card>

      {hasSleeves(confirmed.garment) ? (
        <Card title={t('garmentOptions')} testID="confirm-options">
          {/* Picked > read from the brief > the default. Only a pick is sent; the server reads the brief itself. */}
          <GarmentOptionsPicker garment={confirmed.garment} testID="confirm-opt"
            sleeves={confirmed.options?.sleeves ?? understanding.options?.sleeves ?? 'short'}
            collar={confirmed.options?.collar ?? understanding.options?.collar ?? 'crew'}
            onSleeves={(sleeves) => editConfirmed({ options: { ...confirmed.options, sleeves } })}
            onCollar={(collar) => editConfirmed({ options: { ...confirmed.options, collar } })}
            prices={catalogue?.options} currency={catalogue?.currency}
            note={(understanding.options?.sleeves && !confirmed.options?.sleeves) || (understanding.options?.collar && !confirmed.options?.collar)
              ? t('optionsFromBrief') : t('optionsHint')} />
        </Card>
      ) : null}

      <Card title={t('colours')}>
        {understanding.colors.length === 0 && locked.length === 0 ? <T variant="caption">{t('noneDetected')}</T> : null}
        <View style={styles.wrap}>
          {[...new Set([...understanding.colors.map((c) => c.hex), ...locked])].map((hex) => {
            const c = understanding.colors.find((x) => x.hex === hex);
            return (
              <View key={hex} style={styles.color}>
                <Swatch hex={hex} selected={locked.includes(hex)} label={`${c?.name ?? hex} ${locked.includes(hex) ? '🔒' : ''}`}
                  onPress={() => toggleLock(hex)} />
                <T variant="caption">{c?.name ?? hex}{locked.includes(hex) ? ' 🔒' : ''}</T>
              </View>
            );
          })}
          {locked.length < MAX_LOCKED_COLORS ? <Button compact kind="secondary" label={`+ ${t('addColor')}`} onPress={() => setPicker(true)} /> : null}
        </View>
        <T variant="caption" style={{ marginTop: space(2) }}>{t('lockedColorsHint')}</T>
      </Card>

      <Card title={t('themes')}>
        <View style={styles.wrap}>
          {[...understanding.patterns.map((p) => tMaybe(t, `pattern_${p}`, p)), ...understanding.themes].map((x) => <Chip key={x} label={x} />)}
          {understanding.patterns.length + understanding.themes.length === 0 ? <T variant="caption">{t('noneDetected')}</T> : null}
        </View>
      </Card>

      <Card title={`${t('teamName')} · ${t('playerName')} · ${t('number')}`}>
        <Field testID="confirm-team" label={t('teamName')} value={confirmed.team_name} maxLength={TEXT_LIMITS.team_name}
          hint={sourceLabel(understanding.team_name.source)} error={issues.team ? t('tooLong') : null}
          onChangeText={(team_name) => editConfirmed({ team_name })} />
        <Field testID="confirm-player" label={t('playerName')} value={confirmed.player_name} maxLength={TEXT_LIMITS.player_name}
          hint={sourceLabel(understanding.player_name.source)} error={issues.player ? t('tooLong') : null}
          onChangeText={(player_name) => editConfirmed({ player_name })} />
        <Field testID="confirm-number" label={t('number')} value={confirmed.number} keyboardType="number-pad" maxLength={3}
          hint={sourceLabel(understanding.number.source)} error={issues.number ? t('digitsOnly') : null}
          onChangeText={(v) => editConfirmed({ number: cleanNumber(v) })} />
        <T variant="caption">{t('exactSpelling')}</T>
      </Card>

      {error ? <Banner tone="fail" text={error} action={t('retry')} onAction={go} testID="confirm-error" /> : null}
      <ColorPickerModal visible={picker} initial="#c9a227" onClose={() => setPicker(false)}
        onPick={(hex) => { if (!locked.includes(hex)) editConfirmed({ locked_colors: [...locked, hex].slice(0, MAX_LOCKED_COLORS) }); setPicker(false); }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  question: { borderWidth: 2, borderColor: colors.warn },
  color: { alignItems: 'center', marginRight: space(3), marginBottom: space(2) },
});
