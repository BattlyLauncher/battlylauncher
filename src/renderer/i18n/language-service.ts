import { isSupportedLanguage, type SupportedLanguage } from '../../shared/languages';
export {
  supportedLanguages,
  isSupportedLanguage,
  type SupportedLanguage,
} from '../../shared/languages';
export type LanguageStrings = Readonly<Record<string, unknown>>;
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
interface Entry {
  strings: LanguageStrings;
  cachedAt: number;
  etag?: string;
}
const limit = 2 * 1024 * 1024,
  ttl = 86400000,
  prefix = 'battly.language.v2.';
function valid(value: unknown, depth = 0): value is LanguageStrings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12) {
    return false;
  }
  return Object.entries(value).every(
    ([key, item]) =>
      !['__proto__', 'constructor', 'prototype'].includes(key) &&
      key.length <= 500 &&
      (typeof item === 'string'
        ? item.length <= 20000
        : typeof item === 'number'
          ? Number.isFinite(item)
          : Array.isArray(item)
            ? item.length <= 2000 &&
              item.every((value) => typeof value === 'string' && value.length <= 20000)
            : valid(item, depth + 1)),
  );
}
export function mergeStrings(base: LanguageStrings, overrides: LanguageStrings): LanguageStrings {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      continue;
    }
    result[key] = valid(value) ? mergeStrings(valid(result[key]) ? result[key] : {}, value) : value;
  }
  return result;
}
/** Remote or saved catalogues must not blank labels, change their shape or lose interpolation slots. */
export function mergeTranslatedStrings(
  base: LanguageStrings,
  overrides: LanguageStrings,
): LanguageStrings {
  const accepted: Record<string, unknown> = {};
  const slots = (text: string) =>
    [...text.matchAll(/\{(?:\d+|[A-Za-z_]\w*)\}|%(?:\d+\$)?[sd]|%[A-Za-z_]\w*%/g)]
      .map((match) => match[0])
      .sort()
      .join('|');
  for (const [key, value] of Object.entries(overrides)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      continue;
    }
    const original = base[key];
    if (Array.isArray(original)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.length <= 2000 &&
        value.every(
          (item, index) =>
            typeof item === 'string' &&
            item.trim() &&
            item.length <= 20000 &&
            (typeof original[index] !== 'string' || slots(item) === slots(original[index])),
        )
      ) {
        accepted[key] = value;
      }
    } else if (valid(original)) {
      if (valid(value)) {
        accepted[key] = mergeTranslatedStrings(original, value);
      }
    } else if (typeof original === 'string') {
      if (typeof value === 'string' && value.trim() && slots(original) === slots(value)) {
        accepted[key] = value;
      }
    } else {
      accepted[key] = value;
    }
  }
  return mergeStrings(base, accepted);
}
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > limit) {
    throw new Error('Language pack too large');
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Empty language pack');
  }
  let size = 0,
    text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      size += chunk.value.byteLength;
      if (size > limit) {
        throw new Error('Language pack too large');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export class LanguageService {
  readonly #fallback: LanguageStrings;
  readonly #fetch: typeof fetch;
  readonly #storage: Storage | null;
  readonly #bundles: Partial<Record<SupportedLanguage, () => Promise<LanguageStrings>>>;
  readonly #cache = new Map<SupportedLanguage, Entry>();
  readonly #pending = new Map<SupportedLanguage, Promise<LanguageStrings>>();
  readonly #loading = new Map<SupportedLanguage, Promise<LanguageStrings>>();
  readonly #retry = new Map<SupportedLanguage, number>();
  readonly #checked = new Map<SupportedLanguage, number>();
  readonly #revisions = new Map<SupportedLanguage, number>();
  readonly #onUpdate: (language: SupportedLanguage, strings: LanguageStrings) => void;
  constructor(options: {
    bundledFallback: LanguageStrings;
    fetchImplementation?: typeof fetch;
    storage?: Storage | null;
    bundledLanguages?: Partial<Record<SupportedLanguage, () => Promise<LanguageStrings>>>;
    onUpdate?: (language: SupportedLanguage, strings: LanguageStrings) => void;
  }) {
    this.#fallback = options.bundledFallback;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#bundles = options.bundledLanguages ?? {};
    this.#onUpdate = options.onUpdate ?? (() => undefined);
    const storage = options.storage ?? null;
    this.#storage = storage;
  }
  async load(language: unknown): Promise<LanguageStrings> {
    if (!isSupportedLanguage(language)) {
      return this.#fallback;
    }
    const cached = this.#cache.get(language);
    if (cached) {
      if (Date.now() - cached.cachedAt > ttl) {
        void this.#refresh(language, cached);
      }
      return cached.strings;
    }
    const loading = this.#loading.get(language);
    if (loading) {
      return loading;
    }
    const task = (async () => {
      const bundle =
        (await this.#bundles[language]?.().catch(() => this.#fallback)) ?? this.#fallback;
      const saved = this.#read(language);
      const base = mergeStrings(this.#fallback, bundle);
      const revision = Number(bundle.version) || 0;
      this.#revisions.set(language, revision);
      const compatible = saved && (Number(saved.strings.version) || 0) >= revision;
      const entry = {
        strings: compatible ? mergeTranslatedStrings(base, saved.strings) : base,
        cachedAt: compatible ? saved.cachedAt : 0,
        etag: compatible ? saved.etag : undefined,
      };
      this.#cache.set(language, entry);
      if (Date.now() - entry.cachedAt > ttl) {
        void this.#refresh(language, entry);
      }
      return entry.strings;
    })().finally(() => this.#loading.delete(language));
    this.#loading.set(language, task);
    return task;
  }
  #read(language: SupportedLanguage): Entry | undefined {
    try {
      const raw = this.#storage?.getItem(prefix + language);
      if (!raw || raw.length > limit) {
        return;
      }
      const value = JSON.parse(raw) as Entry;
      if (
        !valid(value.strings) ||
        !Number.isFinite(value.cachedAt) ||
        value.cachedAt > Date.now() + 60000
      ) {
        return;
      }
      const entry = {
        strings: value.strings,
        cachedAt: value.cachedAt,
        etag: typeof value.etag === 'string' && value.etag.length < 256 ? value.etag : undefined,
      };
      return entry;
    } catch {
      return;
    }
  }
  /** Revalidate in the background without waiting for the 24-hour disk TTL. */
  async refresh(language: unknown): Promise<LanguageStrings> {
    if (!isSupportedLanguage(language)) {
      return this.#fallback;
    }
    await this.load(language);
    const cached = this.#cache.get(language)!;
    const pending = this.#pending.get(language);
    if (pending) {
      return pending;
    }
    if (Date.now() - (this.#checked.get(language) ?? 0) < 60000) {
      return cached.strings;
    }
    return this.#refresh(language, cached);
  }
  #refresh(language: SupportedLanguage, cached: Entry): Promise<LanguageStrings> {
    const pending = this.#pending.get(language);
    if (pending) {
      return pending;
    }
    if ((this.#retry.get(language) ?? 0) > Date.now()) {
      return Promise.resolve(cached.strings);
    }
    this.#checked.set(language, Date.now());
    const task = (async () => {
      try {
        let response = await this.#fetch(
          `https://api.battlylauncher.com/api/v2/launcher/locales/${language}`,
          {
            redirect: 'error',
            cache: 'no-cache',
            signal: AbortSignal.timeout(4000),
            headers: {
              accept: 'application/json',
              ...(cached.etag ? { 'if-none-match': cached.etag } : {}),
            },
          },
        );
        if (response.status === 404) {
          await response.body?.cancel();
          response = await this.#fetch(
            `https://api.battlylauncher.com/launcher/langs/${language}`,
            {
              redirect: 'error',
              cache: 'no-cache',
              signal: AbortSignal.timeout(4000),
              headers: { accept: 'application/json' },
            },
          );
        }
        let strings = cached.strings;
        if (response.status !== 304) {
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error('Language unavailable');
          }
          const body = await boundedJson(response);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('Invalid language');
          }
          const data = body as Record<string, unknown>;
          if (data.language && data.language !== language) {
            throw new Error('Wrong language');
          }
          const incoming = data.strings ?? body;
          if (
            data.error ||
            !valid(incoming) ||
            !Object.keys(incoming).some((key) => key !== 'version')
          ) {
            throw new Error('Invalid strings');
          }
          if (
            (Number(incoming.version ?? data.version) || 0) >= (this.#revisions.get(language) ?? 0)
          ) {
            strings = mergeTranslatedStrings(cached.strings, incoming);
          }
        }
        const entry = {
          strings,
          cachedAt: Date.now(),
          etag: response.headers.get('etag') ?? cached.etag,
        };
        this.#cache.set(language, entry);
        try {
          const encoded = JSON.stringify(entry);
          if (encoded.length <= limit) {
            this.#storage?.setItem(prefix + language, encoded);
          }
        } catch {
          /* Quota */
        }
        this.#onUpdate(language, strings);
        return strings;
      } catch {
        this.#retry.set(language, Date.now() + 60000);
        return cached.strings;
      } finally {
        this.#pending.delete(language);
      }
    })();
    this.#pending.set(language, task);
    return task;
  }
}
