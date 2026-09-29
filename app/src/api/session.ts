import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// The customer's sign-in token. Like the API key it lives in the device's secure
// storage (Keychain / Keystore) and is never written to AsyncStorage or the draft
// files. Web has no secure store, so there it is kept in memory for this tab only.

const TOKEN_KEY = 'urjersey.session';

let cached: string | null | undefined;
let memory: string | null = null;

async function secureAvailable(): Promise<boolean> {
  try {
    return Platform.OS !== 'web' && (await SecureStore.isAvailableAsync());
  } catch {
    return false;
  }
}

export async function getSessionToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await secureAvailable()) ? await SecureStore.getItemAsync(TOKEN_KEY) : memory;
  } catch {
    cached = null;
  }
  return cached;
}

export async function setSessionToken(token: string | null): Promise<void> {
  const value = token?.trim() || null;
  cached = value;
  if (await secureAvailable()) {
    try {
      if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      /* the token still works for this run */
    }
  } else {
    memory = value;
  }
}

/** Tests only: forget the in-memory copy so the next read goes to storage. */
export function resetSessionCache(): void {
  cached = undefined;
}
