import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { T } from './Text';
import { colors, radius, space } from './theme';

/** A bottom sheet with a title, a close button and scrolling content. */
export function Sheet({ visible, title, onClose, children, footer, testID }: {
  visible: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testID?: string;
}) {
  const t = useT();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} />
        <SafeAreaView edges={['bottom']} style={styles.sheet} testID={testID}>
          <View style={styles.head}>
            <T variant="heading" accessibilityRole="header" style={{ flex: 1 }}>{title}</T>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')} hitSlop={8} style={styles.close}
              testID={testID ? `${testID}-close` : undefined}>
              <T variant="heading" color={colors.muted}>✕</T>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), paddingTop: space(4), paddingBottom: space(2) },
  close: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: space(4), paddingBottom: space(4) },
  footer: { padding: space(4), paddingTop: space(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});
