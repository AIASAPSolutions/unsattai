'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ColorPickerModal } from '@/components/design/ColorPicker';
import s from '@/components/design/design.module.css';
import { FlowSteps } from '@/components/design/FlowSteps';
import { Banner, Button, Card, Chip, Chips, Empty, TextArea, TextField } from '@/components/ui';
import { errorMessage, tMaybe, type T } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { GARMENTS, MAX_LOCKED_COLORS, PROMPT_LIMIT, SPORTS, TEXT_LIMITS, type Question } from '@/lib/api/types';
import { canGenerate, flow, unansweredQuestions, useFlow } from '@/lib/flow';
import { checkNumber, checkPlayer, checkPrompt, checkTeam, cleanNumber } from '@/lib/validation';

// The same questions and wording as the app's confirm screen (app/src/app/confirm.tsx).
function questionText(t: T, q: Question): string {
  const [a, b] = q.options.map((o) => o.value);
  const label = (v: string) => (q.field === 'sport' ? tMaybe(t, `sport_${v}`, v) : q.field === 'garment' ? tMaybe(t, `garment_${v}`, v) : v);
  switch (q.id) {
    case 'team_name_conflict': return t('conflictTeam', { a, b });
    case 'player_name_conflict': return t('conflictPlayer', { a, b });
    case 'number_conflict': return t('conflictNumber', { a, b });
    case 'sport_conflict': return t('conflictSport', { a: label(a), b: label(b) });
    case 'garment_conflict': return t('conflictGarment', { a: label(a), b: label(b) });
    case 'sport_missing': return t('chooseSport');
    default: return q.message;
  }
}

export function ConfirmClient() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const understanding = useFlow((st) => st.understanding);
  const confirmed = useFlow((st) => st.confirmed);
  const answers = useFlow((st) => st.answers);
  const ready = useFlow(canGenerate);
  const [busy, setBusy] = useState<'generate' | 'recheck' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);

  if (!understanding || !confirmed) {
    return (
      <div className="container page">
        <Empty title={t('noDesigns')}><Button href="/design">{t('describeTitle')}</Button></Empty>
      </div>
    );
  }
  const open = unansweredQuestions(understanding, answers);

  const recheck = async () => {
    setBusy('recheck');
    setError(null);
    try {
      flow.setBrief({
        prompt: confirmed.prompt, garment: confirmed.garment, team_name: confirmed.team_name,
        player_name: confirmed.player_name, number: confirmed.number, locked_colors: confirmed.locked_colors,
      });
      await flow.understand(lang);
      setPromptDirty(false);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(null);
    }
  };

  const go = async () => {
    setBusy('generate');
    setError(null);
    try {
      await flow.generate(lang);
      router.push('/design/designs');
    } catch (e) {
      setError(errorMessage(t, e));
      setBusy(null);
    }
  };

  const issues = {
    prompt: checkPrompt(confirmed.prompt), team: checkTeam(confirmed.team_name),
    player: checkPlayer(confirmed.player_name), number: checkNumber(confirmed.number),
  };
  const fieldsOk = !issues.prompt && !issues.team && !issues.player && !issues.number;
  const sourceLabel = (src: string | null) => (src === 'prompt' ? t('fromBrief') : src === 'form' ? t('fromForm') : '');
  const locked = confirmed.locked_colors;
  const toggleLock = (hex: string) => {
    const next = locked.includes(hex) ? locked.filter((c) => c !== hex) : [...locked, hex].slice(0, MAX_LOCKED_COLORS);
    flow.editConfirmed({ locked_colors: next });
  };
  const colours = [...new Set([...understanding.colors.map((c) => c.hex), ...locked])];

  return (
    <div className="container page" data-testid="screen-confirm">
      <FlowSteps current={1} />
      <div className={s.layout}>
        <div className="stack">
          <h1>{t('weUnderstood')}</h1>

          {open.map((q) => (
            <Card key={q.id} title={t('whichIsCorrect')} className={s.question} testId={`question-${q.id}`}>
              <p>{questionText(t, q)}</p>
              <Chips label={questionText(t, q)}>
                {q.options.map((o) => (
                  <Chip key={`${q.id}-${o.value}`} testId={`answer-${q.id}-${o.value}`} onClick={() => flow.answer(q, o.value)}>
                    {(q.field === 'sport' ? tMaybe(t, `sport_${o.value}`, o.value) : q.field === 'garment'
                      ? tMaybe(t, `garment_${o.value}`, o.value) : `“${o.value}”`)
                      + (o.source === 'prompt' || o.source === 'form' ? ` · ${sourceLabel(o.source)}` : '')}
                  </Chip>
                ))}
              </Chips>
            </Card>
          ))}

          <Card title={t('recognizedPrompt')}>
            <TextArea label={t('briefLabel')} value={confirmed.prompt} maxLength={PROMPT_LIMIT} rows={3} testId="confirm-prompt"
              onValue={(prompt) => { flow.editConfirmed({ prompt }); setPromptDirty(true); }}
              error={issues.prompt ? (issues.prompt === 'tooLong' ? t('promptTooLong') : t('promptTooShort')) : null} />
            {promptDirty ? <Button kind="secondary" busy={busy === 'recheck'} onClick={recheck} testId="recheck">{t('understandCta')}</Button> : null}
          </Card>

          <Card title={t('sport')}>
            <Chips label={t('sport')}>
              {SPORTS.map((sp) => (
                <Chip key={sp} testId={`sport-${sp}`} selected={confirmed.sport === sp} onClick={() => flow.editConfirmed({ sport: sp })}>
                  {t(`sport_${sp}`)}
                </Chip>
              ))}
            </Chips>
          </Card>

          <Card title={t('garment')}>
            <Chips label={t('garment')}>
              {GARMENTS.map((g) => (
                <Chip key={g} testId={`confirm-garment-${g}`} selected={confirmed.garment === g} onClick={() => flow.editConfirmed({ garment: g })}>
                  {t(`garment_${g}`)}
                </Chip>
              ))}
            </Chips>
          </Card>

          <Card title={t('colours')} sub={t('lockedColorsHint')}>
            {colours.length === 0 ? <p className="muted">{t('noneDetected')}</p> : null}
            <div className={s.lockedRow}>
              {colours.map((hex) => {
                const c = understanding.colors.find((x) => x.hex === hex);
                const on = locked.includes(hex);
                return (
                  <Chip key={hex} selected={on} onClick={() => toggleLock(hex)} title={hex}>
                    <span className={s.dot} style={{ background: hex, width: 18, height: 18 }} aria-hidden />
                    {c?.name ?? hex}{on ? ' 🔒' : ''}
                  </Chip>
                );
              })}
              {locked.length < MAX_LOCKED_COLORS ? <Button kind="secondary" size="sm" onClick={() => setPicker(true)}>+ {t('addColor')}</Button> : null}
            </div>
          </Card>

          <Card title={t('themes')}>
            <Chips>
              {[...understanding.patterns.map((p) => tMaybe(t, `pattern_${p}`, p)), ...understanding.themes].map((x) => (
                <Chip key={x}>{x}</Chip>
              ))}
            </Chips>
            {understanding.patterns.length + understanding.themes.length === 0 ? <p className="muted">{t('noneDetected')}</p> : null}
          </Card>

          <Card title={`${t('teamName')} · ${t('playerName')} · ${t('number')}`} sub={t('exactSpelling')}>
            <div className={s.three}>
              <TextField label={t('teamName')} value={confirmed.team_name} maxLength={TEXT_LIMITS.team_name} testId="confirm-team"
                hint={sourceLabel(understanding.team_name.source)} error={issues.team ? t('tooLong') : null}
                onValue={(team_name) => flow.editConfirmed({ team_name })} />
              <TextField label={t('playerName')} value={confirmed.player_name} maxLength={TEXT_LIMITS.player_name} testId="confirm-player"
                hint={sourceLabel(understanding.player_name.source)} error={issues.player ? t('tooLong') : null}
                onValue={(player_name) => flow.editConfirmed({ player_name })} />
              <TextField label={t('number')} value={confirmed.number} maxLength={3} inputMode="numeric" testId="confirm-number"
                hint={sourceLabel(understanding.number.source)} error={issues.number ? t('digitsOnly') : null}
                onValue={(v) => flow.editConfirmed({ number: cleanNumber(v) })} />
            </div>
          </Card>
        </div>

        <aside className={s.aside}>
          <Card>
            <p className="small muted">{t('recognizedPrompt')}</p>
            <p style={{ fontStyle: 'italic' }}>“{confirmed.prompt}”</p>
            {open.length ? <Banner tone="warn" testId="open-questions">{t('answerQuestions', { n: open.length })}</Banner> : null}
            {error ? <Banner tone="fail" action={t('retry')} onAction={go} testId="confirm-error">{error}</Banner> : null}
            <div style={{ marginTop: 12 }} className="stack">
              <Button block size="lg" busy={busy === 'generate'} testId="generate"
                disabled={!ready || !fieldsOk || promptDirty || busy !== null} onClick={go}>
                {busy === 'generate' ? t('generating') : t('generateCta')}
              </Button>
              <Button block kind="ghost" href="/design">{t('editBrief')}</Button>
            </div>
          </Card>
        </aside>
      </div>
      <ColorPickerModal open={picker} initial="#c9a227" onClose={() => setPicker(false)} onPick={(hex) => {
        if (!locked.includes(hex)) flow.editConfirmed({ locked_colors: [...locked, hex].slice(0, MAX_LOCKED_COLORS) });
        setPicker(false);
      }} />
    </div>
  );
}
