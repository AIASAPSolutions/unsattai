import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Where the UrJersey API lives, in priority order:
//   1. the URL saved on the Settings screen
//   2. EXPO_PUBLIC_API_URL at build/start time
//   3. expo.extra.apiUrl in app.json
//   4. a development default: the machine running the Expo dev server on port 8000
//      (Android emulator: 10.0.2.2, iOS simulator and web: localhost)
// The API key is never bundled: it is typed on the Settings screen and kept in
// the device's secure storage (Keychain / Keystore).

const URL_KEY = 'urjersey.apiUrl';
const API_KEY_KEY = 'urjersey.apiKey';
const API_PORT = 8000;

let cachedUrl: string | null = null;
let cachedKey: string | null | undefined;
let memoryKey: string | null = null;

export function normalizeUrl(url: string): string {
  const trimmed = String(url ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function isValidUrl(url: string): boolean {
  return /^https?:\/\/[^\s/:]+(:\d{1,5})?(\/[^\s]*)?$/i.test(normalizeUrl(url));
}

export function devDefaultUrl(
  os: string = Platform.OS,
  hostUri: string | undefined = Constants.expoConfig?.hostUri,
  isDevice: boolean = Constants.isDevice ?? false,
): string {
  const host = hostUri?.split(':')[0];
  if (os === 'android') {
    // A physical Android phone reaches the dev machine by its LAN address; the emulator by 10.0.2.2.
    if (isDevice && host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:${API_PORT}`;
    return `http://10.0.2.2:${API_PORT}`;
  }
  if (os === 'ios' && isDevice && host && host !== 'localhost') return `http://${host}:${API_PORT}`;
  return `http://localhost:${API_PORT}`;
}

export function configuredUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  const extra = (Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined)?.apiUrl;
  const pick = [env, extra].find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return normalizeUrl(pick ?? '') || devDefaultUrl();
}

export async function loadApiUrl(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(URL_KEY);
    cachedUrl = saved ? normalizeUrl(saved) : configuredUrl();
  } catch {
    cachedUrl = configuredUrl();
  }
  return cachedUrl;
}

export function getApiUrl(): string {
  return cachedUrl ?? configuredUrl();
}

export async function setApiUrl(url: string | null): Promise<void> {
  if (url && url.trim()) {
    cachedUrl = normalizeUrl(url);
    await AsyncStorage.setItem(URL_KEY, cachedUrl);
  } else {
    cachedUrl = configuredUrl();
    await AsyncStorage.removeItem(URL_KEY);
  }
}

async function secureAvailable(): Promise<boolean> {
  try {
    return Platform.OS !== 'web' && (await SecureStore.isAvailableAsync());
  } catch {
    return false;
  }
}

export async function getApiKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  cachedKey = (await secureAvailable()) ? await SecureStore.getItemAsync(API_KEY_KEY) : memoryKey;
  return cachedKey;
}

export async function setApiKey(key: string | null): Promise<void> {
  const value = key?.trim() || null;
  cachedKey = value;
  if (await secureAvailable()) {
    if (value) await SecureStore.setItemAsync(API_KEY_KEY, value);
    else await SecureStore.deleteItemAsync(API_KEY_KEY);
  } else {
    // Web has no secure keystore; keep the key for this session only.
    memoryKey = value;
  }
}
