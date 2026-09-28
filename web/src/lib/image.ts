import { MAX_LOGO_BYTES } from './api/types';
import { base64ToBytes } from './svg';

// Checks an uploaded logo from its bytes, not its file name or reported type:
// real format, byte size and pixel dimensions (needed for the DPI estimate).
// Ported from the mobile app (app/src/lib/image.ts) without Node's Buffer.

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/svg+xml';

export interface InspectedImage {
  mime: LogoMime;
  bytes: number;
  width: number | null;
  height: number | null;
  aspect: number;
  dataUrl: string;
}

export type ImageProblem = 'type' | 'size';

export function base64Bytes(b64: string): number {
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function sniffMime(buf: Uint8Array): LogoMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = new TextDecoder().decode(buf.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
  return null;
}

export function pngSize(buf: Uint8Array): [number, number] | null {
  if (buf.length < 24) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [dv.getUint32(16), dv.getUint32(20)];
}

export function jpegSize(buf: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [(buf[i + 7] << 8) | buf[i + 8], (buf[i + 5] << 8) | buf[i + 6]];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) i += 2;
    else i += 2 + len;
  }
  return null;
}

export function svgSize(text: string): { aspect: number } {
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(text);
  if (vb && Number(vb[1]) > 0) return { aspect: Number(vb[2]) / Number(vb[1]) };
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(text);
  const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(text);
  if (w && h && Number(w[1]) > 0) return { aspect: Number(h[1]) / Number(w[1]) };
  return { aspect: 1 };
}

/** Validates base64 image data (optionally a data URL) and describes it. */
export function inspectImage(b64: string): InspectedImage | ImageProblem {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  const bytes = base64Bytes(clean);
  let buf: Uint8Array;
  try {
    buf = base64ToBytes(clean);
  } catch {
    return 'type';
  }
  const mime = sniffMime(buf);
  if (!mime) return 'type';
  if (bytes > MAX_LOGO_BYTES) return 'size';
  let width: number | null = null;
  let height: number | null = null;
  let aspect = 1;
  if (mime === 'image/svg+xml') {
    aspect = svgSize(new TextDecoder().decode(buf)).aspect;
  } else {
    const dims = mime === 'image/png' ? pngSize(buf) : jpegSize(buf);
    if (dims) {
      [width, height] = dims;
      aspect = height / width;
    }
  }
  return { mime, bytes, width, height, aspect: Math.max(0.05, Math.min(20, aspect)), dataUrl: `data:${mime};base64,${clean}` };
}

export function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

/** Reads a File as base64 (no data: prefix). */
export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
