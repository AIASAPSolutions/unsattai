import { memo } from 'react';
import { View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

/** Renders server SVG markup natively (react-native-svg). */
/** `aspect` is height / width, as returned by svgAspect(). */
function SvgImageImpl({ xml, style, label, aspect }: { xml: string; style?: ViewStyle; label?: string; aspect?: number }) {
  return (
    <View style={[{ width: '100%', aspectRatio: aspect ? 1 / aspect : undefined }, style]} accessible={!!label} accessibilityRole="image" accessibilityLabel={label}>
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

export const SvgImage = memo(SvgImageImpl);
