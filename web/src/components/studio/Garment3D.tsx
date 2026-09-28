'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Banner, Loading } from '@/components/ui';
import { useT } from '@/i18n/provider';
import type { Garment, Panel } from '@/lib/api/types';
import { garmentGeometries } from '@/lib/garmentMesh';
import { svgDataUrl } from '@/lib/svg';
import s from './studio.module.css';

const TEX_W = 1024;

function rasterize(svg: string, w: number, h: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = Math.round((TEX_W * h) / w);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d context'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      resolve(tex);
    };
    img.onerror = () => reject(new Error('panel art could not be drawn'));
    img.src = svgDataUrl(svg);
  });
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * 3D preview built from the same print panels as the 2D editor (mesh code ported from
 * the app's garmentMesh.ts). Drag to turn, scroll to zoom, arrow keys to turn. Without
 * WebGL the parent keeps the 2D view and this explains why.
 */
export function Garment3D({ garment, panels, onUnavailable }: { garment: Garment; panels: Panel[] | null; onUnavailable?: () => void }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef({ yaw: 0.35, pitch: 0.08, zoom: 5.4 });
  const [glOk] = useState(() => webglAvailable());
  const [failed, setFailed] = useState(!glOk);
  const [texError, setTexError] = useState(false);

  useEffect(() => {
    if (!glOk) {
      onUnavailable?.();
      return;
    }
    if (!panels?.length || !host.current) return;
    const el = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      // WebGL exists but the context could not be created (blocked GPU, lost driver).
      queueMicrotask(() => setFailed(true));
      onUnavailable?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#eef0f4');
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('data-testid', 'canvas-3d');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, view.current.zoom);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.4);
    d1.position.set(2, 3, 4);
    scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
    d2.position.set(-3, 1, -4);
    scene.add(d2);
    const group = new THREE.Group();
    scene.add(group);

    const geos = garmentGeometries(garment, panels.map((p) => ({ name: p.name, outline: p.outline, width: p.width, height: p.height })));
    const materials: THREE.MeshStandardMaterial[] = [];
    for (const { name, geometry } of geos) {
      const m = new THREE.MeshStandardMaterial({ color: '#d9dde5', side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
      materials.push(m);
      const mesh = new THREE.Mesh(geometry, m);
      mesh.name = name;
      group.add(mesh);
    }
    let live = true;
    const textures: THREE.Texture[] = [];
    Promise.all(panels.map(async (p) => [p.name, await rasterize(p.svg, p.width, p.height)] as const))
      .then((pairs) => {
        if (!live) return;
        const byName = Object.fromEntries(pairs);
        geos.forEach(({ name }, i) => {
          const tex = byName[name];
          if (tex) {
            textures.push(tex);
            materials[i].map = tex;
            materials[i].color.set('#ffffff');
            materials[i].needsUpdate = true;
          }
        });
      })
      .catch(() => live && setTexError(true));

    const resize = () => {
      const w = el.clientWidth || 400;
      renderer.setSize(w, w, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const tick = () => {
      const v = view.current;
      group.rotation.y += (v.yaw - group.rotation.y) * 0.2;
      group.rotation.x += (v.pitch - group.rotation.x) * 0.2;
      camera.position.z += (v.zoom - camera.position.z) * 0.2;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, yaw: view.current.yaw, pitch: view.current.pitch };
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      view.current.yaw = drag.yaw + (e.clientX - drag.x) * 0.012;
      view.current.pitch = Math.max(-0.6, Math.min(0.6, drag.pitch + (e.clientY - drag.y) * 0.006));
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = Math.max(3, Math.min(8, view.current.zoom + e.deltaY * 0.004));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') view.current.yaw -= 0.2;
      else if (e.key === 'ArrowRight') view.current.yaw += 0.2;
      else if (e.key === 'ArrowUp') view.current.pitch = Math.max(-0.6, view.current.pitch - 0.1);
      else if (e.key === 'ArrowDown') view.current.pitch = Math.min(0.6, view.current.pitch + 0.1);
      else if (e.key === '+' || e.key === '=') view.current.zoom = Math.max(3, view.current.zoom - 0.3);
      else if (e.key === '-') view.current.zoom = Math.min(8, view.current.zoom + 0.3);
      else return;
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('keydown', key);
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
      onUnavailable?.();
    };
    renderer.domElement.addEventListener('webglcontextlost', lost);

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('keydown', key);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      geos.forEach(({ geometry }) => geometry.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((x) => x.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [garment, panels, onUnavailable, glOk]);

  if (failed) return <Banner tone="info" testId="view-3d-unavailable">{t('view3dFailed')}</Banner>;
  if (!panels) return <Loading label={t('loading')} />;
  return (
    <div>
      <div ref={host} className={s.stage3d} tabIndex={0} role="img" aria-label={t('view3dHintWeb')} data-testid="stage-3d" />
      {texError ? <Banner tone="warn">{t('view3dFailed')}</Banner> : null}
      <p className={s.hint}>{t('view3dHintWeb')}</p>
    </div>
  );
}
