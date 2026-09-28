import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import { Share, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

export type ShareOutcome = 'shared' | 'copied' | 'unavailable';

/** Snapshots the rendered mock-up view to a PNG and opens the system share sheet. */
export async function shareImage(view: RefObject<View | null>, _svg: string, title: string): Promise<ShareOutcome> {
  if (!view.current || !(await Sharing.isAvailableAsync())) return 'unavailable';
  const uri = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: title, UTI: 'public.png' });
  return 'shared';
}

export async function shareText(text: string, title: string): Promise<ShareOutcome> {
  await Share.share({ message: text, title });
  return 'shared';
}
