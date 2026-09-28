import { File } from 'expo-file-system';

/** Reads a picked file (file:// or content:// URI) as base64 plus its byte size. */
export async function readAsBase64(uri: string): Promise<{ base64: string; size: number }> {
  const f = new File(uri);
  const base64 = await f.base64();
  return { base64, size: f.size ?? 0 };
}
