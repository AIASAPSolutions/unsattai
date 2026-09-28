import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as THREE from 'three';
import type { Panel } from '../../api/types';

const TEX_W = 768;

/**
 * Native: GL cannot read SVG, so each panel's print art is drawn by
 * react-native-svg into a hidden view, snapshotted to PNG, and loaded as a
 * texture. The hidden views sit behind the opaque GL canvas.
 */
export function usePanelTextures(panels: Panel[] | null): { textures: Record<string, THREE.Texture>; node: ReactNode; error: unknown } {
  const refs = useRef<Record<string, View | null>>({});
  const [textures, setTextures] = useState<Record<string, THREE.Texture>>({});
  const [error, setError] = useState<unknown>(null);
  const key = panels?.map((p) => p.svg.length + p.name).join('|') ?? '';

  useEffect(() => {
    if (!panels?.length) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const loader = new THREE.TextureLoader();
        const next: Record<string, THREE.Texture> = {};
        for (const p of panels) {
          const view = refs.current[p.name];
          if (!view) continue;
          const uri = await captureRef(view, { format: 'png', result: 'tmpfile' });
          next[p.name] = await new Promise<THREE.Texture>((res, rej) => loader.load(uri, res, undefined, rej));
          next[p.name].colorSpace = THREE.SRGBColorSpace;
        }
        if (live) setTextures(next);
      } catch (e) {
        if (live) setError(e);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const node = (
    <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      {panels?.map((p) => (
        <View key={p.name} ref={(r) => { refs.current[p.name] = r; }} collapsable={false}
          style={{ width: TEX_W, height: (TEX_W * p.height) / p.width, backgroundColor: '#ffffff' }}>
          <SvgXml xml={p.svg} width="100%" height="100%" />
        </View>
      ))}
    </View>
  );
  return { textures, node, error };
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 0, left: 0, zIndex: -1 },
});
