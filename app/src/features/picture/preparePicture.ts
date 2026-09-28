import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Pictures from image AI tools and phone cameras are often 2-12 MB. The server only
// needs enough detail to recognise colours and shapes, so send at most 1600 px as JPEG.
export const MAX_SIDE = 1600;

export function targetSize(width: number, height: number): { width: number; height: number } | null {
  if (!width || !height || Math.max(width, height) <= MAX_SIDE) return null;
  return width >= height
    ? { width: MAX_SIDE, height: Math.round((height / width) * MAX_SIDE) }
    : { width: Math.round((width / height) * MAX_SIDE), height: MAX_SIDE };
}

export async function preparePicture(uri: string, width: number, height: number): Promise<{ dataUrl: string; uri: string }> {
  const ctx = ImageManipulator.manipulate(uri);
  const size = targetSize(width, height);
  if (size) ctx.resize(size);
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!out.base64) throw new Error('picture could not be read');
  return { dataUrl: `data:image/jpeg;base64,${out.base64}`, uri: out.uri };
}
