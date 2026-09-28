import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { T } from './Text';
import { colors, radius, shadow, space } from './theme';

export function Card({ title, children, style, right }: { title?: string; children: ReactNode; style?: ViewStyle; right?: ReactNode }) {
  return (
    <View style={[styles.card, shadow, style]}>
      {title ? (
        <View style={styles.head}>
          <T variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space(4), marginBottom: space(4) },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: space(3) },
});
