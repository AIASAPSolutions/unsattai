import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { Image, Share, StyleSheet, View } from 'react-native';
import { api } from '../api/endpoints';
import { DesignCard } from '../components/DesignCard';
import type { FromImageResponse, PictureWarning } from '../api/types';
import { buildOutsidePrompt } from '../features/picture/outsidePrompt';
import { preparePicture } from '../features/picture/preparePicture';
import { errorMessage, tMaybe, useT } from '../i18n';
import { useFlow } from '../state/flow';
import { useMeta } from '../state/meta';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Screen } from '../ui/Screen';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

interface Picked {
  uri: string;
  dataUrl: string;
  aspect: number;
}

export default function FromPictureScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const brief = useFlow((s) => s.brief);
  const confirmed = useFlow((s) => s.confirmed);
  const showDesigns = useFlow((s) => s.showDesigns);
  const designs = useFlow((s) => s.designs);
  const { meta } = useMeta();
  const { speak } = useVoiceGuide();

  const [copied, setCopied] = useState(false);
  const [picture, setPicture] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<'pick' | 'recognise' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FromImageResponse | null>(null);

  const prompt = useMemo(() => buildOutsidePrompt({
    garment: brief.garment, idea: brief.prompt, sport: confirmed?.sport ?? null, colors: brief.locked_colors,
    colorNames: meta?.colors,
  }), [brief.garment, brief.prompt, brief.locked_colors, confirmed?.sport, meta?.colors]);

  const copy = async () => {
    await Clipboard.setStringAsync(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const pick = async () => {
    setError(null);
    setBusy('pick');
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      const ready = await preparePicture(a.uri, a.width, a.height);
      setPicture({ uri: ready.uri, dataUrl: ready.dataUrl, aspect: a.width && a.height ? a.height / a.width : 1 });
      setResult(null);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const recognise = async () => {
    if (!picture) return;
    setError(null);
    setBusy('recognise');
    try {
      const res = await api.fromImage({
        image: picture.dataUrl, garment: brief.garment, sport: confirmed?.sport ?? null,
        team_name: brief.team_name, player_name: brief.player_name, number: brief.number, language: lang,
      });
      showDesigns({ ...res, requested_provider: 'image', fallback_reason: null, seed: 0 });
      setResult(res);
      speak(`${t('recognisedTitle')}. ${res.recognised.notes || t('pictureRebuilt')}`);
    } catch (e) {
      const msg = errorMessage(t, e);
      setError(msg);
      speak(msg);
    } finally {
      setBusy(null);
    }
  };

  const warning = (w: PictureWarning) => t(`warn_${w}`, { text: result?.recognised.text_seen.join(', ') ?? '' });
  // Show the cards from the flow store so ratings and "open in editor" work as on the Designs screen.
  const shown = result ? designs.filter((d) => result.designs.some((r) => r.id === d.id)) : [];

  return (
    <Screen testID="screen-picture">
      <T variant="title" accessibilityRole="header">{t('pictureTitle')}</T>

      <Card title={t('promptStep')}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('promptStepHint')}</T>
        <View style={styles.promptBox}>
          <T variant="body" selectable testID="outside-prompt" style={{ fontSize: 14 }}>{prompt}</T>
        </View>
        <View style={styles.row}>
          <Button testID="copy-prompt" compact label={copied ? `✓ ${t('copyPrompt')}` : t('copyPrompt')} onPress={copy} />
          <Button compact kind="secondary" label={t('sharePrompt')} onPress={() => Share.share({ message: prompt }).catch(() => undefined)} />
        </View>
        {copied ? <T variant="caption" color={colors.pass} testID="prompt-copied" style={{ marginTop: space(2) }}>{t('copied')}</T> : null}
      </Card>

      <Card title={t('uploadStep')}>
        <T variant="caption" style={{ marginBottom: space(3) }}>{t('uploadStepHint')}</T>
        {picture ? (
          <Image source={{ uri: picture.uri }} accessibilityLabel={t('uploadStep')} testID="picked-picture"
            style={[styles.preview, { aspectRatio: 1 / picture.aspect }]} resizeMode="contain" />
        ) : null}
        <View style={styles.row}>
          <Button testID="choose-picture" compact kind={picture ? 'secondary' : 'primary'}
            label={picture ? t('changePicture') : t('choosePicture')} onPress={pick} busy={busy === 'pick'} disabled={busy !== null} />
          {picture ? (
            <Button testID="recognise" compact label={t('recognise')} onPress={recognise} busy={busy === 'recognise'} disabled={busy !== null} />
          ) : null}
        </View>
      </Card>

      {error ? <Banner tone="fail" text={error} testID="picture-error" /> : null}

      {result ? (
        <View testID="picture-result">
          <Card title={t('recognisedTitle')}>
            <T variant="label">{result.source === 'ai' ? t('recognisedByAi') : t('recognisedByPixels')}</T>
            <View style={styles.swatches}>
              {result.colors.map((c) => (
                <View key={c.hex} style={styles.swatch}>
                  <View style={[styles.dot, { backgroundColor: c.hex }]} />
                  <T variant="caption">{Math.round(c.share * 100)}%</T>
                </View>
              ))}
            </View>
            <T variant="caption">
              {tMaybe(t, `pattern_${result.recognised.pattern}`, result.recognised.pattern)} · {t('coverageLabel')}: {tMaybe(t, `coverage_${result.recognised.coverage}`, result.recognised.coverage)}
            </T>
            {result.recognised.notes ? <T variant="body" style={{ marginTop: space(2), fontSize: 14 }}>{result.recognised.notes}</T> : null}
            {result.ai.enabled ? (
              <T variant="caption" style={{ marginTop: space(2) }}>✨ {t('aiLeft', { n: result.ai.remaining, limit: result.ai.limit })}</T>
            ) : null}
          </Card>
          {result.warnings.map((w) => <Banner key={w} tone="warn" text={warning(w)} testID={`warn-${w}`} />)}
          <Banner tone="info" text={t('pictureRebuilt')} />
          {shown.map((d, i) => <DesignCard key={d.id} d={d} index={i} />)}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  promptBox: {
    backgroundColor: colors.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line,
    padding: space(3), marginBottom: space(3),
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  preview: { width: '100%', maxHeight: 360, borderRadius: radius.md, backgroundColor: '#eef0f4', marginBottom: space(3) },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: space(2) },
  swatch: { alignItems: 'center', marginRight: space(3) },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.line, marginBottom: space(1) },
});
