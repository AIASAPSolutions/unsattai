import { useEffect, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { Panel } from '../../api/types';
import { svgDataUrl } from '../../lib/svg';

const TEX_W = 1024;

function rasterize(svg: string, w: number, h: number): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
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

/** Web: the browser rasterises each panel's SVG onto a canvas texture. */
export function usePanelTextures(panels: Panel[] | null): { textures: Record<string, THREE.Texture>; node: ReactNode; error: unknown } {
  const [textures, setTextures] = useState<Record<string, THREE.Texture>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!panels?.length) return;
    let live = true;
    Promise.all(panels.map(async (p) => [p.name, await rasterize(p.svg, p.width, p.height)] as const))
      .then((pairs) => live && setTextures(Object.fromEntries(pairs)))
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [panels]);
  return { textures, node: null, error };
}
