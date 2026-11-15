const values = new Map<string, string>();
let initializing: Promise<void> | undefined;

/** Synchronous UI reads from memory; persistence is performed only by the main process. */
export const privateStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: (key) => values.get(key) ?? null,
  setItem(key, value) {
    values.set(key, String(value));
    void window.battly.setPrivatePreference(key, String(value)).catch(() => {
      window.dispatchEvent(new Event('private-storage-error'));
    });
  },
  removeItem(key) {
    values.delete(key);
    void window.battly
      .setPrivatePreference(key, null)
      .catch(() => window.dispatchEvent(new Event('private-storage-error')));
  },
};

export function initializePrivatePreferences(): Promise<void> {
  return (initializing ??= (async () => {
    const legacy = Object.create(null) as Record<string, string>;
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null) {
        legacy[key] = window.localStorage.getItem(key)!;
      }
    }
    const stored = await window.battly.migratePrivatePreferences(legacy);
    for (const [key, value] of Object.entries(stored)) {
      values.set(key, value);
    }
    // Remove old copies only after the encrypted write has succeeded.
    for (const key of Object.keys(legacy)) {
      window.localStorage.removeItem(key);
    }
  })());
}
