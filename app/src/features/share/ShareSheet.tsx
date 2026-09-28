import { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../api/endpoints';
import type { DesignSpec } from '../../api/types';
import { SvgImage } from '../../components/SvgImage';
import { errorMessage, tMaybe, useT } from '../../i18n';
import { describeSpec } from '../../lib/spec';
import { svgAspect } from '../../lib/svg';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ErrorState, Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { shareImage, shareText } from './share';

export function ShareSheet({ spec, visible, onClose }: { spec: DesignSpec; visible: boolean; onClose: () => void }) {
  const t = useT();
  const card = useRef<View>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [note, setNote] = useState<{ tone: 'info' | 'fail'; text: string } | null>(null);
  const [busy, setBusy] = useState<'png' | 'text' | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setSvg(null);
    setLoadError(null);
    setNote(null);
    api.render(spec, [], controller.signal).then((r) => setSvg(r.mockup_svg)).catch((e) => {
      if (!controller.signal.aborted) setLoadError(e);
    });
    return () => controller.abort();
  }, [visible, spec, nonce]);

  const text = describeSpec(spec, {
    garment: t(`garment_${spec.garment}`), sport: tMaybe(t, `sport_${spec.sport}`, spec.sport),
    pattern: tMaybe(t, `pattern_${spec.pattern.type}`, spec.pattern.type),
    coverage: tMaybe(t, `coverage_${spec.pattern.coverage}`, spec.pattern.coverage),
    font: tMaybe(t, `font_${spec.typography.font}`, spec.typography.font),
  });

  const run = async (kind: 'png' | 'text') => {
    setBusy(kind);
    setNote(null);
    try {
      const out = kind === 'png' ? await shareImage(card, svg ?? '', t('shareTitle')) : await shareText(text, t('shareTitle'));
      if (out === 'unavailable') setNote({ tone: 'fail', text: t('shareFailed') });
      if (out === 'copied') setNote({ tone: 'info', text: t('copied') });
    } catch (e) {
      // Dismissing the share sheet is not an error.
      if (!(e instanceof Error && /abort|cancel/i.test(e.name + e.message))) setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID="share-sheet">
          <T variant="heading" style={{ marginBottom: space(3) }}>{t('shareTitle')}</T>
          {loadError ? <ErrorState message={errorMessage(t, loadError)} retryLabel={t('retry')} onRetry={() => setNonce((n) => n + 1)} />
            : !svg ? <Loading label={t('loading')} /> : (
              <View ref={card} collapsable={false} style={styles.card}>
                <SvgImage xml={svg} aspect={svgAspect(svg)} label={spec.style_name} />
                <View style={styles.brand}>
                  <T variant="label" color={colors.navy}>{spec.style_name}</T>
                  <T variant="label" color={colors.brand}>UrJersey</T>
                </View>
              </View>
            )}
          {note ? <Banner tone={note.tone} text={note.text} /> : null}
          <View style={styles.row}>
            <Button testID="share-png" label={t('sharePng')} onPress={() => run('png')} busy={busy === 'png'} disabled={!svg || busy !== null} style={{ flex: 1, marginRight: space(2) }} />
            <Button testID="share-text" kind="secondary" label={t('shareText')} onPress={() => run('text')} busy={busy === 'text'} disabled={busy !== null} style={{ flex: 1 }} />
          </View>
          <Button kind="ghost" label={t('close')} onPress={onClose} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,17,36,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space(4), maxHeight: '92%' },
  card: { backgroundColor: '#eef0f4', borderRadius: radius.md, padding: space(3), marginBottom: space(3) },
  brand: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space(2) },
  row: { flexDirection: 'row', marginTop: space(2) },
});
