/* eslint-disable @typescript-eslint/no-require-imports */


jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    isAvailableAsync: async () => true,
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void store.set(k, v),
    deleteItemAsync: async (k: string) => void store.delete(k),
  };
});

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    create() { files.set(this.uri, ''); }
    write(s: string) { files.set(this.uri, s); }
    delete() { files.delete(this.uri); }
    async text() { return files.get(this.uri) ?? ''; }
    async base64() { return Buffer.from(files.get(this.uri) ?? '').toString('base64'); }
  }
  return { File, Paths: { document: { uri: 'file:///doc' }, cache: { uri: 'file:///cache' } } };
});

jest.mock('expo-speech', () => ({
  speak: jest.fn(), stop: jest.fn(), getAvailableVoicesAsync: async () => [],
}));

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
