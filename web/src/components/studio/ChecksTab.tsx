'use client';
import { Banner, Chip, Chips, Loading } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { SIZES, type Check, type CheckLevel, type Size } from '@/lib/api/types';
import s from './studio.module.css';

const ORDER: CheckLevel[] = ['fail', 'warn', 'info', 'pass'];
const STYLE: Record<CheckLevel, { fg: string; bg: string; icon: string }> = {
  fail: { fg: 'var(--fail)', bg: 'var(--fail-soft)', icon: '✕' },
  warn: { fg: 'var(--warn)', bg: 'var(--warn-soft)', icon: '!' },
  info: { fg: 'var(--info)', bg: 'var(--info-soft)', icon: 'i' },
  pass: { fg: 'var(--pass)', bg: 'var(--pass-soft)', icon: '✓' },
};

export function sortChecks(checks: Check[]): Check[] {
  return [...checks].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
}

/** Checks exactly as the server reported them: nothing is upgraded to "pass" on the client. */
export function ChecksList({ checks, compact }: { checks: Check[]; compact?: boolean }) {
  const t = useT();
  const list = sortChecks(checks).filter((c) => !compact || c.level === 'fail' || c.level === 'warn');
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="checks-list">
      {list.map((c, i) => {
        const st = STYLE[c.level];
        return (
          <li key={`${c.id}-${c.element_id ?? ''}-${i}`} className={s.check} style={{ background: st.bg }} data-level={c.level}>
            <span className={s.checkIcon} style={{ color: st.fg }} aria-hidden>{st.icon}</span>
            <span>
              <strong style={{ color: st.fg, display: 'block', fontSize: '0.78rem' }}>{t(`level_${c.level}`)}</strong>
              {c.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Shows the server's checks for the current spec only; while a re-check runs nothing is shown as passing. */
export function ChecksTab({ checks, ready, fresh, sizes, onSizes }: {
  checks: Check[] | null; ready: boolean | null; fresh: boolean; sizes: Size[]; onSizes: (s: Size[]) => void;
}) {
  const t = useT();
  const toggle = (x: Size) => onSizes(sizes.includes(x) ? sizes.filter((y) => y !== x) : SIZES.filter((y) => y === x || sizes.includes(y)));
  return (
    <>
      <section className={s.section} aria-labelledby="ck-title" aria-busy={!fresh}>
        <h3 id="ck-title">{t('checksTitle')}</h3>
        {!fresh || !checks ? <Loading label={t('checking')} testId="checks-loading" /> : (
          <>
            <Banner tone={ready ? 'pass' : 'fail'} testId="checks-summary">{ready ? t('checksReady') : t('checksBlocked')}</Banner>
            <div style={{ height: 10 }} />
            <ChecksList checks={checks} />
          </>
        )}
      </section>
      <section className={s.section} aria-labelledby="ck-sizes">
        <h3 id="ck-sizes">{t('checkSizes')}</h3>
        <Chips label={t('checkSizes')}>
          {SIZES.map((x) => <Chip key={x} testId={`check-size-${x}`} selected={sizes.includes(x)} onClick={() => toggle(x)}>{x}</Chip>)}
        </Chips>
        <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>{t('checkSizesHint')}</p>
      </section>
      <section className={s.section} aria-labelledby="ck-notes">
        <h3 id="ck-notes">{t('printNotes')}</h3>
        {(['noteWhite', 'notePolyester', 'notePrototype'] as const).map((k) => <p key={k} className="small muted">• {t(k)}</p>)}
      </section>
    </>
  );
}
