import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { usePrefs } from '../state/prefs';
import { T } from './Text';
import { colors, FONT_FAMILY, lineHeightFor, radius, space } from './theme';

export function Field({ label, hint, error, counter, style, multiline, ...rest }: TextInputProps & {
  label: string; hint?: string; error?: string | null; counter?: string;
}) {
  const lang = usePrefs((s) => s.language);
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <T variant="label">{label}</T>
        {counter ? <T variant="caption">{counter}</T> : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[
          styles.input,
          { fontFamily: FONT_FAMILY[lang].regular, lineHeight: lineHeightFor(lang, 16) },
          multiline && styles.multiline,
          !!error && styles.inputError,
          style,
        ]}
        {...rest}
      />
      {error ? <T variant="caption" color={colors.fail} accessibilityLiveRegion="polite">{error}</T>
        : hint ? <T variant="caption">{hint}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space(4) },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space(1.5) },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space(3),
    paddingVertical: space(2.5), fontSize: 16, color: colors.ink, backgroundColor: colors.surface,
  },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  inputError: { borderColor: colors.fail },
});
