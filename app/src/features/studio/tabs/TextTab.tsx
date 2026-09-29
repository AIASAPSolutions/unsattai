import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ColorPickerModal } from '../../../components/ColorPickerModal';
import { COLOR_ROLES, FONTS, TEXT_LIMITS, type Bind, type TextElement } from '../../../api/types';
import { useT, type T as Tr } from '../../../i18n';
import { isSafe, textValue, zoneCenter } from '../../../lib/geometry';
import { addElement, newTextLayer, removeElement, setPath, updateElement } from '../../../lib/spec';
import { checkFreeText, checkNumber, checkPlayer, checkTeam, cleanNumber } from '../../../lib/validation';
import { Button } from '../../../ui/Button';
import { Card } from '../../../ui/Card';
import { Chip } from '../../../ui/Chip';
import { Field } from '../../../ui/Field';
import { Slider } from '../../../ui/Slider';
import { T } from '../../../ui/Text';
import { colors, radius, space } from '../../../ui/theme';
import { latestSpec, type StudioTools } from './types';

export function layerLabel(t: Tr, el: TextElement): string {
  if (el.bind === 'team_name') return t('layerTeam');
  if (el.bind === 'player_name') return t('layerPlayer');
  if (el.bind === 'number') return t('layerNumber');
  return t('layerText');
}

export function TextTab(tools: StudioTools) {
  const { spec, edit, live, begin, end, selectedId, select, side } = tools;
  const t = useT();
  const [freeText, setFreeText] = useState('');
  const [picker, setPicker] = useState(false);
  const layers = spec.elements.filter((e): e is TextElement => e.type === 'text');
  const selected = layers.find((e) => e.id === selectedId) ?? null;

  // Typing is one undo step per focus, not per keystroke.
  const typo = (key: 'team_name' | 'player_name' | 'number', value: string) => {
    const cur = latestSpec();
    if (cur) live(setPath(cur, `typography.${key}`, value));
  };
  const patchSelected = (patch: Partial<TextElement>, liveOnly = false) => {
    const cur = latestSpec();
    if (!cur || !selected) return;
    const next = updateElement(cur, selected.id, patch);
    if (liveOnly) live(next);
    else edit(next);
  };

  const addBound = (bind: Bind) => {
    const el = { ...newTextLayer(spec, side, ''), bind, size: bind === 'number' ? 120 : 50 };
    edit(addElement(spec, el));
    select(el.id);
  };
  const addFree = () => {
    const text = freeText.trim();
    if (!text || checkFreeText(text)) return;
    const el = newTextLayer(spec, side, text);
    edit(addElement(spec, el));
    select(el.id);
    setFreeText('');
  };

  const ty = spec.typography;
  return (
    <View>
      <Card title={`${t('teamName')} · ${t('playerName')} · ${t('number')}`}>
        <Field testID="studio-team" label={t('teamName')} value={ty.team_name} maxLength={TEXT_LIMITS.team_name}
          counter={t('charsLeft', { n: TEXT_LIMITS.team_name - [...ty.team_name].length })}
          error={checkTeam(ty.team_name) ? t('tooLong') : null}
          onFocus={begin} onBlur={end} onChangeText={(v) => typo('team_name', v)} />
        <Field testID="studio-player" label={t('playerName')} value={ty.player_name} maxLength={TEXT_LIMITS.player_name}
          error={checkPlayer(ty.player_name) ? t('tooLong') : null}
          onFocus={begin} onBlur={end} onChangeText={(v) => typo('player_name', v)} />
        <Field testID="studio-number" label={t('number')} value={ty.number} maxLength={3} keyboardType="number-pad"
          error={checkNumber(ty.number) ? t('digitsOnly') : null}
          onFocus={begin} onBlur={end} onChangeText={(v) => typo('number', cleanNumber(v))} />
        <T variant="caption">{t('exactSpelling')}</T>
      </Card>

      <Card title={t('textLayers')}>
        {layers.length === 0 ? <T variant="caption">{t('noTextLayers')}</T> : null}
        {layers.map((el) => {
          const safe = isSafe(spec, el);
          const on = el.id === selectedId;
          return (
            <Pressable key={el.id} testID={`layer-${el.id}`} onPress={() => select(on ? null : el.id)} accessibilityRole="button"
              accessibilityState={{ selected: on }} style={[styles.layer, on && styles.layerOn]}>
              <View style={{ flex: 1 }}>
                <T variant="label">{layerLabel(t, el)} · {el.panel === 'front' ? t('front') : t('back2')}</T>
                <T variant="caption" numberOfLines={1}>{textValue(spec, el) || '—'}</T>
              </View>
              {!safe ? <T variant="caption" color={colors.fail}>✕ {t('unsafeShort')}</T> : null}
            </Pressable>
          );
        })}
        <T variant="label" style={{ marginTop: space(3), marginBottom: space(2) }}>{t('add')}</T>
        <View style={styles.wrap}>
          <Chip testID="add-team" label={`+ ${t('addTeam')}`} onPress={() => addBound('team_name')} />
          <Chip testID="add-player" label={`+ ${t('addPlayer')}`} onPress={() => addBound('player_name')} />
          <Chip testID="add-number" label={`+ ${t('addNumber')}`} onPress={() => addBound('number')} />
        </View>
        <Field testID="free-text" label={t('addFreeText')} value={freeText} maxLength={TEXT_LIMITS.free}
          placeholder={t('freeTextPlaceholder')} onChangeText={setFreeText} onSubmitEditing={addFree}
          counter={t('charsLeft', { n: TEXT_LIMITS.free - [...freeText].length })} />
        <Button testID="add-free" kind="secondary" compact label={t('add')} onPress={addFree} disabled={!freeText.trim()} />
      </Card>

      {selected ? (
        <Card title={layerLabel(t, selected)} right={
          <Button compact kind="ghost" label={t('done')} onPress={() => select(null)} />
        }>
          {selected.bind ? <T variant="caption" style={{ marginBottom: space(3) }}>{t('boundHint')}</T> : (
            <Field testID="layer-text" label={t('layerText')} value={selected.text} maxLength={TEXT_LIMITS.free}
              error={checkFreeText(selected.text) ? t('invalid') : null}
              onFocus={begin} onBlur={end} onChangeText={(text) => patchSelected({ text }, true)} />
          )}
          <Slider testID="layer-size" label={t('size')} value={selected.size} min={8} max={320} step={1}
            onBegin={begin} onChange={(size) => patchSelected({ size }, true)} onCommit={end} format={(v) => `${Math.round(v)} mm`} />
          <Slider testID="layer-rotation" label={t('rotate')} value={selected.rotation} min={-180} max={180} step={1}
            onBegin={begin} onChange={(rotation) => patchSelected({ rotation }, true)} onCommit={end} format={(v) => `${Math.round(v)}°`} />
          <T variant="label" style={{ marginBottom: space(2) }}>{t('font')}</T>
          <View style={styles.wrap}>
            <Chip label={t('designFont')} selected={!selected.font} onPress={() => patchSelected({ font: null })} />
            {FONTS.map((f) => (
              <Chip key={f} label={t(`font_${f}`)} selected={selected.font === f} onPress={() => patchSelected({ font: f })} />
            ))}
          </View>
          <T variant="label" style={{ marginVertical: space(2) }}>{t('colorFromPalette')}</T>
          <View style={styles.wrap}>
            {COLOR_ROLES.map((r) => {
              const on = !selected.color && (selected.color_role ?? 'text') === r;
              return (
                <Pressable key={r} accessibilityRole="button" accessibilityLabel={t(`role_${r}`)} accessibilityState={{ selected: on }}
                  onPress={() => patchSelected({ color_role: r, color: null })}
                  style={[styles.colorDot, { backgroundColor: spec.palette[r] }, on && styles.colorOn]} />
              );
            })}
            <Chip label={selected.color ? `✓ ${selected.color}` : t('customColor')} selected={!!selected.color} onPress={() => setPicker(true)} />
          </View>
          <View style={[styles.wrap, { marginTop: space(3) }]}>
            <Button compact kind="secondary" label={`⇄ ${t('bringToFront')}`} onPress={() => {
              const other = selected.panel === 'front' ? 'back' : 'front';
              const [x, y] = zoneCenter(spec.garment, other, spec.sleeves, spec.collar);
              patchSelected({ panel: other, x, y });
            }} style={{ marginRight: space(2) }} />
            <Button compact kind="danger" label={t('deleteLayer')} onPress={() => {
              edit(removeElement(spec, selected.id));
              select(null);
            }} />
          </View>
          <ColorPickerModal visible={picker} initial={selected.color ?? spec.palette[selected.color_role ?? 'text']}
            onClose={() => setPicker(false)} onPick={(color) => {
              patchSelected({ color });
              setPicker(false);
            }} />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  layer: {
    flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space(3), borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, marginBottom: space(2),
  },
  layerOn: { borderColor: colors.blue, borderWidth: 2 },
  colorDot: { width: 36, height: 36, borderRadius: 18, marginRight: space(2), marginBottom: space(2), borderWidth: 1, borderColor: colors.line },
  colorOn: { borderWidth: 3, borderColor: colors.blue },
});
