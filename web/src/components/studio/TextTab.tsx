'use client';
import { useState } from 'react';
import { ColorPickerModal } from '@/components/design/ColorPicker';
import { Button, Chip, Chips, TextField, cx } from '@/components/ui';
import type { T } from '@/i18n';
import { useT } from '@/i18n/provider';
import { COLOR_ROLES, FONTS, TEXT_LIMITS, type Bind, type TextElement } from '@/lib/api/types';
import { flow } from '@/lib/flow';
import { isSafe, textValue, zoneCenter } from '@/lib/geometry';
import { addElement, newTextLayer, removeElement, setPath, updateElement } from '@/lib/spec';
import { checkFreeText, checkNumber, checkPlayer, checkTeam, cleanNumber } from '@/lib/validation';
import { Slider } from './Slider';
import s from './studio.module.css';
import { latestSpec, type StudioTools } from './tools';

export function layerLabel(t: T, el: TextElement): string {
  if (el.bind === 'team_name') return t('layerTeam');
  if (el.bind === 'player_name') return t('layerPlayer');
  if (el.bind === 'number') return t('layerNumber');
  return t('layerText');
}

export function TextTab({ spec, selectedId, select, side }: StudioTools) {
  const t = useT();
  const [freeText, setFreeText] = useState('');
  const [picker, setPicker] = useState(false);
  const layers = spec.elements.filter((e): e is TextElement => e.type === 'text');
  const selected = layers.find((e) => e.id === selectedId) ?? null;

  // Typing is one undo step per focus, not per keystroke.
  const typo = (key: 'team_name' | 'player_name' | 'number', value: string) => {
    const cur = latestSpec();
    if (cur) flow.live(setPath(cur, `typography.${key}`, value));
  };
  const patchSelected = (patch: Partial<TextElement>, liveOnly = false) => {
    const cur = latestSpec();
    if (!cur || !selected) return;
    const next = updateElement(cur, selected.id, patch);
    if (liveOnly) flow.live(next);
    else flow.edit(next);
  };
  const addBound = (bind: Bind) => {
    const cur = latestSpec() ?? spec;
    const el = { ...newTextLayer(cur, side, ''), bind, size: bind === 'number' ? 120 : 50 };
    flow.edit(addElement(cur, el));
    select(el.id);
  };
  const addFree = () => {
    const text = freeText.trim();
    if (!text || checkFreeText(text)) return;
    const cur = latestSpec() ?? spec;
    const el = newTextLayer(cur, side, text);
    flow.edit(addElement(cur, el));
    select(el.id);
    setFreeText('');
  };
  const ty = spec.typography;

  return (
    <>
      <section className={s.section} aria-labelledby="tx-names">
        <h3 id="tx-names">{t('teamName')} · {t('playerName')} · {t('number')}</h3>
        <TextField label={t('teamName')} value={ty.team_name} maxLength={TEXT_LIMITS.team_name} testId="studio-team"
          counter={t('charsLeft', { n: TEXT_LIMITS.team_name - [...ty.team_name].length })} error={checkTeam(ty.team_name) ? t('tooLong') : null}
          onFocus={flow.beginGesture} onBlur={flow.endGesture} onValue={(v) => typo('team_name', v)} />
        <TextField label={t('playerName')} value={ty.player_name} maxLength={TEXT_LIMITS.player_name} testId="studio-player"
          error={checkPlayer(ty.player_name) ? t('tooLong') : null}
          onFocus={flow.beginGesture} onBlur={flow.endGesture} onValue={(v) => typo('player_name', v)} />
        <TextField label={t('number')} value={ty.number} maxLength={3} inputMode="numeric" testId="studio-number"
          error={checkNumber(ty.number) ? t('digitsOnly') : null}
          onFocus={flow.beginGesture} onBlur={flow.endGesture} onValue={(v) => typo('number', cleanNumber(v))} />
        <p className="small muted" style={{ margin: 0 }}>{t('exactSpelling')}</p>
      </section>

      <section className={s.section} aria-labelledby="tx-layers">
        <h3 id="tx-layers">{t('textLayers')}</h3>
        {layers.length === 0 ? <p className="small muted">{t('noTextLayers')}</p> : null}
        {layers.map((el) => {
          const safe = isSafe(spec, el);
          const on = el.id === selectedId;
          return (
            <button key={el.id} type="button" className={cx(s.layerItem, on && s.layerItemOn)} aria-pressed={on}
              data-testid={`text-layer-${el.bind ?? 'free'}`} onClick={() => select(on ? null : el.id)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong className="small">{layerLabel(t, el)} · {el.panel === 'front' ? t('front') : t('back2')}</strong>
                <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {textValue(spec, el) || '—'}
                </span>
              </span>
              {!safe ? <span className="small" style={{ color: 'var(--fail)', fontWeight: 700 }}>✕ {t('unsafeShort')}</span> : null}
            </button>
          );
        })}
        <p className="small" style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t('add')}</p>
        <Chips>
          <Chip testId="add-team" onClick={() => addBound('team_name')}>+ {t('addTeam')}</Chip>
          <Chip testId="add-player" onClick={() => addBound('player_name')}>+ {t('addPlayer')}</Chip>
          <Chip testId="add-number" onClick={() => addBound('number')}>+ {t('addNumber')}</Chip>
        </Chips>
        <div style={{ height: 10 }} />
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); addFree(); }}>
          <div style={{ flex: 1 }}>
            <TextField label={t('addFreeText')} value={freeText} maxLength={TEXT_LIMITS.free} placeholder={t('freeTextPlaceholder')}
              testId="free-text" onValue={setFreeText} counter={t('charsLeft', { n: TEXT_LIMITS.free - [...freeText].length })} />
          </div>
          <Button type="submit" kind="secondary" disabled={!freeText.trim()} testId="add-free" style={{ marginBottom: 30 }}>{t('add')}</Button>
        </form>
      </section>

      {selected ? (
        <section className={s.section} aria-labelledby="tx-sel" data-testid="text-layer-editor">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 id="tx-sel" style={{ margin: 0 }}>{layerLabel(t, selected)}</h3>
            <Button kind="ghost" size="sm" onClick={() => select(null)}>{t('done')}</Button>
          </div>
          {selected.bind ? <p className="small muted">{t('boundHint')}</p> : (
            <TextField label={t('layerText')} value={selected.text} maxLength={TEXT_LIMITS.free} testId="layer-text"
              error={checkFreeText(selected.text) ? t('invalid') : null}
              onFocus={flow.beginGesture} onBlur={flow.endGesture} onValue={(text) => patchSelected({ text }, true)} />
          )}
          <Slider label={t('size')} value={selected.size} min={8} max={320} step={1} testId="layer-size"
            format={(v) => `${Math.round(v)} mm`} onLive={(size) => patchSelected({ size }, true)} />
          <Slider label={t('rotate')} value={selected.rotation} min={-180} max={180} step={1} testId="layer-rotation"
            format={(v) => `${Math.round(v)}°`} onLive={(rotation) => patchSelected({ rotation }, true)} />
          <p className="small" style={{ fontWeight: 600, margin: '8px 0 6px' }}>{t('font')}</p>
          <Chips>
            <Chip selected={!selected.font} onClick={() => patchSelected({ font: null })}>{t('designFont')}</Chip>
            {FONTS.map((f) => <Chip key={f} selected={selected.font === f} onClick={() => patchSelected({ font: f })}>{t(`font_${f}`)}</Chip>)}
          </Chips>
          <p className="small" style={{ fontWeight: 600, margin: '12px 0 6px' }}>{t('colorFromPalette')}</p>
          <div className="row" style={{ gap: 8 }}>
            {COLOR_ROLES.map((r) => {
              const on = !selected.color && (selected.color_role ?? 'text') === r;
              return (
                <button key={r} type="button" aria-label={t(`role_${r}`)} aria-pressed={on} title={t(`role_${r}`)}
                  onClick={() => patchSelected({ color_role: r, color: null })}
                  style={{ width: 34, height: 34, borderRadius: '50%', background: spec.palette[r], cursor: 'pointer',
                    border: on ? '3px solid var(--blue)' : '1px solid var(--line-2)' }} />
              );
            })}
            <Chip selected={!!selected.color} onClick={() => setPicker(true)}>{selected.color ? `✓ ${selected.color}` : t('customColor')}</Chip>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button kind="secondary" size="sm" onClick={() => {
              const other = selected.panel === 'front' ? 'back' : 'front';
              const [x, y] = zoneCenter(spec.garment, other);
              patchSelected({ panel: other, x, y });
            }}>⇄ {t('bringToFront')}</Button>
            <Button kind="danger" size="sm" testId="delete-layer" onClick={() => {
              flow.edit(removeElement(latestSpec() ?? spec, selected.id));
              select(null);
            }}>{t('deleteLayer')}</Button>
          </div>
          <ColorPickerModal open={picker} initial={selected.color ?? spec.palette[selected.color_role ?? 'text']}
            onClose={() => setPicker(false)} onPick={(color) => { patchSelected({ color }); setPicker(false); }} />
        </section>
      ) : null}
    </>
  );
}
