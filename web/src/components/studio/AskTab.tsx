'use client';
import { useEffect, useState } from 'react';
import { Banner, Button, TextArea } from '@/components/ui';
import { errorMessage } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api/endpoints';
import type { AiAllowance, RefineChange } from '@/lib/api/types';
import { flow } from '@/lib/flow';
import s from './studio.module.css';
import { latestSpec } from './tools';

const LIMIT = 300;

export function AskTab() {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'pass' | 'info' | 'fail'; text: string; ai: boolean; changes: RefineChange[] } | null>(null);
  const [ai, setAi] = useState<AiAllowance | null>(null);

  // How many AI edits are left today (per device). Servers without AI edits just show nothing.
  useEffect(() => {
    let live = true;
    api.aiAllowance().then((a) => live && setAi(a)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const apply = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const spec = latestSpec();
    const instruction = text.trim();
    if (!spec || !instruction) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api.refine(spec, instruction, lang);
      if (res.ai) setAi(res.ai);
      const byAi = res.source === 'ai';
      if (res.changes.length) {
        flow.edit(res.spec);
        const summary = byAi && res.message ? res.message : res.changes.map((c) => c.message).join('; ');
        setResult({ tone: 'pass', text: t('refineDone', { summary }), ai: byAi, changes: res.changes });
        setText('');
      } else {
        setResult({ tone: 'info', text: `${t('refineNothing')} ${res.message}`.trim(), ai: byAi, changes: [] });
      }
    } catch (err) {
      const quota = err instanceof ApiError && err.kind === 'quota';
      const allowance = quota ? (err.data as { ai?: AiAllowance } | null)?.ai : null;
      if (allowance) setAi(allowance);
      setResult({ tone: quota ? 'info' : 'fail', text: errorMessage(t, err), ai: false, changes: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className={s.section} onSubmit={apply} aria-labelledby="ask-title">
        <h3 id="ask-title">{t('refineTitle')}</h3>
        <TextArea label={t('refineTitle')} value={text} maxLength={LIMIT} rows={3} placeholder={t('refinePlaceholder')}
          counter={t('charsLeft', { n: LIMIT - text.length })} testId="refine-input" onValue={setText}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void apply(); }} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{t('refineExamples')}</span>
          <Button type="submit" busy={busy} disabled={!text.trim() || busy} testId="refine-apply">{t('refineCta')}</Button>
        </div>
        {ai?.enabled ? (
          <div style={{ marginTop: 12 }}>
            <p className="small muted" style={{ marginBottom: 4 }}>{t('aiHint')}</p>
            <p className="small" style={{ fontWeight: 700, margin: 0 }} data-testid="ai-left">
              <span className={s.aiBadge}>✨ {t('refineByAi')}</span>{' '}{t('aiLeft', { n: ai.remaining, limit: ai.limit })}
            </p>
          </div>
        ) : null}
      </form>
      {result ? (
        <Banner tone={result.tone} testId="refine-result" live>
          {result.ai ? <><span className={s.aiBadge} data-testid="ai-badge">✨ {t('refineByAi')}</span>{' '}</> : null}
          {result.text}
          {result.changes.length > 1 ? (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{result.changes.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
          ) : null}
        </Banner>
      ) : null}
    </>
  );
}
