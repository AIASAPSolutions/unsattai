// Browser-safe (no Buffer) SVG and base64 helpers.

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function svgDataUrl(xml: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(xml)}`;
}

export function decodeDataUrl(dataUrl: string): { mime: string; text: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], text: new TextDecoder().decode(base64ToBytes(m[2])) };
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** viewBox aspect ratio (height / width) of an SVG string. */
export function svgAspect(xml: string): number {
  const m = /viewBox="([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(xml);
  return m ? Number(m[4]) / Number(m[3]) : 1;
}
