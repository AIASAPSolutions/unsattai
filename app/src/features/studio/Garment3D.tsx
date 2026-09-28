import { Component, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as THREE from 'three';
import type { Garment, Panel } from '../../api/types';
import { useT } from '../../i18n';
import { Banner } from '../../ui/Banner';
import { Loading } from '../../ui/States';
import { T } from '../../ui/Text';
import { colors, radius, space } from '../../ui/theme';
import { garmentGeometries } from './garmentMesh';
import { Canvas, useFrame } from './r3f';
import { usePanelTextures } from './textures';

class GLBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* the fallback explains; nothing else to do */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Model({ garment, panels, textures, view }: {
  garment: Garment; panels: Panel[]; textures: Record<string, THREE.Texture>; view: { yaw: number; pitch: number; zoom: number };
}) {
  const group = useRef<THREE.Group>(null);
  const geos = useMemo(
    () => garmentGeometries(garment, panels.map((p) => ({ name: p.name, outline: p.outline, width: p.width, height: p.height }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [garment, panels.map((p) => p.name).join()],
  );
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y += (view.yaw - g.rotation.y) * 0.25;
    g.rotation.x += (view.pitch - g.rotation.x) * 0.25;
    state.camera.position.z += (view.zoom - state.camera.position.z) * 0.25;
  });
  return (
    <group ref={group}>
      {geos.map(({ name, geometry }) => (
        <mesh key={name} geometry={geometry}>
          <meshStandardMaterial map={textures[name] ?? null} color={textures[name] ? '#ffffff' : '#d9dde5'}
            side={THREE.DoubleSide} roughness={0.85} metalness={0} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 3D preview built from the same print panels as the 2D editor. Drag turns the
 * garment, pinch zooms. If GL is unavailable the parent keeps the 2D view and
 * this shows why.
 */
export function Garment3D({ garment, panels, testID }: { garment: Garment; panels: Panel[] | null; testID?: string }) {
  const t = useT();
  const [view, setView] = useState({ yaw: 0.35, pitch: 0.08, zoom: 5.4 });
  const start = useRef(view);
  const { textures, node, error } = usePanelTextures(panels);

  const pan = Gesture.Pan().runOnJS(true).maxPointers(1)
    .onStart(() => { start.current = view; })
    .onUpdate((e) => setView({
      ...start.current,
      yaw: start.current.yaw + e.translationX * 0.012,
      pitch: Math.max(-0.6, Math.min(0.6, start.current.pitch + e.translationY * 0.006)),
    }));
  const pinch = Gesture.Pinch().runOnJS(true)
    .onStart(() => { start.current = view; })
    .onUpdate((e) => setView({ ...start.current, zoom: Math.max(3, Math.min(8, start.current.zoom / e.scale)) }));

  const fallback = <Banner tone="info" text={t('view3dFailed')} />;
  if (!panels) return <Loading label={t('loading')} />;
  return (
    <View testID={testID}>
      <GLBoundary fallback={fallback}>
        <View style={styles.stage}>
          {node}
          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <View style={StyleSheet.absoluteFill} collapsable={false}
              accessible accessibilityRole="image" accessibilityLabel={t('view3dHint')}>
              <Canvas camera={{ position: [0, 0, view.zoom], fov: 40 }} style={{ flex: 1 }}>
                <color attach="background" args={['#eef0f4']} />
                <ambientLight intensity={0.9} />
                <directionalLight position={[2, 3, 4]} intensity={1.4} />
                <directionalLight position={[-3, 1, -4]} intensity={0.6} />
                <Model garment={garment} panels={panels} textures={textures} view={view} />
              </Canvas>
            </View>
          </GestureDetector>
        </View>
      </GLBoundary>
      {error ? <Banner tone="warn" text={t('view3dFailed')} /> : null}
      <T variant="caption" style={{ textAlign: 'center', marginTop: space(2) }}>{t('view3dHint')}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bg },
});
