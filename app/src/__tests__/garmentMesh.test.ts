import { flatGeometry, garmentGeometries, parsePath } from '../features/studio/garmentMesh';

const BODY = 'M180,0 C185,70 235,90 270,90 C305,90 355,70 360,0 L480,45 C470,120 470,200 540,240 L540,720 L0,720 L0,240 C70,200 70,120 60,45 Z';
const SLEEVE = 'M0,150 C60,40 160,0 230,0 C300,0 400,40 460,150 L410,260 L50,260 Z';

function polyArea(pts: [number, number][]) {
  let a = 0;
  pts.forEach(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  });
  return Math.abs(a) / 2;
}

function meshArea(outline: string, w: number, h: number) {
  const g = flatGeometry(outline, w, h);
  const p = g.attributes.position;
  const idx = g.getIndex()!;
  let a = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const [i0, i1, i2] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    a += Math.abs((p.getX(i1) - p.getX(i0)) * (p.getY(i2) - p.getY(i0)) - (p.getX(i2) - p.getX(i0)) * (p.getY(i1) - p.getY(i0))) / 2;
  }
  return a;
}

describe('3D garment mesh', () => {
  it('covers each pattern piece without holes', () => {
    for (const [d, w, h] of [[BODY, 540, 720], [SLEEVE, 460, 260]] as const) {
      const ratio = meshArea(d, w, h) / polyArea(parsePath(d));
      expect(ratio).toBeGreaterThan(0.97);
      expect(ratio).toBeLessThan(1.03);
    }
  });

  it('builds front, back and both sleeves with UVs inside the texture', () => {
    const geos = garmentGeometries('jersey', [
      { name: 'front', outline: BODY, width: 540, height: 720 }, { name: 'back', outline: BODY, width: 540, height: 720 },
      { name: 'sleeve_left', outline: SLEEVE, width: 460, height: 260 }, { name: 'sleeve_right', outline: SLEEVE, width: 460, height: 260 },
    ]);
    expect(geos.map((g) => g.name)).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right']);
    for (const { geometry } of geos) {
      const uv = geometry.attributes.uv.array as Float32Array;
      expect(Math.min(...uv)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...uv)).toBeLessThanOrEqual(1);
    }
  });
});
