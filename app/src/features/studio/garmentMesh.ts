import * as THREE from 'three';
import type { Garment } from '../../api/types';

// Builds a simple 3D garment from the same flat pattern pieces the factory
// prints: each piece's outline becomes a mesh whose UVs map 1:1 onto that
// piece's artwork, so the 3D view always shows exactly the 2D panel art.

export const MM = 0.004; // world units per millimetre

export function parsePath(d: string, curveSteps = 10): [number, number][] {
  const tokens = d.match(/[MLCHVZmlchvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: [number, number][] = [];
  let i = 0;
  let cmd = '';
  let cur: [number, number] = [0, 0];
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M':
      case 'L':
        cur = [num(), num()];
        pts.push(cur);
        break;
      case 'H':
        cur = [num(), cur[1]];
        pts.push(cur);
        break;
      case 'V':
        cur = [cur[0], num()];
        pts.push(cur);
        break;
      case 'C': {
        const p0 = cur;
        const p1: [number, number] = [num(), num()];
        const p2: [number, number] = [num(), num()];
        const p3: [number, number] = [num(), num()];
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / curveSteps;
          const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t ** 2, e = t ** 3;
          pts.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
        }
        cur = p3;
        break;
      }
      case 'Z':
      case 'z':
        break;
      default:
        i++; // relative commands are not produced by the server
    }
  }
  // drop a closing duplicate
  if (pts.length > 1) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) pts.pop();
  }
  return pts;
}

function inside(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function nearestOnOutline(poly: [number, number][], x: number, y: number): [number, number] {
  let best: [number, number] = poly[0];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [px, py];
    }
  }
  return best;
}

/**
 * A regular grid clipped to the piece outline. Unlike a triangulated outline it
 * has interior vertices, so the body can curve smoothly, and it cannot leave
 * holes when the outline has near-duplicate points. Edge vertices are pulled
 * onto the outline so the silhouette stays smooth. Positions are in mm (x, y, 0).
 */
export function flatGeometry(outline: string, w: number, h: number, cols = 48): THREE.BufferGeometry {
  const poly = parsePath(outline);
  const rows = Math.max(4, Math.round((cols * h) / w));
  const idx = (c: number, r: number) => r * (cols + 1) + c;
  const pts: [number, number][] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) pts.push([(c / cols) * w, (r / rows) * h]);

  const used = new Set<number>();
  const tris: number[] = [];
  const addTri = (a: number, b: number, c: number) => {
    const cx = (pts[a][0] + pts[b][0] + pts[c][0]) / 3;
    const cy = (pts[a][1] + pts[b][1] + pts[c][1]) / 3;
    if (!inside(poly, cx, cy)) return;
    tris.push(a, b, c);
    used.add(a).add(b).add(c);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      addTri(idx(c, r), idx(c, r + 1), idx(c + 1, r));
      addTri(idx(c + 1, r), idx(c, r + 1), idx(c + 1, r + 1));
    }
  }
  for (const i of used) {
    const [x, y] = pts[i];
    if (!inside(poly, x, y)) pts[i] = nearestOnOutline(poly, x, y);
  }

  const position = new Float32Array(pts.length * 3);
  const uv = new Float32Array(pts.length * 2);
  pts.forEach(([x, y], i) => {
    position.set([x, y, 0], i * 3);
    uv.set([x / w, 1 - y / h], i * 2);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(tris);
  return geo;
}

/** Front or back body piece, curved around the torso. Back pieces are mirrored so they read correctly from behind. */
export function bodyGeometry(outline: string, w: number, h: number, side: 'front' | 'back', depthMm = 120): THREE.BufferGeometry {
  const geo = flatGeometry(outline, w, h);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const nx = (2 * x) / w - 1;
    const z = depthMm * Math.sqrt(Math.max(0, 1 - Math.min(1, nx * nx)));
    const X = (x - w / 2) * MM;
    pos.setXYZ(k, side === 'front' ? X : -X, -(y - h / 2) * MM, side === 'front' ? z * MM : -z * MM);
  }
  pos.needsUpdate = true;
  // Keep front faces pointing out of the garment on both sides.
  if (side === 'back') {
    const index = geo.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sleeve piece wrapped into a tube. The cap's top (middle of the piece) starts
 * at the body's shoulder point and the underarm seam (piece edges) meets the
 * body's underarm, the way a set-in sleeve is sewn.
 */
export function sleeveGeometry(
  outline: string, w: number, h: number, bodyW: number, bodyH: number, which: 'left' | 'right',
  shoulder: [number, number] = [480, 45],
) {
  const geo = flatGeometry(outline, w, h, 30);
  const pos = geo.attributes.position;
  const s = which === 'right' ? 1 : -1;
  const r = w / (2 * Math.PI);
  const dir = new THREE.Vector3(s, -0.55, 0).normalize();
  const up = new THREE.Vector3(0.55 * s, 1, 0).normalize();
  const out = new THREE.Vector3(0, 0, 1);
  // Shoulder point in body mm, mirrored for the left sleeve, then to world units.
  const sx = which === 'right' ? shoulder[0] : bodyW - shoulder[0];
  const shoulderW = new THREE.Vector3((sx - bodyW / 2) * MM, -(shoulder[1] - bodyH / 2) * MM, 0);
  const origin = shoulderW.clone().addScaledVector(up, -r * MM);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const theta = (x / w) * Math.PI * 2;
    const p = origin.clone()
      .addScaledVector(dir, y * MM)
      .addScaledVector(up, -Math.cos(theta) * r * MM)
      .addScaledVector(out, Math.sin(theta) * r * MM * -s);
    pos.setXYZ(k, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

export interface PanelShape {
  name: string;
  outline: string;
  width: number;
  height: number;
}

export function garmentGeometries(garment: Garment, panels: PanelShape[]): { name: string; geometry: THREE.BufferGeometry }[] {
  const body = panels.find((p) => p.name === 'front');
  return panels.map((p) => {
    if (p.name === 'front' || p.name === 'back') {
      return { name: p.name, geometry: bodyGeometry(p.outline, p.width, p.height, p.name, garment === 'shorts' ? 150 : 120) };
    }
    const which = p.name === 'sleeve_right' ? 'right' : 'left';
    return { name: p.name, geometry: sleeveGeometry(p.outline, p.width, p.height, body?.width ?? 540, body?.height ?? 720, which) };
  });
}
