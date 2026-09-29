import { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { api } from '../../api/endpoints';
import { svgAspect } from '../../lib/svg';
import { colors, radius } from '../../ui/theme';
import { SvgImage } from '../SvgImage';

// Product pictures are SVG from the API. They are fetched with the app's headers
// (so they work when the server needs a key) and kept for this run.

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX = 80;

export function loadSvg(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(path);
  if (!p) {
    p = api.svg(path).then((xml) => {
      if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
      cache.set(path, xml);
      return xml;
    }).finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  return p;
}

export function RemoteSvg({ path, label, style, aspect = 1.1 }: { path: string; label: string; style?: ViewStyle; aspect?: number }) {
  const [xml, setXml] = useState<string | null>(cache.get(path) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (cache.has(path)) setXml(cache.get(path)!);
    else loadSvg(path).then((x) => live && setXml(x)).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path]);
  if (!xml) {
    return (
      <View style={[styles.box, { aspectRatio: 1 / aspect }, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
        {failed ? null : <View style={styles.shimmer} />}
      </View>
    );
  }
  return <SvgImage xml={xml} aspect={svgAspect(xml)} label={label} style={style} />;
}

const styles = StyleSheet.create({
  box: { width: '100%', backgroundColor: '#eef0f4', borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  shimmer: { width: '40%', height: 6, borderRadius: 3, backgroundColor: colors.line },
});
