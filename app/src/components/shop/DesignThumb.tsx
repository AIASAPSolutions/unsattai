import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '../../api/endpoints';
import type { DesignSpec } from '../../api/types';
import { itemSignature } from '../../features/cart/cart';
import { svgAspect } from '../../lib/svg';
import { radius } from '../../ui/theme';
import { SvgImage } from '../SvgImage';

// A picture of a customer's own design in the cart, drawn by the server once per design.
const cache = new Map<string, string>();

export function DesignThumb({ spec, label }: { spec: DesignSpec; label: string }) {
  const key = itemSignature({ spec, fabric: '', lines: [] });
  const [xml, setXml] = useState<string | null>(cache.get(key) ?? null);
  useEffect(() => {
    if (cache.has(key)) {
      setXml(cache.get(key)!);
      return;
    }
    const controller = new AbortController();
    api.render(spec, [], controller.signal).then((r) => {
      if (cache.size > 40) cache.clear();
      cache.set(key, r.mockup_svg);
      setXml(r.mockup_svg);
    }).catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!xml) return <View style={styles.box} accessible accessibilityRole="image" accessibilityLabel={label} />;
  return <SvgImage xml={xml} aspect={svgAspect(xml)} label={label} />;
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 1, backgroundColor: '#eef0f4', borderRadius: radius.md },
});
