/** Web: picked files come back as blob: or data: URLs. */
export async function readAsBase64(uri: string): Promise<{ base64: string; size: number }> {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
  return { base64: dataUrl.replace(/^data:[^,]*,/, ''), size: blob.size };
}
