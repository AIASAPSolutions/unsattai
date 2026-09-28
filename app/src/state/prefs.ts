import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LANGUAGES, type Customer, type Language } from '../api/types';
import { safeStorage } from './storage';

function deviceLanguage(): Language {
  try {
    const code = getLocales()[0]?.languageCode ?? 'en';
    return (LANGUAGES as readonly string[]).includes(code) ? (code as Language) : 'en';
  } catch {
    return 'en';
  }
}

interface PrefsState {
  language: Language;
  voiceGuide: boolean;
  rememberCustomer: boolean;
  /** Only name, phone and email, and only when the customer opted in. */
  customer: Customer | null;
  setLanguage: (l: Language) => void;
  setVoiceGuide: (on: boolean) => void;
  setRememberCustomer: (on: boolean, customer?: Customer) => void;
  saveCustomer: (c: Customer) => void;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      language: deviceLanguage(),
      voiceGuide: false,
      rememberCustomer: false,
      customer: null,
      setLanguage: (language) => set({ language }),
      setVoiceGuide: (voiceGuide) => set({ voiceGuide }),
      setRememberCustomer: (on, customer) =>
        set({ rememberCustomer: on, customer: on ? customer ?? get().customer : null }),
      saveCustomer: (c) => {
        if (get().rememberCustomer) set({ customer: { name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() } });
      },
    }),
    { name: 'urjersey.prefs', storage: safeStorage, version: 1 },
  ),
);
