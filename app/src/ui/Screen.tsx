import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, space } from './theme';

export function Screen({ children, footer, scroll = true, testID }: {
  children: ReactNode; footer?: ReactNode; scroll?: boolean; testID?: string;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']} testID={testID}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, styles.contentFlat]}>{children}</View>
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: space(4), paddingBottom: space(10) },
  contentFlat: { paddingHorizontal: 0 },
  footer: {
    padding: space(4), paddingTop: space(3), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
});
