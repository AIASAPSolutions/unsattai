import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SIZES, type Size } from '../api/types';
import { useT } from '../i18n';
import { cleanNumber } from '../lib/validation';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { space } from '../ui/theme';

export function SizePicker({ value, onChange, testID }: { value: Size; onChange: (s: Size) => void; testID?: string }) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {SIZES.map((s) => <Chip key={s} testID={testID ? `${testID}-${s}` : undefined} label={s} selected={value === s} onPress={() => onChange(s)} />)}
    </View>
  );
}

export function Qty({ value, onChange, testID, max = 500 }: { value: number; onChange: (n: number) => void; testID?: string; max?: number }) {
  const t = useT();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (n: number) => onChange(Math.max(1, Math.min(max, n)));
  return (
    <View style={styles.qty}>
      <Button compact kind="secondary" label="−" onPress={() => set(value - 1)} disabled={value <= 1} accessibilityHint={t('quantity')}
        testID={testID ? `${testID}-minus` : undefined} />
      <Field testID={testID} label={t('quantity')} value={text} keyboardType="number-pad" maxLength={3} style={styles.qtyInput}
        onChangeText={(v) => {
          const clean = cleanNumber(v).replace(/\D/g, '');
          setText(clean);
          if (clean) onChange(Math.min(max, Number(clean)));
        }}
        onBlur={() => set(Number(text) || 1)}
        error={value < 1 || value > max ? t('qtyRange') : null} />
      <Button compact kind="secondary" label="+" onPress={() => set(value + 1)} disabled={value >= max}
        testID={testID ? `${testID}-plus` : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  qty: { flexDirection: 'row', alignItems: 'center', marginTop: space(2) },
  qtyInput: { width: 90, textAlign: 'center', marginHorizontal: space(2) },
});
