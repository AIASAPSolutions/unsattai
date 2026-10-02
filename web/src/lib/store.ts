'use client';
import { useSyncExternalStore } from 'react';

// A very small external store (subscribe / get / set) with a selector hook, plus
// optional persistence to IndexedDB. Designs can carry several MB of logo data URLs,
// which is too much for localStorage, so drafts go to IndexedDB (localStorage is the
// fallback when IndexedDB is unavailable, e.g. some private windows).

export interface Store<S> {
  get: () => S;
  set: (patch: Partial<S> | ((s: S) => Partial<S>)) => void;
  subscribe: (fn: () => void) => () => void;
  /** True once a persisted draft has been read (or there was none). */
  hydrated: () => boolean;
}

export function createStore<S extends object>(initial: S, persist?: { key: string; pick: (s: S) => Partial<S> }): Store<S> {
  let state = initial;
  let isHydrated = !persist;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const pendingKey = persist ? `unsattai.pending.${persist.key}` : '';
  const save = () => {
    if (!persist) return;
    const value = persist.pick(state);
    void kvSet(persist.key, value).then(() => {
      // The saved copy is now at least as new as one left behind by flush().
      if (!saveTimer) lsRemove(pendingKey);
    });
  };

  const store: Store<S> = {
    get: () => state,
    set: (patch) => {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      emit();
      if (persist && isHydrated) {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          save();
        }, 300);
      }
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    hydrated: () => isHydrated,
  };

  if (persist && typeof window !== 'undefined') {
    // Leaving the page (a full navigation, closing the tab) must not drop the last change
    // still waiting for its debounced save. IndexedDB writes started while a page unloads
    // may never finish, so the change is also written synchronously to localStorage and
    // picked up by the next page (when it fits there).
    const flush = () => {
      if (!saveTimer || !isHydrated) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.setItem(pendingKey, JSON.stringify(persist.pick(state)));
      } catch {
        /* too big for localStorage: rely on the IndexedDB write below */
      }
      void kvSet(persist.key, persist.pick(state));
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());

    kvGet<Partial<S>>(persist.key)
      .then((saved) => {
        const pending = lsGet<Partial<S>>(pendingKey);
        const value = pending ?? saved;
        if (value && typeof value === 'object') state = { ...state, ...value };
        if (pending) void kvSet(persist.key, pending).then(() => lsRemove(pendingKey));
      })
      .catch(() => undefined)
      .finally(() => {
        isHydrated = true;
        emit();
      });
  }
  return store;
}

export function useStore<S, T>(store: Store<S>, select: (s: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

export function useHydrated(store: Pick<Store<object>, 'subscribe' | 'hydrated'>): boolean {
  return useSyncExternalStore(store.subscribe, store.hydrated, () => false);
}

// ----------------------------------------------------------------- key-value persistence

const DB = 'unsattai';
const OS = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

/** One connection per page, so a save started while the page is being left needs no second open. */
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= openDbOnce();
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function openDbOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction(OS, 'readonly').objectStore(OS).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    try {
      const raw = localStorage.getItem(`unsattai.${key}`);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined;
    }
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OS, 'readwrite');
      tx.objectStore(OS).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`unsattai.${key}`, JSON.stringify(value));
    } catch {
      /* quota: the draft just isn't kept */
    }
  }
}

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Small per-browser values (edit keys of team entries, preferences). */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`unsattai.${key}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`unsattai.${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

/** Resolves once the persisted draft is loaded, so writes made right away are not overwritten by it. */
export function whenHydrated(store: Pick<Store<object>, 'subscribe' | 'hydrated'>): Promise<void> {
  if (store.hydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = store.subscribe(() => {
      if (store.hydrated()) {
        off();
        resolve();
      }
    });
  });
}
