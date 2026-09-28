import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { usePrefs } from '../state/prefs';
import { colors, FONT_FAMILY, lineHeightFor } from './theme';

type Variant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'button';

const SIZES: Record<Variant, { size: number; bold: boolean }> = {
  title: { size: 26, bold: true },
  heading: { size: 18, bold: true },
  body: { size: 16, bold: false },
  label: { size: 14, bold: true },
  caption: { size: 13, bold: false },
  button: { size: 16, bold: true },
};

export function T({ variant = 'body', color, style, children, ...rest }: TextProps & {
  variant?: Variant; color?: string;
}) {
  const lang = usePrefs((s) => s.language);
  const v = SIZES[variant];
  const base: TextStyle = {
    fontFamily: v.bold ? FONT_FAMILY[lang].bold : FONT_FAMILY[lang].regular,
    fontSize: v.size,
    lineHeight: lineHeightFor(lang, v.size),
    color: color ?? (variant === 'caption' ? colors.muted : colors.ink),
  };
  return (
    <RNText maxFontSizeMultiplier={1.6} {...rest} style={[base, style]}>
      {children}
    </RNText>
  );
}
