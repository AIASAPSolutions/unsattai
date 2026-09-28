'use client';
import { useT } from '@/i18n/provider';
import { cx } from '@/components/ui';
import s from './design.module.css';

const STEPS = ['howDescribe', 'confirmTitle', 'howPick', 'howEdit', 'howOrder'] as const;

export function FlowSteps({ current }: { current: 0 | 1 | 2 | 3 | 4 }) {
  const t = useT();
  return (
    <ol className={s.steps} aria-label={t('howTitle')}>
      {STEPS.map((k, i) => (
        <li key={k} aria-current={i === current ? 'step' : undefined} className={cx(i < current && s.done)}>
          {i < current ? '✓ ' : ''}{t(k)}
        </li>
      ))}
    </ol>
  );
}
