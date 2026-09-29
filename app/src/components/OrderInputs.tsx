import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Fit, Garment, Size, Sleeves } from '../api/types';
import { useT } from '../i18n';
import { FIT_KEY, fitsFrom, sizeForNewFit, sizesForFit } from '../lib/sizing';
import { cleanNumber } from '../lib/validation';
import { useMeta } from '../state/meta';
import { T } from '../ui/Text';
import { SizeGuideButton } from './SizeGuide';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field } from '../ui/Field';
import { space } from '../ui/theme';

/** Sizes of one fit (Men / unisex by default), from the server's `fit_sizes` when it sent them. */
export function SizePicker({ value, onChange, testID, fit = 'men' }: { value: Size; onChange: (s: Size) => void; testID?: string; fit?: Fit }) {
  const { meta } = useMeta();
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup">
      {sizesForFit(fit, meta).map((s) => (
        <Chip key={s} testID={testID ? `${testID}-${s}` : undefined} label={s} selected={value === s} onPress={() => onChange(s)} />
      ))}
    </View>
  );
}

export function FitPicker({ value, onChange, testID }: { value: Fit; onChange: (f: Fit) => void; testID?: string }) {
  const t = useT();
  const { meta } = useMeta();
  const fits = fitsFrom(meta);
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={t('fitLabel')}>
      {fits.map((f) => <Chip key={f} testID={testID ? `${testID}-${f}` : undefined} label={t(FIT_KEY[f])} selected={value === f} onPress={() => onChange(f)} />)}
    </View>
  );
}

/**
 * Fit, then that fit's sizes, with the size guide beside them. Changing the fit keeps the size
 * when the new fit has it (Men M -> Women M) and otherwise picks the fit's middle size.
 * Test ids: `${testID}-fit-kids`, `${testID}-8Y`, `${testID}-guide`.
 */
export function FitSizePicker({ fit, size, onChange, garment, sleeves, testID }: {
  fit: Fit; size: Size; onChange: (v: { fit: Fit; size: Size }) => void; garment: Garment; sleeves: Sleeves; testID?: string;
}) {
  const t = useT();
  const { meta } = useMeta();
  return (
    <View>
      <View style={styles.head}>
        <T variant="label">{t('fitLabel')}</T>
        <SizeGuideButton fit={fit} garment={garment} sleeves={sleeves} size={size} testID={testID ? `${testID}-guide` : undefined} />
      </View>
      <FitPicker value={fit} testID={testID ? `${testID}-fit` : undefined}
        onChange={(f) => onChange({ fit: f, size: sizeForNewFit(f, size, meta) })} />
      <T variant="label" style={{ marginVertical: space(1) }}>{t('size')}</T>
      <SizePicker fit={fit} value={size} testID={testID} onChange={(s) => onChange({ fit, size: s })} />
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qty: { flexDirection: 'row', alignItems: 'center', marginTop: space(2) },
  qtyInput: { width: 90, textAlign: 'center', marginHorizontal: space(2) },
});
