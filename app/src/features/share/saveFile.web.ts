/** Web: downloads the file. */
export async function saveTextFile(name: string, text: string, mimeType: string): Promise<'shared' | 'unavailable'> {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'shared';
}
