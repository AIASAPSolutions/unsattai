import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes a text file to the cache and hands it to the share sheet (Save to Files, Drive, mail…). */
export async function saveTextFile(name: string, text: string, mimeType: string): Promise<'shared' | 'unavailable'> {
  const file = new File(Paths.cache, name.replace(/[^\w.-]/g, '_'));
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  return 'shared';
}
