import type { LauncherConfig } from '../../shared/config/launcher-config';
import {
  remoteHtmlToText,
  type BattlyNewsItem,
  type HomeSnapshot,
} from '../../shared/home/home-contract';
import type { RemoteJsonClient } from '../config/remote-json-client';
import type { MinecraftNewsService } from './minecraft-news-service';
import type { MinecraftNewsTranslator } from './minecraft-news-translator';
import { networkAvailable } from '../network/connectivity';

export interface HomeStatusUrls {
  readonly api: string;
  readonly members: string;
  readonly web: string;
}

export interface HomeServiceOptions {
  readonly configClient: RemoteJsonClient<LauncherConfig>;
  readonly fetchImplementation?: typeof fetch;
  readonly newsClient: RemoteJsonClient<readonly BattlyNewsItem[]>;
  readonly minecraftNewsService?: MinecraftNewsService;
  readonly minecraftNewsTranslator?: MinecraftNewsTranslator;
  readonly statusUrls: HomeStatusUrls;
  readonly timeoutMs?: number;
  readonly updated?: (snapshot: HomeSnapshot) => void;
}

function trustedStatusUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Home status URL is not trusted');
  }
  return url;
}

function warningFromConfig(config: LauncherConfig | null): HomeSnapshot['warning'] {
  if (!config || config.raw.adv !== true) {
    return { enabled: false, text: '', tone: 'warning' };
  }
  const toneValue = config.raw.advStatus;
  const tone =
    toneValue === 'danger' || toneValue === 'info' || toneValue === 'warning'
      ? toneValue
      : 'warning';
  const rawText = typeof config.raw.advText === 'string' ? config.raw.advText : '';
  return { enabled: true, text: remoteHtmlToText(rawText, 1000), tone };
}

export class HomeService {
  readonly #configClient: RemoteJsonClient<LauncherConfig>;
  readonly #fetch: typeof fetch;
  readonly #newsClient: RemoteJsonClient<readonly BattlyNewsItem[]>;
  readonly #minecraftNewsService: MinecraftNewsService | undefined;
  readonly #minecraftNewsTranslator: MinecraftNewsTranslator | undefined;
  #language = 'en';
  #translationRevision = 0;
  #minecraftOriginal: readonly BattlyNewsItem[] = [];
  readonly #statusUrls: { readonly api: URL; readonly members: URL; readonly web: URL };
  readonly #timeoutMs: number;

  #snapshot: HomeSnapshot = {
    news: [],
    minecraftNews: [],
    pendingNews: true,
    pendingMinecraftNews: true,
    onlineUsers: null,
    services: { api: null, web: null },
    warning: { enabled: false, text: '', tone: 'warning' },
  };
  #inFlight?: Promise<HomeSnapshot>;
  #loadedAt = 0;
  readonly #updated: (snapshot: HomeSnapshot) => void;

  constructor(options: HomeServiceOptions) {
    this.#updated = options.updated ?? (() => {});
    this.#configClient = options.configClient;
    this.#newsClient = options.newsClient;
    this.#minecraftNewsService = options.minecraftNewsService;
    this.#minecraftNewsTranslator = options.minecraftNewsTranslator;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#statusUrls = {
      api: trustedStatusUrl(options.statusUrls.api),
      members: trustedStatusUrl(options.statusUrls.members),
      web: trustedStatusUrl(options.statusUrls.web),
    };
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 100) {
      throw new TypeError('Home timeout must be at least 100 ms');
    }
  }

  load(language = 'en'): Promise<HomeSnapshot> {
    if (language !== this.#language) {
      this.#language = language;
      this.#localizeMinecraftNews();
    }
    if (this.#inFlight) {
      return this.#inFlight;
    }
    if (Date.now() - this.#loadedAt < 30_000) {
      return Promise.resolve(this.#snapshot);
    }
    this.#inFlight = this.#load().finally(() => {
      this.#inFlight = undefined;
      this.#loadedAt = Date.now();
    });
    return this.#inFlight;
  }

  #publish(patch: Partial<HomeSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    this.#updated(this.#snapshot);
  }

  #localizeMinecraftNews(): void {
    const revision = ++this.#translationRevision;
    const original = this.#minecraftOriginal;
    this.#publish({ minecraftNews: original });
    if (!this.#minecraftNewsTranslator || !original.length) {
      return;
    }
    void this.#minecraftNewsTranslator
      .translate(original, this.#language, (minecraftNews) => {
        if (revision === this.#translationRevision) {
          this.#publish({ minecraftNews });
        }
      })
      .catch(() => undefined);
  }

  async #load(): Promise<HomeSnapshot> {
    this.#publish({});
    // Validated disk caches are available without waiting for a remote timeout.
    if (!this.#loadedAt) {
      await Promise.all([
        this.#configClient.load({ offline: true }).then(
          (result) => this.#publish({ warning: warningFromConfig(result.data) }),
          () => {},
        ),
        this.#newsClient.load({ offline: true }).then(
          (result) => this.#publish({ news: result.data }),
          () => {},
        ),
        this.#minecraftNewsService?.cached?.().then((items) => {
          if (!items.length) {
            return;
          }
          this.#minecraftOriginal = items;
          this.#publish({ pendingMinecraftNews: false });
          this.#localizeMinecraftNews();
        }),
      ]);
    }
    // Publish each independent result immediately, including when there is no cache yet.
    await Promise.all([
      this.#configClient.load().then(
        (result) => this.#publish({ warning: warningFromConfig(result.data) }),
        () => {},
      ),
      this.#newsClient.load().then(
        (result) => this.#publish({ news: result.data, pendingNews: false }),
        () => this.#publish({ pendingNews: false }),
      ),
      this.#minecraftNewsService?.load().then(
        (minecraftNews) => {
          this.#minecraftOriginal = minecraftNews;
          this.#publish({ pendingMinecraftNews: false });
          this.#localizeMinecraftNews();
        },
        () => this.#publish({ pendingMinecraftNews: false }),
      ),
      this.#check(this.#statusUrls.api).then((api) =>
        this.#publish({ services: { ...this.#snapshot.services, api } }),
      ),
      this.#check(this.#statusUrls.web).then((web) =>
        this.#publish({ services: { ...this.#snapshot.services, web } }),
      ),
      this.#members().then((onlineUsers) => this.#publish({ onlineUsers })),
    ]);
    return this.#snapshot;
  }

  async #request(url: URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #check(url: URL): Promise<boolean | null> {
    if (!networkAvailable()) {
      return null;
    }
    try {
      const response = await this.#request(url);
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  async #members(): Promise<number | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.#membersAttempt();
      if (result !== null) {
        return result;
      }
    }
    return null;
  }

  async #membersAttempt(): Promise<number | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#statusUrls.members, {
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let length = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        length += result.value.byteLength;
        if (length > 64 * 1024) {
          await reader.cancel();
          return null;
        }
        chunks.push(Buffer.from(result.value));
      }
      const value = JSON.parse(Buffer.concat(chunks, length).toString('utf8')) as unknown;
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
      }
      const users = Object.getOwnPropertyDescriptor(value, 'usuarios')?.value as unknown;
      return typeof users === 'number' && Number.isSafeInteger(users) && users >= 0
        ? Math.min(users, 100_000_000)
        : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
