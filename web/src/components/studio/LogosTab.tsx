'use client';
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Loading, SvgImg, cx } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import { MAX_LOGO_BYTES, MAX_LOGOS, type BackgroundRemoval, type LogoElement, type LogoSuggestion } from '@/lib/api/types';
import { dpiLevel, effectiveDpi, maxWidthForDpi, worstSize } from '@/lib/dpi';
import { flow } from '@/lib/flow';
import { zoneCenter } from '@/lib/geometry';
import { fileToBase64, formatBytes, inspectImage } from '@/lib/image';
import { addElement, canAddLogo, logoCount, placeLogo, removeElement, updateElement } from '@/lib/spec';
import { svgAspect } from '@/lib/svg';
import { Slider } from './Slider';
import s from './studio.module.css';
import { latestSpec, type StudioTools } from './tools';

// Original and cleaned versions of a logo after background removal. Kept out of the
// spec (and the saved draft) so orders never carry both copies.
const alternates = new Map<string, { original: string; result: BackgroundRemoval }>();

class LogoProblem extends Error {}

export function LogosTab({ spec, selectedId, select, side, sizes }: StudioTools) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sugg, setSugg] = useState<{ key: string; logos: LogoSuggestion[]; next: number | null }>({ key: '', logos: [], next: 0 });
  const [busy, setBusy] = useState<'suggest' | 'upload' | 'bg' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, bump] = useState(0);

  const logos = spec.elements.filter((e): e is LogoElement => e.type === 'logo');
  const full = !canAddLogo(spec);
  const size = worstSize(sizes);
  const suggestKey = `${spec.typography.team_name}|${spec.sport}|${spec.palette.primary}|${spec.palette.secondary}|${spec.palette.accent}`;

  const fetchSuggestions = (offset: number) => {
    const cur = latestSpec() ?? spec;
    return api.suggestLogos({
      team_name: cur.typography.team_name, sport: cur.sport, prompt: `${cur.style_name} ${cur.rationale}`.slice(0, 300),
      palette: cur.palette, offset,
    });
  };

  // First page of ideas whenever the team name, sport or colours change (8 at a time).
  useEffect(() => {
    let live = true;
    fetchSuggestions(0)
      .then((res) => live && setSugg({ key: suggestKey, logos: res.logos, next: res.next_offset }))
      .catch((e) => live && (setSugg({ key: suggestKey, logos: [], next: 0 }), setError(errorMessage(t, e))));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestKey]);

  const loadMore = async (offset: number) => {
    setBusy('suggest');
    setError(null);
    try {
      const res = await fetchSuggestions(offset);
      setSugg((x) => ({ key: x.key, logos: [...x.logos, ...res.logos], next: res.next_offset }));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };
  const suggestions = sugg.key === suggestKey ? sugg.logos : [];
  const next = sugg.key === suggestKey ? sugg.next : null;
  const loadingIdeas = sugg.key !== suggestKey || busy === 'suggest';

  const add = (logo: Omit<LogoElement, 'id' | 'panel' | 'x' | 'y' | 'rotation'>) => {
    const cur = latestSpec() ?? spec;
    if (!canAddLogo(cur)) {
      setError(t('logoLimit'));
      return;
    }
    const el = placeLogo(cur, logo, side);
    flow.edit(addElement(cur, el));
    select(el.id);
  };

  const addSuggested = (x: LogoSuggestion) => add({
    type: 'logo', src: x.data_url, width: 80, aspect: svgAspect(x.svg), kind: 'vector', source: 'suggested', name: x.name,
    pixel_width: null, pixel_height: null,
  });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy('upload');
    try {
      if (file.size > MAX_LOGO_BYTES) throw new LogoProblem(t('logoTooBig', { size: formatBytes(file.size) }));
      const info = inspectImage(await fileToBase64(file));
      if (info === 'type') throw new LogoProblem(t('logoWrongType'));
      if (info === 'size') throw new LogoProblem(t('logoTooBig', { size: formatBytes(file.size) }));
      const vector = info.mime === 'image/svg+xml';
      // Start at a width that still prints at 300 DPI in the largest checked size, within 40-120 mm.
      const width = vector || !info.width ? 90 : Math.max(40, Math.min(120, maxWidthForDpi(info.width, size)));
      add({
        type: 'logo', src: info.dataUrl, width, aspect: info.aspect, kind: vector ? 'vector' : 'raster', source: 'upload',
        name: file.name.slice(0, 80), pixel_width: info.width, pixel_height: info.height,
      });
    } catch (e) {
      setError(e instanceof LogoProblem ? e.message : errorMessage(t, e));
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

  const chooseVersion = (logo: LogoElement, src: string) => {
    const info = inspectImage(src);
    if (info === 'size') {
      setError(t('logoTooBig', { size: formatBytes(src.length * 0.75) }));
      return;
    }
    flow.edit(updateElement(latestSpec() ?? spec, logo.id, { src }));
  };

  const patch = (p: Partial<LogoElement>, liveOnly = false) => {
    const cur = latestSpec();
    if (!cur || !selected) return;
    (liveOnly ? flow.live : flow.edit)(updateElement(cur, selected.id, p));
  };

  const dpiNote = (l: LogoElement): { color: string; text: string } | null => {
    const level = dpiLevel(l, size);
    if (level === 'vector') return { color: 'var(--pass)', text: t('logoVector') };
    if (level === 'unknown') return null;
    const dpi = Math.round(effectiveDpi(l, size) ?? 0);
    if (level === 'good') return { color: 'var(--pass)', text: t('logoDpi', { dpi, size }) };
    if (level === 'low') return { color: 'var(--warn)', text: `${t('logoDpi', { dpi, size })}. ${t('logoDpiLow', { size })}` };
    return { color: 'var(--fail)', text: `${t('logoDpi', { dpi, size })}. ${t('logoDpiBad')}` };
  };

  return (
    <>
      {error ? <Banner tone="fail" testId="logo-error">{error}</Banner> : null}

      <section className={s.section} aria-labelledby="lg-on">
        <h3 id="lg-on">{t('logosOnDesign')} ({logoCount(spec)}/{MAX_LOGOS})</h3>
        {logos.length === 0 ? <p className="small muted">{t('noLogos')}</p> : null}
        {logos.map((l) => {
          const note = dpiNote(l);
          const on = l.id === selectedId;
          return (
            <button key={l.id} type="button" className={cx(s.layerItem, on && s.layerItemOn)} aria-pressed={on}
              data-testid={`logo-item-${l.source}`} onClick={() => select(on ? null : l.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.src} alt="" className={s.thumb} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong className="small" style={{ display: 'block' }}>{l.name || t('layerLogo')} · {l.panel === 'front' ? t('front') : t('back2')}</strong>
                {note ? <span className="small" style={{ color: note.color }} data-testid="logo-dpi">{note.text}</span> : null}
              </span>
            </button>
          );
        })}

        {selected ? (
          <div data-testid="logo-editor" style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
            <Slider label={t('size')} value={selected.width} min={10} max={400} step={1} testId="logo-width"
              format={(v) => `${Math.round(v)} mm`} onLive={(width) => patch({ width }, true)} />
            <Slider label={t('rotate')} value={selected.rotation} min={-180} max={180} step={1} testId="logo-rotation"
              format={(v) => `${Math.round(v)}°`} onLive={(rotation) => patch({ rotation }, true)} />
            {selected.kind === 'raster' ? (
              <div>
                <Button kind="secondary" size="sm" busy={busy === 'bg'} onClick={() => removeBg(selected)} testId="remove-bg">{t('removeBg')}</Button>
                {alt ? (
                  <div style={{ marginTop: 8 }}>
                    <p className="small" data-testid="bg-result">{alt.result.applied
                      ? t('bgRemoved', { pct: Math.round(alt.result.removed_ratio * 100) })
                      : t('bgNotRemoved', { reason: alt.result.reason ?? '' })}</p>
                    {alt.result.applied ? (
                      <div className={s.compare}>
                        <div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={alt.original} alt={t('useOriginal')} className={s.checker} />
                          <Button size="sm" kind={selected.src === alt.original ? 'primary' : 'secondary'} onClick={() => chooseVersion(selected, alt.original)}
                            aria-pressed={selected.src === alt.original}>{t('useOriginal')}</Button>
                        </div>
                        <div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={alt.result.data_url} alt={t('useCleaned')} className={s.checker} />
                          <Button size="sm" testId="use-cleaned" kind={selected.src === alt.result.data_url ? 'primary' : 'secondary'}
                            aria-pressed={selected.src === alt.result.data_url} onClick={() => chooseVersion(selected, alt.result.data_url)}>{t('useCleaned')}</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="row" style={{ marginTop: 12 }}>
              <Button kind="secondary" size="sm" onClick={() => {
                const other = selected.panel === 'front' ? 'back' : 'front';
                const [x, y] = zoneCenter(spec.garment, other);
                patch({ panel: other, x, y });
              }}>⇄ {t('bringToFront')}</Button>
              <Button kind="danger" size="sm" onClick={() => {
                alternates.delete(selected.id);
                flow.edit(removeElement(latestSpec() ?? spec, selected.id));
                select(null);
              }}>{t('deleteLayer')}</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className={s.section} aria-labelledby="lg-up">
        <h3 id="lg-up">{t('uploadLogo')}</h3>
        {full ? <p className="small" style={{ color: 'var(--warn)' }}>{t('logoLimit')}</p> : null}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" hidden data-testid="logo-input"
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <Button kind="secondary" disabled={full || busy !== null} busy={busy === 'upload'} testId="upload-logo"
          onClick={() => fileRef.current?.click()}>{t('fromFiles')}</Button>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>{t('uploadHint')}</p>
      </section>

      <section className={s.section} aria-labelledby="lg-ideas">
        <h3 id="lg-ideas">{t('logoSuggestions')}</h3>
        <div className={s.suggestions}>
          {suggestions.map((x, i) => (
            <button key={x.id} type="button" className={s.suggestion} disabled={full} data-testid={`suggestion-${i}`}
              aria-label={`${t('add')} ${x.name}`} onClick={() => addSuggested(x)}>
              <SvgImg svg={x.svg} alt="" />
            </button>
          ))}
        </div>
        {loadingIdeas ? <Loading label={t('loading')} /> : null}
        {next !== null && !loadingIdeas ? (
          <div style={{ marginTop: 10 }}>
            <Button kind="secondary" size="sm" onClick={() => loadMore(next)} testId="more-logos">{t('loadMore')}</Button>
          </div>
        ) : null}
      </section>
    </>
  );
}
