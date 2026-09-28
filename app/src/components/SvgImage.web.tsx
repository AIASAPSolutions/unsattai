import { memo, useMemo } from 'react';
import { Image, View, type ViewStyle } from 'react-native';
import { svgDataUrl } from '../lib/svg';

/** On web the browser renders the SVG itself, which is faster and exact. */
/** `aspect` is height / width, as returned by svgAspect(). */
function SvgImageImpl({ xml, style, label, aspect }: { xml: string; style?: ViewStyle; label?: string; aspect?: number }) {
  const uri = useMemo(() => svgDataUrl(xml), [xml]);
  return (
    <View style={[{ width: '100%', aspectRatio: aspect ? 1 / aspect : undefined }, style]} accessible={!!label} accessibilityRole="image" accessibilityLabel={label}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
    </View>
  );
}

export const SvgImage = memo(SvgImageImpl);
