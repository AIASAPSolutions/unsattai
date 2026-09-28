'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ColorPickerModal } from '@/components/design/ColorPicker';
import s from '@/components/design/design.module.css';
import { FlowSteps } from '@/components/design/FlowSteps';
import { Banner, Button, Card, Chip, Chips, TextArea, TextField } from '@/components/ui';
import { errorMessage, LANGUAGE_OPTIONS } from '@/i18n';
import { useI18n } from '@/i18n/provider';
import { GARMENTS, MAX_LOCKED_COLORS, PROMPT_LIMIT, TEXT_LIMITS, type Garment } from '@/lib/api/types';
import { flow, useFlow } from '@/lib/flow';
import { checkNumber, checkPlayer, checkPrompt, checkTeam, cleanNumber } from '@/lib/validation';

export function BriefClient() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const brief = useFlow((st) => st.brief);
  const hasHistory = useFlow((st) => !!st.history);
  const hasDesigns = useFlow((st) => st.designs.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [picker, setPicker] = useState(false);

  // /design?garment=vneck from the landing page's garment cards.
  useEffect(() => {
    const g = params.get('garment');
    if (g && (GARMENTS as readonly string[]).includes(g)) flow.setBrief({ garment: g as Garment });
  }, [params]);

  const promptIssue = checkPrompt(brief.prompt);
  const teamIssue = checkTeam(brief.team_name);
  const playerIssue = checkPlayer(brief.player_name);
  const numberIssue = checkNumber(brief.number);
  const valid = !promptIssue && !teamIssue && !playerIssue && !numberIssue;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await flow.understand(lang);
      router.push('/design/confirm');
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  };

  const examples = [t('example1'), t('example2'), t('example3'), t('example4')];

  return (
    <div className="container page">
      <FlowSteps current={0} />
      <div className={s.layout}>
        <form onSubmit={submit} noValidate className="stack" data-testid="screen-describe">
          <div>
            <h1>{t('describeTitle')}</h1>
            <p className="muted">{t('describeHint')}</p>
          </div>

          {hasHistory || hasDesigns ? (
            <Banner tone="info" testId="resume-banner">
              <p style={{ margin: '0 0 8px' }}>{t('restoreDraft')}</p>
              <div className="row">
                <Button size="sm" kind="secondary" onClick={() => router.push(hasHistory ? '/studio' : '/design/designs')}
                  testId="resume">{t('resume')}</Button>
                <Button size="sm" kind="ghost" onClick={() => flow.resetDesign()}>{t('startOver')}</Button>
              </div>
            </Banner>
          ) : null}

          <Card>
            <div style={{ marginBottom: 12 }}>
              <span className="small muted" id="brief-lang">{t('language')}: </span>
              <Chips label={t('language')}>
                {LANGUAGE_OPTIONS.map((o) => (
                  <Chip key={o.code} selected={lang === o.code} onClick={() => setLang(o.code)} testId={`lang-${o.code}`}>
                    <span lang={o.code}>{o.label}</span>
                  </Chip>
                ))}
              </Chips>
            </div>
            <TextArea label={t('briefLabel')} value={brief.prompt} maxLength={PROMPT_LIMIT} rows={4}
              placeholder={t('briefPlaceholder')} testId="brief" onValue={(prompt) => flow.setBrief({ prompt })}
              counter={t('charsLeft', { n: PROMPT_LIMIT - brief.prompt.length })}
              error={touched && promptIssue ? (promptIssue === 'tooLong' ? t('promptTooLong') : t('promptTooShort')) : null} />
            <p className="small muted" style={{ marginBottom: 8 }}>{t('examples')}</p>
            <Chips>
              {examples.map((ex, i) => (
                <Chip key={i} testId={`example-${i}`} onClick={() => flow.setBrief({ prompt: ex })}>{ex}</Chip>
              ))}
            </Chips>
          </Card>

          <Card title={t('garmentLabel')}>
            <Chips label={t('garmentLabel')}>
              {GARMENTS.map((g) => (
                <Chip key={g} selected={brief.garment === g} testId={`garment-${g}`} onClick={() => flow.setBrief({ garment: g })}>
                  {t(`garment_${g}`)}
                </Chip>
              ))}
            </Chips>
          </Card>

          <Card title={t('lockedColors')} sub={t('lockedColorsHint')}>
            <div className={s.lockedRow}>
              {brief.locked_colors.map((c) => (
                <span key={c} className={s.locked}>
                  <span className={s.dot} style={{ background: c }} aria-hidden />
                  {c}
                  <button type="button" aria-label={`${t('delete')} ${c}`}
                    onClick={() => flow.setBrief({ locked_colors: brief.locked_colors.filter((x) => x !== c) })}>✕</button>
                </span>
              ))}
              {brief.locked_colors.length < MAX_LOCKED_COLORS ? (
                <Button kind="secondary" size="sm" testId="add-color" onClick={() => setPicker(true)}>+ {t('addColor')}</Button>
              ) : null}
            </div>
          </Card>

          <Card title={`${t('teamName')} · ${t('playerName')} · ${t('number')}`} sub={`${t('optional')} · ${t('exactSpelling')}`}>
            <div className={s.three}>
              <TextField label={t('teamName')} value={brief.team_name} maxLength={TEXT_LIMITS.team_name} testId="team"
                onValue={(team_name) => flow.setBrief({ team_name })} error={teamIssue ? t('tooLong') : null} />
              <TextField label={t('playerName')} value={brief.player_name} maxLength={TEXT_LIMITS.player_name} testId="player"
                onValue={(player_name) => flow.setBrief({ player_name })} error={playerIssue ? t('tooLong') : null} />
              <TextField label={t('number')} value={brief.number} maxLength={3} inputMode="numeric" testId="number"
                hint={t('numberHint')} onValue={(v) => flow.setBrief({ number: cleanNumber(v) })}
                error={numberIssue ? t('digitsOnly') : null} />
            </div>
          </Card>

          {error ? <Banner tone="fail" action={t('retry')} onAction={() => void submit()} testId="describe-error">{error}</Banner> : null}
          <div className="row">
            <Button type="submit" size="lg" busy={busy} testId="understand" disabled={touched && !valid}>{t('understandCta')}</Button>
          </div>
        </form>

        <aside className={s.aside}>
          <Card title={t('pictureEntryTitle')}>
            <p className="small muted">{t('pictureEntryHint')}</p>
            <Button kind="secondary" href="/design/picture" testId="use-picture">{t('pictureEntryCta')}</Button>
          </Card>
        </aside>
      </div>

      <ColorPickerModal open={picker} initial="#1f5fbf" onClose={() => setPicker(false)} onPick={(hex) => {
        if (!brief.locked_colors.includes(hex)) flow.setBrief({ locked_colors: [...brief.locked_colors, hex].slice(0, MAX_LOCKED_COLORS) });
        setPicker(false);
      }} />
    </div>
  );
}
