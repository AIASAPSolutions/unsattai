'use client';
import { useMemo, useRef, useState } from 'react';
import { DesignCard } from '@/components/design/DesignCard';
import s from '@/components/design/design.module.css';
import { useMeta } from '@/components/providers/data';
import { Banner, Button, Card, Chip, Chips } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import { GARMENTS, type FromImageResponse, type PictureWarning } from '@/lib/api/types';
import { flow, useFlow } from '@/lib/flow';
import { buildOutsidePrompt } from '@/lib/outsidePrompt';
import { preparePicture } from '@/lib/picture';

export function PictureClient() {
  const { t, lang } = useI18n();
  const brief = useFlow((st) => st.brief);
  const confirmed = useFlow((st) => st.confirmed);
  const designs = useFlow((st) => st.designs);
  const { meta } = useMeta();
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [picture, setPicture] = useState<{ dataUrl: string; aspect: number } | null>(null);
  const [busy, setBusy] = useState<'pick' | 'recognise' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FromImageResponse | null>(null);

  const prompt = useMemo(() => buildOutsidePrompt({
    garment: brief.garment, idea: brief.prompt, sport: confirmed?.sport ?? null, colors: brief.locked_colors,
    colorNames: meta?.colors,
  }), [brief.garment, brief.prompt, brief.locked_colors, confirmed?.sport, meta?.colors]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(t('shareFailed'));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy('pick');
    try {
      setPicture(await preparePicture(file));
      setResult(null);
    } catch (e) {
      setError(e instanceof Error && e.message === 'type' ? t('pictureWrongType') : errorMessage(t, e));
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
        image: picture.dataUrl, garment: brief.garment, sport: confirmed?.sport ?? null, team_name: brief.team_name,
        player_name: brief.player_name, number: brief.number, language: lang,
      });
      flow.showDesigns({ ...res, requested_provider: 'image', fallback_reason: null, seed: 0 });
      setResult(res);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const warning = (w: PictureWarning) => tMaybe(t, `warn_${w}`, w).replace('{text}', result?.recognised.text_seen.join(', ') ?? '');
  const shown = result ? designs.filter((d) => result.designs.some((r) => r.id === d.id)) : [];

  return (
    <div className="container page" data-testid="screen-picture">
      <h1>{t('pictureTitle')}</h1>
      <p className="muted">{t('pictureEntryHint')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginTop: 16 }}>
        <Card title={t('promptStep')} sub={t('promptStepHint')}>
          <p className="small muted" style={{ marginBottom: 6 }}>{t('garmentLabel')}</p>
          <Chips label={t('garmentLabel')}>
            {GARMENTS.map((g) => (
              <Chip key={g} selected={brief.garment === g} onClick={() => flow.setBrief({ garment: g })}>{t(`garment_${g}`)}</Chip>
            ))}
          </Chips>
          <div style={{ height: 12 }} />
          <div className={s.promptBox} data-testid="outside-prompt" aria-label={t('promptStep')}>{prompt}</div>
          <div className="row">
            <Button onClick={copy} testId="copy-prompt">{copied ? `✓ ${t('copied')}` : t('copyPrompt')}</Button>
            <Button kind="ghost" href="/design">{t('editBrief')}</Button>
          </div>
          <span role="status" className="visually-hidden">{copied ? t('copied') : ''}</span>
        </Card>

        <Card title={t('uploadStep')} sub={t('uploadStepHint')}>
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture.dataUrl} alt={t('uploadStep')} className={s.preview} data-testid="picked-picture" />
          ) : null}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="picture-input"
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          <div className="row">
            <Button kind={picture ? 'secondary' : 'primary'} busy={busy === 'pick'} disabled={busy !== null}
              onClick={() => fileRef.current?.click()} testId="choose-picture">
              {picture ? t('changePicture') : t('choosePicture')}
            </Button>
            {picture ? <Button busy={busy === 'recognise'} disabled={busy !== null} onClick={recognise} testId="recognise">{t('recognise')}</Button> : null}
          </div>
        </Card>
      </div>

      {error ? <div style={{ marginTop: 16 }}><Banner tone="fail" testId="picture-error">{error}</Banner></div> : null}

      {result ? (
        <section style={{ marginTop: 24 }} className="stack" data-testid="picture-result" aria-labelledby="recognised-title">
          <Card title={<span id="recognised-title">{t('recognisedTitle')}</span>}>
            <p style={{ fontWeight: 600 }}>{result.source === 'ai' ? t('recognisedByAi') : t('recognisedByPixels')}</p>
            <div className="row" style={{ marginBottom: 8 }}>
              {result.colors.map((c) => (
                <span key={c.hex} className="row small" style={{ gap: 6 }}>
                  <span className={s.dot} style={{ background: c.hex }} aria-hidden />{c.hex} · {Math.round(c.share * 100)}%
                </span>
              ))}
            </div>
            <p className="small muted">
              {tMaybe(t, `pattern_${result.recognised.pattern}`, result.recognised.pattern)} · {t('coverageLabel')}: {tMaybe(t, `coverage_${result.recognised.coverage}`, result.recognised.coverage)}
            </p>
            {result.recognised.notes ? <p>{result.recognised.notes}</p> : null}
            {result.ai.enabled ? <p className="small">✨ {t('aiLeft', { n: result.ai.remaining, limit: result.ai.limit })}</p> : null}
          </Card>
          {result.warnings.map((w) => <Banner key={w} tone="warn" testId={`warn-${w}`}>{warning(w)}</Banner>)}
          <Banner tone="info">{t('pictureRebuilt')}</Banner>
          <div className={s.designGrid}>
            {shown.map((d, i) => <DesignCard key={d.id} d={d} index={i} />)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
