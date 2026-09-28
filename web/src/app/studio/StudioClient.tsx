'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AskTab } from '@/components/studio/AskTab';
import { ChecksTab } from '@/components/studio/ChecksTab';
import { Garment3D } from '@/components/studio/Garment3D';
import { LogosTab } from '@/components/studio/LogosTab';
import { PanelEditor, type EditorLabels } from '@/components/studio/PanelEditor';
import { ShareTab } from '@/components/studio/ShareTab';
import { SaveDesignModal, TeamCollectionModal } from '@/components/studio/StudioModals';
import { StyleTab } from '@/components/studio/StyleTab';
import { layerLabel, TextTab } from '@/components/studio/TextTab';
import s from '@/components/studio/studio.module.css';
import type { StudioTools } from '@/components/studio/tools';
import { isOffline, usePrintPanels, useStudioData } from '@/components/studio/useStudioData';
import { Banner, Button, Chip, Chips, Empty, ErrorState, Loading, Tabs } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useT } from '@/i18n/provider';
import type { Element, LayerPanel, Size } from '@/lib/api/types';
import { currentSpec, flow, flowStore, useFlow } from '@/lib/flow';
import { isSafe } from '@/lib/geometry';
import { canRedo, canUndo } from '@/lib/history';
import { materializeLayers, removeElement, usesLayers } from '@/lib/spec';

type Tab = 'style' | 'text' | 'logos' | 'ask' | 'checks' | 'share';

const PANEL_LABEL: Record<string, 'front' | 'back2' | 'sleeveLeft' | 'sleeveRight'> = {
  front: 'front', back: 'back2', sleeve_left: 'sleeveLeft', sleeve_right: 'sleeveRight',
};

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

export function StudioClient() {
  const t = useT();
  const router = useRouter();
  const spec = useFlow(currentSpec);
  const history = useFlow((st) => st.history);
  const designId = useFlow((st) => st.designId);

  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [panelName, setPanelName] = useState('front');
  const [pickedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('style');
  const [sizes, setSizes] = useState<Size[]>(['M']);
  const [modal, setModal] = useState<'save' | 'team' | null>(null);
  const [no3d, setNo3d] = useState(false);

  const data = useStudioData(spec, sizes);
  const print = usePrintPanels(spec, view === '3d');

  // First answer from the server: turn the classic name/number placement into editable
  // layers. `live` so this is not an undo step of its own.
  const materialized = useRef<string | null>(null);
  useEffect(() => {
    if (!spec || !data.defaults || data.checkedSpec !== spec) return;
    const key = designId ?? 'none';
    if (materialized.current === key) return;
    materialized.current = key;
    if (!usesLayers(spec)) flow.live(materializeLayers(spec, data.defaults));
  }, [spec, data.defaults, data.checkedSpec, designId]);

  // Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) anywhere in the studio except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        flow.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        flow.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A selection whose layer was undone or deleted simply disappears.
  const selectedId = pickedId && spec?.elements.some((e) => e.id === pickedId) ? pickedId : null;
  const panels = data.panels?.panels ?? [];
  const panel = panels.find((p) => p.name === panelName) ?? panels[0] ?? null;
  const side: LayerPanel = panel?.side ?? 'front';

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const el = id ? currentSpec(flowStore.get())?.elements.find((e) => e.id === id) : null;
    if (el && el.panel !== panel?.side) {
      setPanelName(el.panel);
      setView('2d');
    }
  }, [panel?.side]);


  const fresh = !!spec && data.checkedSpec === spec && data.status !== 'error';
  const canOrder = fresh && data.ready === true;
  const unsafe = useMemo(() => spec?.elements.filter((e) => !isSafe(spec, e)) ?? [], [spec]);
  const on3dUnavailable = useCallback(() => setNo3d(true), []);

  if (!spec || !history) {
    return (
      <div className="container page">
        <Empty title={t('noStudioDesign')}><Button href="/design">{t('newDesign')}</Button></Empty>
      </div>
    );
  }

  const layerName = (el: Element) => (el.type === 'logo' ? el.name || t('layerLogo') : el.bind ? layerLabel(t, el) : `“${el.text}”`);
  const labels: EditorLabels = { canvas: t('editorLabel'), layerName, resize: t('resizeHandle'), rotate: t('rotateHandle') };
  const tools: StudioTools = { spec, selectedId, select, side, sizes };

  return (
    <div className={s.shell} data-testid="screen-studio">
      <div className={s.toolbar} role="toolbar" aria-label={t('studioTitle')}>
        <span className={s.toolbarTitle} title={spec.style_name}>{spec.style_name}</span>
        <Button kind="ghost" size="sm" onClick={flow.undo} disabled={!canUndo(history)} testId="undo" title="Ctrl+Z">↶ {t('undo')}</Button>
        <Button kind="ghost" size="sm" onClick={flow.redo} disabled={!canRedo(history)} testId="redo" title="Ctrl+Shift+Z">↷ {t('redo')}</Button>
        <span className={s.status} role="status" aria-live="polite" data-testid="studio-status">
          {data.status === 'loading' ? t('refreshing') : fresh ? (data.ready ? `✓ ${t('checksOk')}` : `✕ ${t('checksNotOk')}`) : ''}
        </span>
        <span className={s.grow} />
        <Button kind="secondary" size="sm" onClick={() => setModal('save')} testId="save-design">{t('saveDesign')}</Button>
        <Button kind="secondary" size="sm" onClick={() => setModal('team')} testId="team-order">{t('teamOrder')}</Button>
        <Button kind="accent" disabled={!canOrder} testId="order" title={canOrder ? undefined : t('orderBlockedHint')}
          onClick={() => router.push('/checkout')}>{t('orderNow')} →</Button>
      </div>

      <div className={s.body}>
        <div className={s.canvasCol}>
          <div className={s.viewRow}>
            <Tabs label={t('studioTitle')} value={view} onChange={setView} testId="view"
              options={[{ value: '2d', label: t('tab2d') }, { value: '3d', label: t('tab3d') }]} />
            {view === '2d' ? (
              <Chips label={t('panelSide')}>
                {panels.map((p) => (
                  <Chip key={p.name} selected={p.name === panel?.name} testId={`panel-${p.name}`} onClick={() => setPanelName(p.name)}>
                    {PANEL_LABEL[p.name] ? t(PANEL_LABEL[p.name]) : p.name}
                  </Chip>
                ))}
              </Chips>
            ) : null}
          </div>

          {!data.panels ? (
            data.status === 'error'
              ? <ErrorState message={errorMessage(t, data.error)} retryLabel={t('retry')} onRetry={data.retry} testId="studio-error" />
              : <Loading label={t('loading')} />
          ) : view === '2d' && panel ? (
            <>
              <div className={s.stageWrap}>
                <PanelEditor spec={spec} panel={panel} selectedId={selectedId} onSelect={select} testId="panel-editor"
                  onBegin={flow.beginGesture} onLive={flow.live} onCommit={flow.endGesture} labels={labels}
                  onDelete={(id) => { flow.edit(removeElement(spec, id)); setSelectedId(null); }} />
              </div>
              <p className={s.hint}>{panel.editable ? (selectedId ? t('safeArea') : t('selectLayerHint')) : t('sleevesFollow')}</p>
              <p className={s.hint} style={{ fontSize: '0.78rem' }}>{t('keyboardHelp')}</p>
            </>
          ) : (
            <div className={s.stageWrap}>
              <div style={{ width: '100%', maxWidth: 560 }}>
                <Garment3D garment={spec.garment} panels={print.panels?.panels ?? null} onUnavailable={on3dUnavailable} />
                {no3d && panel ? <Button kind="secondary" onClick={() => setView('2d')}>{t('tab2d')}</Button> : null}
              </div>
            </div>
          )}

          {data.status === 'error' && data.panels ? (
            <Banner tone="warn" action={t('retry')} onAction={data.retry} testId="studio-offline">
              {isOffline(data.error) ? t('offlineEdits') : errorMessage(t, data.error)}
            </Banner>
          ) : unsafe.length ? (
            <Banner tone="fail" testId="unsafe-banner">{t('unsafeLayer', { name: layerName(unsafe[0]) })}</Banner>
          ) : null}
          <p className={s.hint}>
            {spec.style_name} · {t(`garment_${spec.garment}`)} · {tMaybe(t, `sport_${spec.sport}`, spec.sport)}
          </p>
        </div>

        <aside className={s.toolsCol} aria-label={t('studioTitle')}>
          <div className={s.toolsHead}>
            <Tabs label={t('studioTitle')} value={tab} onChange={setTab} testId="tab" options={[
              { value: 'style', label: t('tabStyle') },
              { value: 'text', label: t('tabText') },
              { value: 'logos', label: t('tabLogos') },
              { value: 'ask', label: t('tabRefine') },
              { value: 'checks', label: `${t('tabChecks')}${fresh ? (data.ready ? ' ✓' : ' ✕') : ''}` },
              { value: 'share', label: t('tabShare') },
            ]} />
          </div>
          <div className={s.toolsBody} role="tabpanel">
            {tab === 'style' ? <StyleTab {...tools} /> : null}
            {tab === 'text' ? <TextTab {...tools} /> : null}
            {tab === 'logos' ? <LogosTab {...tools} /> : null}
            {tab === 'ask' ? <AskTab /> : null}
            {tab === 'checks' ? <ChecksTab checks={data.checks} ready={data.ready} fresh={fresh} sizes={sizes} onSizes={setSizes} /> : null}
            {tab === 'share' ? <ShareTab spec={spec} /> : null}
          </div>
        </aside>
      </div>

      <SaveDesignModal open={modal === 'save'} onClose={() => setModal(null)} spec={spec} />
      <TeamCollectionModal open={modal === 'team'} onClose={() => setModal(null)} spec={spec} />
    </div>
  );
}
