import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { T } from './Text';
import { colors, radius, space } from './theme';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ label, onPress, kind = 'primary', disabled, busy, icon, style, accessibilityHint, testID, compact }: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  icon?: string;
  style?: ViewStyle;
  accessibilityHint?: string;
  testID?: string;
  compact?: boolean;
}) {
  const off = disabled || busy;
  const bg = kind === 'primary' ? colors.brand : kind === 'danger' ? colors.fail : kind === 'secondary' ? colors.surface : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? '#fff' : kind === 'secondary' ? colors.ink : colors.blue;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.8 : 1 },
        kind === 'secondary' && styles.outline,
        style,
      ]}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={fg} style={{ marginRight: space(2) }} /> : null}
        {icon && !busy ? <T variant="button" color={fg} style={{ marginRight: space(1.5) }}>{icon}</T> : null}
        <T variant="button" color={fg} numberOfLines={2} style={{ textAlign: 'center' }}>{label}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: space(4), justifyContent: 'center' },
  compact: { minHeight: 40, paddingHorizontal: space(3) },
  outline: { borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
