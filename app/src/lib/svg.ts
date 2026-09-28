import { Buffer } from 'buffer';

export function svgDataUrl(xml: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(xml, 'utf8').toString('base64')}`;
}

export function decodeDataUrl(dataUrl: string): { mime: string; text: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], text: Buffer.from(m[2], 'base64').toString('utf8') };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** viewBox aspect ratio (height / width) of an SVG string. */
export function svgAspect(xml: string): number {
  const m = /viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(xml);
  return m ? Number(m[4]) / Number(m[3]) : 1;
}
