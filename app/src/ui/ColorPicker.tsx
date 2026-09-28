import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { hexToHsv, hsvToHex, normalizeHex, onColor } from '../lib/color';
import { Field } from './Field';
import { Slider } from './Slider';
import { T } from './Text';
import { colors, radius, space } from './theme';

export const SWATCHES = [
  '#111111', '#f7f7f5', '#14213d', '#2446a6', '#1f5fbf', '#5bb8ea', '#0e7c7b', '#1bb6b0', '#0d8a5f', '#1f8a3b',
  '#9bd62a', '#6b7a2a', '#f5c518', '#c9a227', '#f39c26', '#f07c1b', '#d62828', '#b3122e', '#6d1a2a', '#ef6fa7',
  '#c2187a', '#6a2c91', '#b8bcc2', '#7d8288', '#2e3136', '#6b4226', '#d8c39a', '#f3ead3',
];

export function Swatch({ hex, selected, onPress, size = 40, label }: {
  hex: string; selected?: boolean; onPress?: () => void; size?: number; label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? hex}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      hitSlop={4}
      style={[styles.swatch, { width: size, height: size, borderRadius: size / 2, backgroundColor: hex },
        selected && styles.swatchOn]}
    >
      {selected ? <T variant="label" color={onColor(hex)}>✓</T> : null}
    </Pressable>
  );
}

/** Preset swatches, a hex field and HSV sliders; sliders update live and commit on release. */
export function ColorPicker({ value, onBegin, onLive, onCommit }: {
  value: string; onBegin?: () => void; onLive: (hex: string) => void; onCommit: (hex: string) => void;
}) {
  const t = useT();
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  useEffect(() => {
    setHexText(value);
    const [h, s, v] = hexToHsv(value);
    setHsv((prev) => (hsvToHex(...prev) === value ? prev : [h, s, v]));
  }, [value]);

  const set = (i: 0 | 1 | 2, x: number, commit: boolean) => {
    const next = [...hsv] as [number, number, number];
    next[i] = x;
    setHsv(next);
    const hex = hsvToHex(...next);
    (commit ? onCommit : onLive)(hex);
  };

  const hueTrack = Array.from({ length: 12 }, (_, i) => hsvToHex(i * 30, 1, 1));
  return (
    <View>
      <View style={styles.grid}>
        {SWATCHES.map((c) => (
          <Swatch key={c} hex={c} size={34} selected={c === value} onPress={() => { onBegin?.(); onCommit(c); }} />
        ))}
      </View>
      <Field
        label={t('hex')}
        value={hexText}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        onChangeText={setHexText}
        onEndEditing={() => {
          const n = normalizeHex(hexText);
          if (n) { onBegin?.(); onCommit(n); } else setHexText(value);
        }}
        error={normalizeHex(hexText) ? null : t('invalid')}
      />
      <Slider label="H" value={hsv[0]} min={0} max={359} step={1} track={hueTrack} format={(v) => `${Math.round(v)}°`}
        onBegin={onBegin} onChange={(v) => set(0, v, false)} onCommit={(v) => set(0, v, true)} />
      <Slider label="S" value={hsv[1]} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`}
        track={[hsvToHex(hsv[0], 0, hsv[2]), hsvToHex(hsv[0], 1, hsv[2])]}
        onBegin={onBegin} onChange={(v) => set(1, v, false)} onCommit={(v) => set(1, v, true)} />
      <Slider label="V" value={hsv[2]} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`}
        track={[hsvToHex(hsv[0], hsv[1], 0), hsvToHex(hsv[0], hsv[1], 1)]}
        onBegin={onBegin} onChange={(v) => set(2, v, false)} onCommit={(v) => set(2, v, true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginBottom: space(3) },
  swatch: { borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: colors.navy, borderRadius: radius.pill },
});
