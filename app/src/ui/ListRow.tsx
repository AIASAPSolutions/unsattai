import { Pressable, StyleSheet, View } from 'react-native';
import { T } from './Text';
import { colors, radius, space } from './theme';

/** A tappable menu row with an icon, a label, an optional note or badge, and a chevron. */
export function ListRow({ icon, label, note, badge, onPress, testID, danger }: {
  icon?: string; label: string; note?: string; badge?: number; onPress: () => void; testID?: string; danger?: boolean;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={[label, note, badge ? String(badge) : ''].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}>
      {icon ? <T variant="heading" style={styles.icon}>{icon}</T> : null}
      <View style={{ flex: 1 }}>
        <T variant="body" color={danger ? colors.fail : colors.ink}>{label}</T>
        {note ? <T variant="caption" numberOfLines={1}>{note}</T> : null}
      </View>
      {badge ? (
        <View style={styles.badge} testID={testID ? `${testID}-badge` : undefined}>
          <T variant="caption" color="#fff" style={{ fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</T>
        </View>
      ) : null}
      <T variant="heading" color={colors.muted}>›</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: space(2), paddingHorizontal: space(1),
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, borderRadius: radius.sm,
  },
  icon: { width: 36, textAlign: 'center', marginRight: space(2), fontSize: 20 },
  badge: {
    minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6, marginRight: space(2),
  },
});
