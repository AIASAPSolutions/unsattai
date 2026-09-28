import { Pressable, StyleSheet, View } from 'react-native';
import { T } from './Text';
import { colors } from './theme';

export function Stars({ value, onChange, label, testID }: {
  value: number; onChange: (n: number) => void; label: string; testID?: string;
}) {
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 5, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.max(1, Math.min(5, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} testID={testID ? `${testID}-${n}` : undefined} onPress={() => onChange(n)} hitSlop={6} style={styles.star}
          accessibilityLabel={`${n}`}>
          <T variant="heading" color={n <= value ? '#f5a524' : colors.line} style={{ fontSize: 26, lineHeight: 30 }}>★</T>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  star: { paddingHorizontal: 3, minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
});
