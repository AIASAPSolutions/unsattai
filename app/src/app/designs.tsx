import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { summarize } from '../components/ChecksList';
import { SvgImage } from '../components/SvgImage';
import type { Design } from '../api/types';
import { errorMessage, tMaybe, useT } from '../i18n';
import { svgAspect } from '../lib/svg';
import { useFlow } from '../state/flow';
import { usePrefs } from '../state/prefs';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Empty } from '../ui/States';
import { Stars } from '../ui/Stars';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';
import { useVoiceGuide } from '../voice/useVoiceGuide';

function DesignCard({ d, index }: { d: Design; index: number }) {
  const t = useT();
  const rating = useFlow((s) => s.ratings[d.id] ?? 0);
  const rate = useFlow((s) => s.rate);
  const openDesign = useFlow((s) => s.openDesign);
  const [rateError, setRateError] = useState<string | null>(null);
  const counts = summarize(d.checks);
  const p = d.spec.pattern;
  return (
    <Card>
      <View style={styles.mock}>
        <SvgImage xml={d.mockup_svg} aspect={svgAspect(d.mockup_svg)} label={`${d.spec.style_name}, ${t(`garment_${d.spec.garment}`)}`} />
      </View>
      <View style={styles.titleRow}>
        <T variant="heading" style={{ flex: 1 }}>{d.spec.style_name}</T>
        <View style={[styles.badge, { backgroundColor: d.manufacturing_ready ? colors.passSoft : colors.failSoft }]}>
          <T variant="caption" color={d.manufacturing_ready ? colors.pass : colors.fail}>
            {d.manufacturing_ready ? `✓ ${t('ready')}` : `✕ ${t('notReady')}`}
          </T>
        </View>
      </View>
      <T variant="caption">
        {tMaybe(t, `pattern_${p.type}`, p.type)} · {t('coverageLabel')}: {tMaybe(t, `coverage_${p.coverage}`, p.coverage)} · {tMaybe(t, `sport_${d.spec.sport}`, d.spec.sport)}
      </T>
      {counts.warn ? <T variant="caption" color={colors.warn}>! {t('warnings', { n: counts.warn })}</T> : null}
      <View style={styles.palette}>
        {(['primary', 'secondary', 'accent', 'trim', 'text'] as const).map((r) => (
          <View key={r} style={[styles.dot, { backgroundColor: d.spec.palette[r] }]} accessibilityLabel={`${t(`role_${r}`)} ${d.spec.palette[r]}`} />
        ))}
      </View>
      {d.spec.rationale ? <T variant="body" style={{ fontSize: 14, marginTop: space(2) }}>{d.spec.rationale}</T> : null}
      <View style={styles.rateRow}>
        <T variant="caption">{rating ? t('rated') : t('rate')}</T>
        <Stars testID={`rate-${index}`} label={t('rate')} value={rating} onChange={(n) => {
          setRateError(null);
          rate(d.id, n).catch((e) => setRateError(errorMessage(t, e)));
        }} />
      </View>
      {rateError ? <T variant="caption" color={colors.fail}>{rateError}</T> : null}
      <Button testID={`open-${index}`} label={t('openEditor')} onPress={() => { openDesign(d); router.push('/studio'); }} style={{ marginTop: space(3) }} />
    </Card>
  );
}

export default function DesignsScreen() {
  const t = useT();
  const lang = usePrefs((s) => s.language);
  const designs = useFlow((s) => s.designs);
  const generation = useFlow((s) => s.generation);
  const generate = useFlow((s) => s.generate);
  const { speak } = useVoiceGuide();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (designs.length) speak(`${designs.length} ${t('variants')}. ${designs.map((d) => d.spec.style_name).join(', ')}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs.length]);

  const more = async () => {
    setBusy(true);
    setError(null);
    try {
      await generate(lang, true);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      testID="screen-designs"
      data={designs}
      keyExtractor={(d) => d.id}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(12) }}
      ListHeaderComponent={
        <View>
          {generation?.fallback_reason ? (
            <Banner tone="info" text={t('fallbackNotice', { reason: generation.fallback_reason })} />
          ) : generation ? <T variant="caption" style={{ marginBottom: space(3) }}>{t('engine', { name: generation.provider })}</T> : null}
        </View>
      }
      ListEmptyComponent={<Empty label={t('noDesigns')} />}
      renderItem={({ item, index }) => <DesignCard d={item} index={index} />}
      ListFooterComponent={
        <View>
          {error ? <Banner tone="fail" text={error} action={t('retry')} onAction={more} /> : null}
          <Button testID="more-designs" kind="secondary" label={busy ? t('generating') : t('moreDesigns')} onPress={more} busy={busy} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  mock: { backgroundColor: '#eef0f4', borderRadius: radius.md, padding: space(2), marginBottom: space(3) },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(1) },
  badge: { paddingHorizontal: space(2), paddingVertical: space(1), borderRadius: radius.pill, marginLeft: space(2) },
  palette: { flexDirection: 'row', marginTop: space(2) },
  dot: { width: 22, height: 22, borderRadius: 11, marginRight: space(1.5), borderWidth: 1, borderColor: colors.line },
  rateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(3) },
});
