import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Banner } from './Banner';
import { T } from './Text';
import { colors, space } from './theme';

export function Loading({ label, testID }: { label: string; testID?: string }) {
  return (
    <View style={styles.center} testID={testID} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.brand} />
      <T variant="body" style={{ marginTop: space(3), textAlign: 'center' }}>{label}</T>
    </View>
  );
}

export function ErrorState({ message, retryLabel, onRetry, testID }: {
  message: string; retryLabel?: string; onRetry?: () => void; testID?: string;
}) {
  return (
    <View style={styles.pad} testID={testID}>
      <Banner tone="fail" text={message} action={retryLabel} onAction={onRetry} />
    </View>
  );
}

export function Empty({ label }: { label: string }) {
  return (
    <View style={styles.center}>
      <T variant="body" color={colors.muted}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: space(8) },
  pad: { paddingVertical: space(2) },
});
