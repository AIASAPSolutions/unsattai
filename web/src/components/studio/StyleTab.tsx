'use client';
import { useState } from 'react';
import { ColorPickerModal } from '@/components/design/ColorPicker';
import { useMeta } from '@/components/providers/data';
import { Button, Chip, Chips, Tabs } from '@/components/ui';
import { useT } from '@/i18n/provider';
import { COLOR_ROLES, COVERAGES, FONTS, PATTERNS, type ColorRole, type DesignSpec } from '@/lib/api/types';
import { flow } from '@/lib/flow';
import { setPath } from '@/lib/spec';
import { Slider } from './Slider';
import s from './studio.module.css';
import { latestSpec, type StudioTools } from './tools';

export function StyleTab({ spec }: StudioTools) {
  const t = useT();
  const { meta } = useMeta();
  const [role, setRole] = useState<ColorRole | null>(null);

  const set = (path: string, value: unknown) => flow.edit(setPath(latestSpec() ?? spec, path, value));
  const liveSet = (path: string, value: unknown) => {
    const cur = latestSpec();
    if (cur) flow.live(setPath(cur, path, value));
  };
  const applyPalette = (p: Partial<DesignSpec['palette']>) => {
    const cur = latestSpec() ?? spec;
    const picked = Object.fromEntries(COLOR_ROLES.map((r) => [r, p[r]]).filter(([, v]) => !!v));
    flow.edit({ ...cur, palette: { ...cur.palette, ...picked } });
  };

  return (
    <>
      <section className={s.section} aria-labelledby="st-colours">
        <h3 id="st-colours">{t('colours')}</h3>
        {COLOR_ROLES.map((r) => (
          <button key={r} type="button" className={s.roleRow} data-testid={`role-${r}`} onClick={() => setRole(r)}
            aria-label={`${t(`role_${r}`)} ${spec.palette[r]}. ${t('customColor')}`}>
            <span className={s.roleDot} style={{ background: spec.palette[r] }} aria-hidden />
            <span style={{ flex: 1 }}>{t(`role_${r}`)}</span>
            <span className={s.mono}>{spec.palette[r]}</span>
          </button>
        ))}
        {meta?.palettes.length ? (
          <>
            <p className="small" style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t('palettes')}</p>
            <div className={s.presets} role="group" aria-label={t('palettes')}>
              {meta.palettes.map((p) => (
                <button key={p.name} type="button" className={s.preset} data-testid={`preset-${p.name}`} onClick={() => applyPalette(p.palette)}>
                  <span className={s.presetDots} aria-hidden>{COLOR_ROLES.map((r) => <span key={r} style={{ background: p.palette[r] }} />)}</span>
                  {p.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <section className={s.section} aria-labelledby="st-pattern">
        <h3 id="st-pattern">{t('pattern')}</h3>
        <Chips label={t('pattern')}>
          {PATTERNS.map((p) => (
            <Chip key={p} testId={`pattern-${p}`} selected={spec.pattern.type === p} onClick={() => set('pattern.type', p)}>{t(`pattern_${p}`)}</Chip>
          ))}
        </Chips>
        <p className="small" style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t('coverageLabel')}</p>
        <Chips label={t('coverageLabel')}>
          {COVERAGES.map((c) => (
            <Chip key={c} testId={`coverage-${c}`} selected={spec.pattern.coverage === c} onClick={() => set('pattern.coverage', c)}>{t(`coverage_${c}`)}</Chip>
          ))}
        </Chips>
        <Slider label={t('scale')} value={spec.pattern.scale} min={0.4} max={2.5} step={0.05} testId="pattern-scale"
          format={(v) => `${v.toFixed(2)}×`} onLive={(v) => liveSet('pattern.scale', v)} />
        <Slider label={t('opacity')} value={spec.pattern.opacity} min={0.15} max={1} step={0.05} testId="pattern-opacity"
          format={(v) => `${Math.round(v * 100)}%`} onLive={(v) => liveSet('pattern.opacity', v)} />
        <Button kind="secondary" size="sm" testId="shuffle" onClick={() => set('seed', Math.floor(Math.random() * 1_000_000))}>⤮ {t('shuffle')}</Button>
      </section>

      <section className={s.section} aria-labelledby="st-base">
        <h3 id="st-base">{t('base')}</h3>
        <Tabs label={t('base')} value={spec.base} onChange={(v) => set('base', v)} testId="base"
          options={[{ value: 'solid', label: t('base_solid') }, { value: 'gradient', label: t('base_gradient') }]} />
        {spec.garment !== 'shorts' ? (
          <>
            <p className="small" style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t('shoulderStripes')}</p>
            <Chips label={t('shoulderStripes')}>
              {[0, 1, 2, 3].map((n) => (
                <Chip key={n} testId={`stripes-${n}`} selected={spec.accents.shoulder_stripes === n} onClick={() => set('accents.shoulder_stripes', n)}>{String(n)}</Chip>
              ))}
            </Chips>
          </>
        ) : null}
        <div style={{ marginTop: 10 }}>
          <Chip testId="side-panels" selected={spec.accents.side_panels} onClick={() => set('accents.side_panels', !spec.accents.side_panels)}>
            {spec.accents.side_panels ? '✓ ' : ''}{t('sidePanels')}
          </Chip>
        </div>
      </section>

      <section className={s.section} aria-labelledby="st-font">
        <h3 id="st-font">{t('font')}</h3>
        <Chips label={t('font')}>
          {FONTS.map((f) => (
            <Chip key={f} testId={`font-${f}`} selected={spec.typography.font === f} onClick={() => set('typography.font', f)}>{t(`font_${f}`)}</Chip>
          ))}
        </Chips>
      </section>

      <ColorPickerModal open={role !== null} initial={role ? spec.palette[role] : '#000000'} title={role ? t(`role_${role}`) : undefined}
        testId="role-picker" onClose={() => setRole(null)} onPick={(hex) => {
          if (role) set(`palette.${role}`, hex);
          setRole(null);
        }} />
    </>
  );
}
