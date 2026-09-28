import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LayerPanel, Size } from '../api/types';
import { Garment3D } from '../features/studio/Garment3D';
import { PanelEditor } from '../features/studio/PanelEditor';
import { ChecksTab } from '../features/studio/tabs/ChecksTab';
import { LogosTab } from '../features/studio/tabs/LogosTab';
import { RefineTab } from '../features/studio/tabs/RefineTab';
import { StyleTab } from '../features/studio/tabs/StyleTab';
import { TextTab } from '../features/studio/tabs/TextTab';
import type { StudioTools } from '../features/studio/tabs/types';
import { isOffline, usePrintPanels, useStudioData } from '../features/studio/useStudioData';
import { ShareSheet } from '../features/share/ShareSheet';
import { errorMessage, tMaybe, useT } from '../i18n';
import { canRedo, canUndo } from '../lib/history';
import { isSafe } from '../lib/geometry';
import { materializeLayers, usesLayers } from '../lib/spec';
import { currentSpec, useFlow } from '../state/flow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Segmented } from '../ui/Segmented';
import { Empty, ErrorState, Loading } from '../ui/States';
import { T } from '../ui/Text';
import { colors, space } from '../ui/theme';

type Tab = 'style' | 'text' | 'logos' | 'refine' | 'checks';

const PANEL_LABEL: Record<string, 'front' | 'back2' | 'sleeveLeft' | 'sleeveRight'> = {
  front: 'front', back: 'back2', sleeve_left: 'sleeveLeft', sleeve_right: 'sleeveRight',
};

export default function StudioScreen() {
  const t = useT();
  const { width, height } = useWindowDimensions();
  const spec = useFlow(currentSpec);
  const history = useFlow((s) => s.history);
  const designId = useFlow((s) => s.designId);
  const edit = useFlow((s) => s.edit);
  const live = useFlow((s) => s.live);
  const beginGesture = useFlow((s) => s.beginGesture);
  const endGesture = useFlow((s) => s.endGesture);
  const undo = useFlow((s) => s.undo);
  const redo = useFlow((s) => s.redo);

  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [panelName, setPanelName] = useState('front');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('style');
  const [sizes, setSizes] = useState<Size[]>(['M']);
  const [sharing, setSharing] = useState(false);

  const data = useStudioData(spec, sizes);
  const print = usePrintPanels(spec, view === '3d');

  // First answer from the server: turn the classic name/number placement into
  // editable layers. `live` so this is not an undo step of its own.
  const materialized = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !data.defaults || data.checkedSpec !== spec || materialized.current === designId) return;
    materialized.current = designId;
    if (!usesLayers(spec)) live(materializeLayers(spec, data.defaults));
  }, [spec, data.defaults, data.checkedSpec, designId, live]);

  const panels = data.panels?.panels ?? [];
  const panel = panels.find((p) => p.name === panelName) ?? panels[0] ?? null;
  const side: LayerPanel = panel?.side ?? 'front';

  const select = (id: string | null) => {
    setSelectedId(id);
    const el = id ? spec?.elements.find((e) => e.id === id) : null;
    if (el && el.panel !== panel?.side) {
      setPanelName(el.panel);
      setView('2d');
    }
  };

  // Drop a selection whose layer was undone or deleted.
  useEffect(() => {
    if (selectedId && !spec?.elements.some((e) => e.id === selectedId)) setSelectedId(null);
  }, [spec, selectedId]);

  const fresh = !!spec && data.checkedSpec === spec && data.status !== 'error';
  const canOrder = fresh && data.ready === true;
  const unsafe = useMemo(() => spec?.elements.filter((e) => !isSafe(spec, e)) ?? [], [spec]);

  if (!spec || !history) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Empty label={t('noDesigns')} />
        <Button label={t('newDesign')} onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  const tools: StudioTools = {
    spec, edit, live, begin: beginGesture, end: endGesture, selectedId, select, side, sizes,
  };

  // Keep the canvas on screen while tools scroll underneath it.
  const maxCanvasH = Math.max(220, height * 0.34);
  const frameW = Math.min(width - space(8), 560);
  const panelW = panel ? Math.min(frameW, maxCanvasH * (panel.width / panel.height)) : frameW;
  const stageW = Math.min(frameW, maxCanvasH);
  const swipe = (dir: 1 | -1) => {
    const i = panels.findIndex((p) => p.name === panel?.name);
    const next = panels[(i + dir + panels.length) % panels.length];
    if (next) setPanelName(next.name);
  };

  const unsafeName = (id: string) => {
    const el = spec.elements.find((e) => e.id === id);
    if (!el) return '';
    if (el.type === 'logo') return el.name || t('layerLogo');
    return el.bind === 'team_name' ? t('layerTeam') : el.bind === 'player_name' ? t('layerPlayer') : el.bind === 'number' ? t('layerNumber') : `"${el.text}"`;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']} testID="screen-studio">
      <View style={styles.toolbar}>
        <Button testID="undo" compact kind="ghost" label={`↶ ${t('undo')}`} onPress={undo} disabled={!canUndo(history)} />
        <Button testID="redo" compact kind="ghost" label={`↷ ${t('redo')}`} onPress={redo} disabled={!canRedo(history)} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          {data.status === 'loading' ? <T variant="caption">{t('refreshing')}</T> : null}
        </View>
        <Button testID="share" compact kind="ghost" label={t('share')} onPress={() => setSharing(true)} />
        <Button testID="order" compact label={t('order')} disabled={!canOrder}
          accessibilityHint={canOrder ? undefined : t('checksBlocked')} onPress={() => router.push('/order')} />
      </View>

      <View style={styles.canvas}>
        <View style={styles.viewRow}>
          <View style={{ width: 120 }}>
            <Segmented testID="view" value={view} onChange={setView}
              options={[{ value: '2d', label: t('tab2d') }, { value: '3d', label: t('tab3d') }]} />
          </View>
          {view === '2d' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginLeft: space(2) }}>
              {panels.map((p) => (
                <Chip key={p.name} testID={`panel-${p.name}`} label={PANEL_LABEL[p.name] ? t(PANEL_LABEL[p.name]) : p.name}
                  selected={p.name === panel?.name} onPress={() => setPanelName(p.name)} />
              ))}
            </ScrollView>
          ) : null}
        </View>

        {!data.panels ? (
          data.status === 'error'
            ? <ErrorState message={errorMessage(t, data.error)} retryLabel={t('retry')} onRetry={data.retry} testID="studio-error" />
            : <Loading label={t('loading')} />
        ) : view === '2d' && panel ? (
          <View style={{ width: panelW, alignSelf: 'center' }}>
            <PanelEditor testID="panel-editor" spec={spec} panel={panel} selectedId={selectedId} onSelect={select}
              onBegin={beginGesture} onLive={live} onCommit={endGesture} onSwipe={swipe} />
            <T variant="caption" style={styles.hint}>
              {panel.editable ? (selectedId ? t('safeArea') : t('selectLayerHint')) : t('sleevesFollow')}
            </T>
          </View>
        ) : (
          <View style={{ width: stageW, alignSelf: 'center' }}>
            <Garment3D garment={spec.garment} panels={print.panels?.panels ?? null} testID="view-3d" />
          </View>
        )}
      </View>

      {data.status === 'error' && data.panels ? (
        <Banner tone="warn" text={isOffline(data.error) ? t('offlineEdits') : errorMessage(t, data.error)}
          action={t('retry')} onAction={data.retry} testID="studio-offline" />
      ) : unsafe.length ? (
        <Banner tone="fail" text={t('unsafeLayer', { name: unsafeName(unsafe[0].id) })} testID="unsafe-banner" />
      ) : null}

      <View style={styles.tabs}>
        <Segmented testID="tab" scroll value={tab} onChange={setTab} options={[
          { value: 'style', label: t('tabStyle') },
          { value: 'text', label: t('tabText') },
          { value: 'logos', label: t('tabLogos') },
          { value: 'refine', label: t('tabRefine') },
          { value: 'checks', label: `${t('tabChecks')}${fresh ? (data.ready ? ' ✓' : ' ✕') : ''}` },
        ]} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.tools} keyboardShouldPersistTaps="handled" testID="studio-tools">
          {tab === 'style' ? <StyleTab {...tools} /> : null}
          {tab === 'text' ? <TextTab {...tools} /> : null}
          {tab === 'logos' ? <LogosTab {...tools} /> : null}
          {tab === 'refine' ? <RefineTab {...tools} /> : null}
          {tab === 'checks' ? <ChecksTab checks={data.checks} ready={data.ready} fresh={fresh} sizes={sizes} onSizes={setSizes} /> : null}
          <T variant="caption" style={{ textAlign: 'center', marginTop: space(2) }}>
            {spec.style_name} · {t(`garment_${spec.garment}`)} · {tMaybe(t, `sport_${spec.sport}`, spec.sport)}
          </T>
        </ScrollView>
      </KeyboardAvoidingView>

      <ShareSheet spec={spec} visible={sharing} onClose={() => setSharing(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, padding: space(4), justifyContent: 'center' },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(2), paddingVertical: space(1),
    backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  canvas: { paddingHorizontal: space(4), paddingTop: space(2) },
  viewRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space(2) },
  hint: { textAlign: 'center', marginTop: space(1) },
  tabs: { paddingHorizontal: space(4), paddingTop: space(2) },
  tools: { padding: space(4), paddingBottom: space(16) },
});
