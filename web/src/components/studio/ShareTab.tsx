'use client';
import { useEffect, useState } from 'react';
import { Banner, Button, SvgImg, TextField } from '@/components/ui';
import { errorMessage, tMaybe } from '@/i18n';
import { useT } from '@/i18n/provider';
import { api } from '@/lib/api/endpoints';
import type { DesignSpec } from '@/lib/api/types';
import { flow } from '@/lib/flow';
import { copyText, downloadBlob, slug, svgToPng } from '@/lib/share';
import { describeSpec } from '@/lib/spec';
import s from './studio.module.css';

export function ShareTab({ spec }: { spec: DesignSpec }) {
  const t = useT();
  const [mock, setMock] = useState<string | null>(null);
  const [busy, setBusy] = useState<'png' | 'link' | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'pass' | 'fail'; text: string } | null>(null);

  useEffect(() => {
    const c = new AbortController();
    const timer = setTimeout(() => {
      api.render(spec, [], c.signal).then((r) => setMock(r.mockup_svg)).catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [spec]);

  const png = async () => {
    setBusy('png');
    setNote(null);
    try {
      const svg = mock ?? (await api.render(spec)).mockup_svg;
      downloadBlob(await svgToPng(svg), `urjersey-${slug(spec.style_name)}.png`);
      setNote({ tone: 'pass', text: t('pngSaved') });
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async () => {
    setBusy('link');
    setNote(null);
    try {
      const id = flow.ensureDesignId();
      // Stores the current edit on the server (restoring the design if this server never saw it).
      await api.feedback(id, { edited_spec: spec, spec });
      const url = `${window.location.origin}/d/${encodeURIComponent(id)}`;
      setLink(url);
      const ok = await copyText(url);
      setNote(ok ? { tone: 'pass', text: t('linkCopied') } : null);
    } catch (e) {
      setNote({ tone: 'fail', text: errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const text = describeSpec(spec, {
    garment: t(`garment_${spec.garment}`), sport: tMaybe(t, `sport_${spec.sport}`, spec.sport),
    pattern: tMaybe(t, `pattern_${spec.pattern.type}`, spec.pattern.type),
    coverage: tMaybe(t, `coverage_${spec.pattern.coverage}`, spec.pattern.coverage),
    font: tMaybe(t, `font_${spec.typography.font}`, spec.typography.font),
  });

  return (
    <>
      <section className={s.section} aria-labelledby="sh-title">
        <h3 id="sh-title">{t('shareTitle')}</h3>
        <div style={{ background: '#eef1f7', borderRadius: 12, padding: 10, marginBottom: 12 }}>
          {mock ? <SvgImg svg={mock} alt={spec.style_name} testId="share-mockup" /> : <div style={{ aspectRatio: '1' }} />}
        </div>
        <div className="row">
          <Button onClick={png} busy={busy === 'png'} testId="download-png">{t('downloadPng')}</Button>
          <Button kind="secondary" onClick={shareLink} busy={busy === 'link'} testId="copy-link">{t('copyLink')}</Button>
        </div>
        {link ? <div style={{ marginTop: 10 }}><TextField label={t('shareLinkLabel')} value={link} readOnly testId="share-link"
          onFocus={(e) => e.currentTarget.select()} /></div> : null}
        {note ? <div style={{ marginTop: 10 }}><Banner tone={note.tone} live testId="share-note">{note.text}</Banner></div> : null}
        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>{t('shareLinkHint')}</p>
      </section>
      <section className={s.section} aria-labelledby="sh-text">
        <h3 id="sh-text">{t('shareText')}</h3>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.82rem', background: '#f6f8fc', padding: 10, borderRadius: 8, margin: '0 0 10px' }}>{text}</pre>
        <Button kind="secondary" size="sm" onClick={async () => setNote((await copyText(text)) ? { tone: 'pass', text: t('copied') } : null)}>{t('copy')}</Button>
      </section>
    </>
  );
}
