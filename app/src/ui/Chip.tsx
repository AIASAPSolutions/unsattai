import { Pressable, StyleSheet } from 'react-native';
import { T } from './Text';
import { colors, radius, space } from './theme';

export function Chip({ label, selected, onPress, testID, disabled }: {
  label: string; selected?: boolean; onPress?: () => void; testID?: string; disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        { opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      <T variant="label" color={selected ? '#fff' : colors.ink}>{label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40, paddingHorizontal: space(3.5), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, justifyContent: 'center', marginRight: space(2), marginBottom: space(2),
  },
  selected: { backgroundColor: colors.navy, borderColor: colors.navy },
});
