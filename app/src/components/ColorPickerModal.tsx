import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { ColorPicker } from '../ui/ColorPicker';
import { T } from '../ui/Text';
import { colors, radius, space } from '../ui/theme';

export function ColorPickerModal({ visible, initial, title, onPick, onClose }: {
  visible: boolean; initial: string; title?: string; onPick: (hex: string) => void; onClose: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <T variant="heading">{title ?? t('customColor')}</T>
            <View style={[styles.preview, { backgroundColor: value }]} />
          </View>
          <ScrollView contentContainerStyle={{ padding: space(4) }}>
            <ColorPicker value={value} onLive={setValue} onCommit={setValue} />
          </ScrollView>
          <View style={styles.actions}>
            <Button kind="secondary" label={t('cancel')} onPress={onClose} style={{ flex: 1 }} />
            <Button testID="color-done" label={t('done')} onPress={() => onPick(value)} style={{ flex: 1 }} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '90%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space(4), paddingBottom: 0 },
  preview: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line },
  actions: { flexDirection: 'row', gap: space(3), padding: space(4) },
});
