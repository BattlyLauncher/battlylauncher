import {
  dialog as electronDialog,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type MessageBoxOptions,
  type BrowserWindow,
} from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTextTranslator } from '../../shared/catalog-text';
import { isSupportedLanguage } from '../../shared/languages';

type Translator = (source: string) => string;
const cache = new Map<string, Promise<Translator>>();
function flatten(
  value: Record<string, unknown>,
  prefix = '',
  result = new Map<string, string>(),
): Map<string, string> {
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result.set(prefix + key, entry);
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      flatten(entry as Record<string, unknown>, prefix + key + '.', result);
    }
  }
  return result;
}
export function nativeTranslator(language: string): Promise<Translator> {
  const selected = isSupportedLanguage(language) ? language : 'es';
  const existing = cache.get(selected);
  if (existing) {
    return existing;
  }
  const pending = Promise.all(
    ['es', selected].map(async (code) =>
      flatten(
        JSON.parse(await readFile(join(__dirname, 'locales', `${code}.json`), 'utf8')) as Record<
          string,
          unknown
        >,
      ),
    ),
  )
    .then(([source, target]) => {
      const priority = (key: string) =>
        /^(reviewedCopy|interface|modalCopy|gameSettings)\./.test(key)
          ? 0
          : key.startsWith('modalFallback.')
            ? 2
            : 1;
      const entries = new Map<string, string>();
      for (const [key, text] of [...source].sort(([a], [b]) => priority(a) - priority(b))) {
        if (!entries.has(text)) {
          entries.set(text, target.get(key) ?? text);
        }
      }
      return createTextTranslator(entries);
    })
    .catch((error) => {
      cache.delete(selected);
      throw error;
    });
  cache.set(selected, pending);
  return pending;
}

export function translateDialogOptions<
  T extends OpenDialogOptions | SaveDialogOptions | MessageBoxOptions,
>(options: T, translate: Translator): T {
  const result = { ...options };
  for (const key of ['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel'] as const) {
    if (key in result) {
      const text = (result as Record<string, unknown>)[key];
      if (typeof text === 'string') {
        (result as Record<string, unknown>)[key] = translate(text);
      }
    }
  }
  if ('buttons' in result && result.buttons) {
    result.buttons = result.buttons.map(translate);
  }
  if ('filters' in result && result.filters) {
    result.filters = result.filters.map((filter) => ({ ...filter, name: translate(filter.name) }));
  }
  return result;
}

/** Translate only application labels; paths, default filenames and identifiers stay intact. */
export function localizedDialogs(readLanguage: () => Promise<string>) {
  async function options<T extends OpenDialogOptions | SaveDialogOptions | MessageBoxOptions>(
    value: T,
  ): Promise<T> {
    return translateDialogOptions(value, await nativeTranslator(await readLanguage()));
  }
  return {
    async showOpenDialog(
      ownerOrOptions: BrowserWindow | OpenDialogOptions,
      value?: OpenDialogOptions,
    ) {
      return value
        ? electronDialog.showOpenDialog(ownerOrOptions as BrowserWindow, await options(value))
        : electronDialog.showOpenDialog(await options(ownerOrOptions as OpenDialogOptions));
    },
    async showSaveDialog(
      ownerOrOptions: BrowserWindow | SaveDialogOptions,
      value?: SaveDialogOptions,
    ) {
      return value
        ? electronDialog.showSaveDialog(ownerOrOptions as BrowserWindow, await options(value))
        : electronDialog.showSaveDialog(await options(ownerOrOptions as SaveDialogOptions));
    },
    async showMessageBox(
      ownerOrOptions: BrowserWindow | MessageBoxOptions,
      value?: MessageBoxOptions,
    ) {
      return value
        ? electronDialog.showMessageBox(ownerOrOptions as BrowserWindow, await options(value))
        : electronDialog.showMessageBox(await options(ownerOrOptions as MessageBoxOptions));
    },
  };
}
