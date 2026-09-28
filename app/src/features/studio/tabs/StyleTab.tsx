import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ColorPickerModal } from '../../../components/ColorPickerModal';
import { COLOR_ROLES, COVERAGES, FONTS, PATTERNS, type ColorRole, type DesignSpec } from '../../../api/types';
import { useT } from '../../../i18n';
import { setPath } from '../../../lib/spec';
import { useMeta } from '../../../state/meta';
import { Card } from '../../../ui/Card';
import { Chip } from '../../../ui/Chip';
import { Segmented } from '../../../ui/Segmented';
import { Slider } from '../../../ui/Slider';
import { Button } from '../../../ui/Button';
import { T } from '../../../ui/Text';
import { colors, radius, space } from '../../../ui/theme';
import { latestSpec, type StudioTools } from './types';

export function StyleTab({ spec, edit, live, begin, end }: StudioTools) {
  const t = useT();
  const { meta } = useMeta();
  const [role, setRole] = useState<ColorRole | null>(null);

  const set = (path: string, value: unknown) => edit(setPath(spec, path, value));
  const liveSet = (path: string, value: unknown) => {
    const cur = latestSpec();
    if (cur) live(setPath(cur, path, value));
  };
  const applyPalette = (p: Partial<DesignSpec['palette']>) => {
    // Only the five roles are replaced; any extra palette fields stay.
    const picked = Object.fromEntries(COLOR_ROLES.map((r) => [r, p[r]]).filter(([, v]) => !!v));
    edit({ ...spec, palette: { ...spec.palette, ...picked } });
  };

  return (
    <View>
      <Card title={t('colours')}>
        {COLOR_ROLES.map((r) => (
          <Pressable key={r} testID={`role-${r}`} onPress={() => setRole(r)} accessibilityRole="button"
            accessibilityLabel={`${t(`role_${r}`)} ${spec.palette[r]}`} style={styles.roleRow}>
            <View style={[styles.roleDot, { backgroundColor: spec.palette[r] }]} />
            <T variant="body" style={{ flex: 1 }}>{t(`role_${r}`)}</T>
            <T variant="caption">{spec.palette[r]}</T>
          </Pressable>
        ))}
        {meta?.palettes.length ? (
          <>
            <T variant="label" style={{ marginTop: space(3), marginBottom: space(2) }}>{t('palettes')}</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {meta.palettes.map((p) => (
                <Pressable key={p.name} testID={`preset-${p.name}`} onPress={() => applyPalette(p.palette)}
                  accessibilityRole="button" accessibilityLabel={p.name} style={styles.preset}>
                  <View style={{ flexDirection: 'row' }}>
                    {COLOR_ROLES.map((r) => <View key={r} style={[styles.presetDot, { backgroundColor: p.palette[r] }]} />)}
                  </View>
                  <T variant="caption" numberOfLines={1}>{p.name}</T>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : null}
      </Card>

      <Card title={t('pattern')}>
        <View style={styles.wrap}>
          {PATTERNS.map((p) => (
            <Chip key={p} testID={`pattern-${p}`} label={t(`pattern_${p}`)} selected={spec.pattern.type === p}
              onPress={() => set('pattern.type', p)} />
          ))}
        </View>
        <T variant="label" style={{ marginVertical: space(2) }}>{t('coverageLabel')}</T>
        <View style={styles.wrap}>
          {COVERAGES.map((c) => (
            <Chip key={c} testID={`coverage-${c}`} label={t(`coverage_${c}`)} selected={spec.pattern.coverage === c}
              onPress={() => set('pattern.coverage', c)} />
          ))}
        </View>
        <Slider testID="pattern-scale" label={t('scale')} value={spec.pattern.scale} min={0.4} max={2.5} step={0.05}
          onBegin={begin} onChange={(v) => liveSet('pattern.scale', v)} onCommit={end} format={(v) => `${v.toFixed(2)}×`} />
        <Slider testID="pattern-opacity" label={t('opacity')} value={spec.pattern.opacity} min={0.15} max={1} step={0.05}
          onBegin={begin} onChange={(v) => liveSet('pattern.opacity', v)} onCommit={end} format={(v) => `${Math.round(v * 100)}%`} />
        <Button testID="shuffle" kind="secondary" label={`⤮ ${t('shuffle')}`}
          onPress={() => set('seed', Math.floor(Math.random() * 1_000_000))} />
      </Card>

      <Card title={t('base')}>
        <Segmented testID="base" value={spec.base} onChange={(v) => set('base', v)}
          options={[{ value: 'solid', label: t('base_solid') }, { value: 'gradient', label: t('base_gradient') }]} />
        {spec.garment !== 'shorts' ? (
          <>
            <T variant="label" style={{ marginTop: space(4), marginBottom: space(2) }}>{t('shoulderStripes')}</T>
            <View style={styles.wrap}>
              {[0, 1, 2, 3].map((n) => (
                <Chip key={n} testID={`stripes-${n}`} label={String(n)} selected={spec.accents.shoulder_stripes === n}
                  onPress={() => set('accents.shoulder_stripes', n)} />
              ))}
            </View>
          </>
        ) : null}
        <View style={[styles.wrap, { marginTop: space(2) }]}>
          <Chip testID="side-panels" label={`${spec.accents.side_panels ? '✓ ' : ''}${t('sidePanels')}`}
            selected={spec.accents.side_panels} onPress={() => set('accents.side_panels', !spec.accents.side_panels)} />
        </View>
      </Card>

      <Card title={t('font')}>
        <View style={styles.wrap}>
          {FONTS.map((f) => (
            <Chip key={f} testID={`font-${f}`} label={t(`font_${f}`)} selected={spec.typography.font === f}
              onPress={() => set('typography.font', f)} />
          ))}
        </View>
      </Card>

      <ColorPickerModal visible={role !== null} initial={role ? spec.palette[role] : '#000000'}
        title={role ? t(`role_${role}`) : undefined} onClose={() => setRole(null)}
        onPick={(hex) => {
          if (role) set(`palette.${role}`, hex);
          setRole(null);
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  roleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  roleDot: { width: 32, height: 32, borderRadius: 16, marginRight: space(3), borderWidth: 1, borderColor: colors.line },
  preset: { padding: space(2), marginRight: space(2), borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, width: 120 },
  presetDot: { width: 18, height: 18, borderRadius: 9, marginRight: 2, marginBottom: space(1), borderWidth: 1, borderColor: colors.line },
});
