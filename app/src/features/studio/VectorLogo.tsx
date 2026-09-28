import { memo, useMemo } from 'react';
import { G, parse } from 'react-native-svg';
import { decodeDataUrl } from '../../lib/svg';

/**
 * Draws an SVG logo (data URL) inside the editor's SVG, fitted into its box.
 * The logo's own elements are inlined under a transform, which works on iOS,
 * Android and web alike (a nested <Image> cannot decode SVG on native).
 */
function VectorLogoImpl({ src, x, y, width, height }: { src: string; x: number; y: number; width: number; height: number }) {
  const ast = useMemo(() => {
    try {
      const decoded = decodeDataUrl(src);
      return decoded ? parse(decoded.text) : null;
    } catch {
      return null;
    }
  }, [src]);
  if (!ast) return null;
  const vb = String(ast.props?.viewBox ?? '').split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite)
    ? vb
    : [0, 0, Number(ast.props?.width) || width, Number(ast.props?.height) || height];
  const k = Math.min(width / vw, height / vh);
  const ox = x + (width - vw * k) / 2 - vx * k;
  const oy = y + (height - vh * k) / 2 - vy * k;
  return <G transform={`translate(${ox} ${oy}) scale(${k})`}>{ast.children}</G>;
}

export const VectorLogo = memo(VectorLogoImpl);
