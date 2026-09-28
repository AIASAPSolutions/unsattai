// Pictures from image AI tools and phone cameras are often 2-12 MB. The server only needs
// enough detail to recognise colours and shapes, so send at most 1600 px as JPEG.
export const MAX_SIDE = 1600;

export function targetSize(width: number, height: number): { width: number; height: number } | null {
  if (!width || !height || Math.max(width, height) <= MAX_SIDE) return null;
  return width >= height
    ? { width: MAX_SIDE, height: Math.round((height / width) * MAX_SIDE) }
    : { width: Math.round((width / height) * MAX_SIDE), height: MAX_SIDE };
}

/** Browser only: decode, shrink and re-encode a picked picture as a JPEG data URL. */
export async function preparePicture(file: File): Promise<{ dataUrl: string; aspect: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('type');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const size = targetSize(w, h) ?? { width: w, height: h };
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), aspect: h / w };
  } finally {
    URL.revokeObjectURL(url);
  }
}
