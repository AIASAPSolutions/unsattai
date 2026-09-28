import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

// Small preferences live in AsyncStorage. The design draft can carry several
// logo images (up to 1.5 MB each), which is past Android's AsyncStorage row
// limit, so on native it is written to a file in the app's document folder.
// Storage failures (full disk, private browsing) never crash the app: the
// draft just isn't kept.

const asyncStore: StateStorage = {
  getItem: async (k) => {
    try {
      return await AsyncStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: async (k, v) => {
    try {
      await AsyncStorage.setItem(k, v);
    } catch {
      /* keep working in memory */
    }
  },
  removeItem: async (k) => {
    try {
      await AsyncStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const fileFor = (k: string) => new File(Paths.document, `${k.replace(/[^a-z0-9._-]/gi, '_')}.json`);

const fileStore: StateStorage = {
  getItem: async (k) => {
    try {
      const f = fileFor(k);
      return f.exists ? await f.text() : null;
    } catch {
      return null;
    }
  },
  setItem: async (k, v) => {
    try {
      const f = fileFor(k);
      if (!f.exists) f.create();
      f.write(v);
    } catch {
      /* keep working in memory */
    }
  },
  removeItem: async (k) => {
    try {
      const f = fileFor(k);
      if (f.exists) f.delete();
    } catch {
      /* ignore */
    }
  },
};

export const safeStorage = createJSONStorage(() => asyncStore);
export const draftStorage = createJSONStorage(() => (Platform.OS === 'web' ? asyncStore : fileStore));
