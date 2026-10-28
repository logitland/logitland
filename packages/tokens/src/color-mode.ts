/** Where the web app (mode-watcher) and the docs (Svartz) both keep the reader's colour mode: Svartz's own key. */
export const COLOR_MODE_KEY = 'svartz:color-mode';

/** The part of the DOM's `Storage` this uses; the package builds without the DOM library. */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Moves a colour mode the web app saved before the docs shared its key (`mode-watcher-mode`) to the shared key, unless
 * the shared key is already set. Self-contained, because it ships as the inline script below.
 */
export function migrateColorMode(storage: KeyValueStorage) {
  const shared = 'svartz:color-mode';
  const legacy = 'mode-watcher-mode';
  const mode = storage.getItem(legacy);
  if (mode === null) return;
  if (storage.getItem(shared) === null) storage.setItem(shared, mode);
  storage.removeItem(legacy);
}

/**
 * `migrateColorMode` as an inline `<head>` script. Both apps render it before their own colour-mode script reads
 * the key, so the first page someone opens after the change, web or docs, already shows their saved mode.
 */
export const MIGRATE_COLOR_MODE_SCRIPT = `try{(${migrateColorMode})(localStorage)}catch{}`;
