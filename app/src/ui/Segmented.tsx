import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { T } from './Text';
import { colors, radius, space } from './theme';

export function Segmented<V extends string>({ options, value, onChange, scroll, testID }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; scroll?: boolean; testID?: string;
}) {
  const items = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={o.value}
        testID={testID ? `${testID}-${o.value}` : undefined}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={o.label}
        onPress={() => onChange(o.value)}
        style={[styles.item, on && styles.on, !scroll && { flex: 1 }]}
      >
        <T variant="label" color={on ? '#fff' : colors.ink} numberOfLines={1} style={{ textAlign: 'center' }}>{o.label}</T>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap} accessibilityRole="tablist">
        {items}
      </ScrollView>
    );
  }
  return <View style={[styles.wrap, styles.row]} accessibilityRole="tablist">{items}</View>;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#e8eaf0', borderRadius: radius.md, padding: 3 },
  item: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space(3), borderRadius: radius.sm },
  on: { backgroundColor: colors.navy },
  row: { flexDirection: 'row' },
});
