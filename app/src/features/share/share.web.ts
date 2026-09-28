import * as Clipboard from 'expo-clipboard';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'unavailable';

async function svgToPng(svg: string, width = 1200): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    });
    const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Web: rasterises the mock-up SVG; uses the Web Share API when it accepts files, otherwise downloads the PNG. */
export async function shareImage(_view: RefObject<View | null>, svg: string, title: string): Promise<ShareOutcome> {
  const blob = await svgToPng(svg);
  const file = new File([blob], 'urjersey-design.png', { type: 'image/png' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'shared';
}

export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    await navigator.share({ text, title });
    return 'shared';
  }
  await Clipboard.setStringAsync(text);
  return 'copied';
}
