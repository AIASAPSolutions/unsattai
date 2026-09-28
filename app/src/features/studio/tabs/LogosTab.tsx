import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { api } from '../../../api/endpoints';
import { MAX_LOGOS, type BackgroundRemoval, type LogoElement, type LogoSuggestion } from '../../../api/types';
import { SvgImage } from '../../../components/SvgImage';
import { errorMessage, useT } from '../../../i18n';
import { dpiLevel, effectiveDpi, maxWidthForDpi, worstSize } from '../../../lib/dpi';
import { zoneCenter } from '../../../lib/geometry';
import { formatBytes, inspectImage } from '../../../lib/image';
import { readAsBase64 } from '../../../lib/readFile';
import { addElement, canAddLogo, logoCount, placeLogo, removeElement, updateElement } from '../../../lib/spec';
import { svgAspect } from '../../../lib/svg';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { Slider } from '../../../ui/Slider';
import { Loading } from '../../../ui/States';
import { T } from '../../../ui/Text';
import { colors, radius, space } from '../../../ui/theme';
import { latestSpec, type StudioTools } from './types';

// Original and cleaned versions of a logo after background removal. Kept out of
// the spec (and out of the saved draft) so orders never carry both copies.
const alternates = new Map<string, { original: string; result: BackgroundRemoval }>();

function Thumb({ src, kind, size = 64 }: { src: string; kind: 'raster' | 'vector'; size?: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      <SvgImage xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><image href="${src}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet"/></svg>`}
        aspect={1} label={kind} />
    </View>
  );
}

export function LogosTab(tools: StudioTools) {
  const { spec, edit, live, begin, end, selectedId, select, side, sizes } = tools;
  const t = useT();
  const [suggestions, setSuggestions] = useState<LogoSuggestion[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState<'suggest' | 'upload' | 'bg' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);

  const logos = spec.elements.filter((e): e is LogoElement => e.type === 'logo');
  const full = !canAddLogo(spec);
  const size = worstSize(sizes);
  const suggestKey = `${spec.typography.team_name}|${spec.sport}`;

  const loadSuggestions = async (offset: number) => {
    setBusy('suggest');
    setError(null);
    try {
      const res = await api.suggestLogos({
        team_name: spec.typography.team_name, sport: spec.sport, prompt: `${spec.style_name} ${spec.rationale}`.slice(0, 300),
        palette: spec.palette, offset,
      });
      setSuggestions((s) => (offset === 0 ? res.logos : [...s, ...res.logos]));
      setNext(res.next_offset);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    loadSuggestions(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey]);

  const add = (logo: Omit<LogoElement, 'id' | 'panel' | 'x' | 'y' | 'rotation'>) => {
    const cur = latestSpec() ?? spec;
    if (!canAddLogo(cur)) {
      setError(t('logoLimit'));
      return;
    }
    const el = placeLogo(cur, logo, side);
    edit(addElement(cur, el));
    select(el.id);
  };

  const addSuggested = (s: LogoSuggestion) => add({
    type: 'logo', src: s.data_url, width: 80, aspect: svgAspect(s.svg), kind: 'vector', source: 'suggested', name: s.name,
    pixel_width: null, pixel_height: null,
  });

  const addUpload = async (base64: string, name: string) => {
    const info = inspectImage(base64);
    if (info === 'type') throw new Error(t('logoWrongType'));
    if (info === 'size') throw new Error(t('logoTooBig', { size: formatBytes(base64.length * 0.75) }));
    const vector = info.mime === 'image/svg+xml';
    // Start at a width that still prints at 300 DPI in the largest ordered size, within 40–120 mm.
    const width = vector || !info.width ? 90 : Math.max(40, Math.min(120, maxWidthForDpi(info.width, size)));
    add({
      type: 'logo', src: info.dataUrl, width, aspect: info.aspect, kind: vector ? 'vector' : 'raster', source: 'upload', name,
      pixel_width: info.width, pixel_height: info.height,
    });
  };

  const pick = async (from: 'photos' | 'files') => {
    setError(null);
    setBusy('upload');
    try {
      if (from === 'photos') {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false,
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });
        if (res.canceled || !res.assets[0]) return;
        const a = res.assets[0];
        const { base64 } = await readAsBase64(a.uri);
        await addUpload(base64, a.fileName ?? 'logo');
      } else {
        const res = await DocumentPicker.getDocumentAsync({
          type: ['image/png', 'image/jpeg', 'image/svg+xml'], copyToCacheDirectory: true, multiple: false,
        });
        if (res.canceled || !res.assets[0]) return;
        const a = res.assets[0];
        if (a.size && a.size > 1_500_000) throw new Error(t('logoTooBig', { size: formatBytes(a.size) }));
        const { base64 } = await readAsBase64(a.uri);
        await addUpload(base64, a.name);
      }
    } catch (e) {
      setError(e instanceof Error && !('kind' in e) ? e.message : errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const selected = logos.find((l) => l.id === selectedId) ?? null;
  const alt = selected ? alternates.get(selected.id) : undefined;

  const removeBg = async (logo: LogoElement) => {
    setBusy('bg');
    setError(null);
    try {
      const original = alternates.get(logo.id)?.original ?? logo.src;
      const result = await api.removeBackground(original);
      alternates.set(logo.id, { original, result });
      bump((n) => n + 1);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const useVersion = (logo: LogoElement, src: string) => {
    const info = inspectImage(src);
    if (info === 'size') {
      setError(t('logoTooBig', { size: formatBytes(src.length * 0.75) }));
      return;
    }
    edit(updateElement(spec, logo.id, { src }));
  };

  const patch = (p: Partial<LogoElement>, liveOnly = false) => {
    const cur = latestSpec();
    if (!cur || !selected) return;
    (liveOnly ? live : edit)(updateElement(cur, selected.id, p));
  };

  const dpiNote = (l: LogoElement) => {
    const level = dpiLevel(l, size);
    if (level === 'vector') return { tone: colors.pass, text: t('logoVector') };
    if (level === 'unknown') return null;
    const dpi = Math.round(effectiveDpi(l, size) ?? 0);
    if (level === 'good') return { tone: colors.pass, text: t('logoDpi', { dpi, size }) };
    if (level === 'low') return { tone: colors.warn, text: `${t('logoDpi', { dpi, size })}. ${t('logoDpiLow', { size })}` };
    return { tone: colors.fail, text: `${t('logoDpi', { dpi, size })}. ${t('logoDpiBad')}` };
  };

  return (
    <View>
      {error ? <Banner tone="fail" text={error} testID="logo-error" /> : null}

      <Card title={`${t('logosOnDesign')} (${logoCount(spec)}/${MAX_LOGOS})`}>
        {logos.length === 0 ? <T variant="caption">{t('noLogos')}</T> : null}
        {logos.map((l) => {
          const note = dpiNote(l);
          const on = l.id === selectedId;
          return (
            <Pressable key={l.id} testID={`logo-${l.id}`} onPress={() => select(on ? null : l.id)} accessibilityRole="button"
              accessibilityState={{ selected: on }} style={[styles.row, on && styles.rowOn]}>
              <Thumb src={l.src} kind={l.kind} size={48} />
              <View style={{ flex: 1, marginLeft: space(3) }}>
                <T variant="label" numberOfLines={1}>{l.name || t('layerLogo')} · {l.panel === 'front' ? t('front') : t('back2')}</T>
                {note ? <T variant="caption" color={note.tone}>{note.text}</T> : null}
              </View>
            </Pressable>
          );
        })}

        {selected ? (
          <View style={styles.editor}>
            <Slider testID="logo-width" label={t('size')} value={selected.width} min={10} max={400} step={1}
              onBegin={begin} onChange={(width) => patch({ width }, true)} onCommit={end} format={(v) => `${Math.round(v)} mm`} />
            <Slider testID="logo-rotation" label={t('rotate')} value={selected.rotation} min={-180} max={180} step={1}
              onBegin={begin} onChange={(rotation) => patch({ rotation }, true)} onCommit={end} format={(v) => `${Math.round(v)}°`} />
            {selected.kind === 'raster' ? (
              <View>
                <Button testID="remove-bg" kind="secondary" compact label={t('removeBg')} busy={busy === 'bg'} onPress={() => removeBg(selected)} />
                {alt ? (
                  <View style={{ marginTop: space(3) }}>
                    <T variant="caption">{alt.result.applied
                      ? t('bgRemoved', { pct: Math.round(alt.result.removed_ratio * 100) })
                      : t('bgNotRemoved', { reason: alt.result.reason ?? '' })}</T>
                    {alt.result.applied ? (
                      <View style={styles.compare}>
                        <View style={styles.compareCol}>
                          <Thumb src={alt.original} kind="raster" size={96} />
                          <Button compact kind={selected.src === alt.original ? 'primary' : 'secondary'} label={t('useOriginal')}
                            onPress={() => useVersion(selected, alt.original)} />
                        </View>
                        <View style={styles.compareCol}>
                          <View style={styles.checker}><Thumb src={alt.result.data_url} kind="raster" size={96} /></View>
                          <Button testID="use-cleaned" compact kind={selected.src === alt.result.data_url ? 'primary' : 'secondary'}
                            label={t('useCleaned')} onPress={() => useVersion(selected, alt.result.data_url)} />
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={[styles.wrap, { marginTop: space(3) }]}>
              <Button compact kind="secondary" label={`⇄ ${t('bringToFront')}`} onPress={() => {
                const other = selected.panel === 'front' ? 'back' : 'front';
                const [x, y] = zoneCenter(spec.garment, other);
                patch({ panel: other, x, y });
              }} style={{ marginRight: space(2) }} />
              <Button compact kind="danger" label={t('deleteLayer')} onPress={() => {
                alternates.delete(selected.id);
                edit(removeElement(spec, selected.id));
                select(null);
              }} />
            </View>
          </View>
        ) : null}
      </Card>

      <Card title={t('uploadLogo')}>
        {full ? <T variant="caption" color={colors.warn}>{t('logoLimit')}</T> : null}
        <View style={styles.wrap}>
          <Button testID="upload-photos" compact kind="secondary" label={t('fromPhotos')} disabled={full || busy !== null}
            busy={busy === 'upload'} onPress={() => pick('photos')} style={{ marginRight: space(2), marginBottom: space(2) }} />
          <Button testID="upload-files" compact kind="secondary" label={t('fromFiles')} disabled={full || busy !== null}
            onPress={() => pick('files')} />
        </View>
        <T variant="caption">{t('uploadHint')}</T>
      </Card>

      <Card title={t('logoSuggestions')}>
        <View style={styles.grid}>
          {suggestions.map((s, i) => (
            <Pressable key={s.id} testID={`suggestion-${i}`} disabled={full} onPress={() => addSuggested(s)} accessibilityRole="button"
              accessibilityLabel={`${t('add')} ${s.name}`} style={[styles.suggestion, full && { opacity: 0.4 }]}>
              <SvgImage xml={s.svg} aspect={svgAspect(s.svg)} label={s.name} />
            </Pressable>
          ))}
        </View>
        {busy === 'suggest' ? <Loading label={t('loading')} /> : null}
        {next !== null && busy !== 'suggest' ? (
          <Button testID="more-logos" kind="secondary" compact label={t('loadMore')} onPress={() => loadSuggestions(next)} />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  thumb: { borderRadius: radius.sm, backgroundColor: '#eef0f4', overflow: 'hidden', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', padding: space(2), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginBottom: space(2) },
  rowOn: { borderColor: colors.blue, borderWidth: 2 },
  editor: { marginTop: space(2), paddingTop: space(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  compare: { flexDirection: 'row', marginTop: space(2) },
  compareCol: { alignItems: 'center', marginRight: space(4) },
  checker: { backgroundColor: '#d8dbe2', borderRadius: radius.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  suggestion: { width: '23%', aspectRatio: 1, marginBottom: space(2), padding: space(1), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
});
