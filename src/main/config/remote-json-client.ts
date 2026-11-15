import { isAbsolute, resolve } from 'node:path';

import { parseLegacyStorageDocument } from '../../shared/storage/legacy-storage';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { networkAvailable } from '../network/connectivity';
import { readBoundedResponse } from '../network/read-bounded-response';

const defaultMaxBytes = 2 * 1024 * 1024;
const defaultTimeoutMs = 10_000;

export class RemoteJsonUnavailableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RemoteJsonUnavailableError';
  }
}

export interface RemoteJsonClientOptions<T> {
  readonly allowLoopbackHttp?: boolean;
  readonly cachePath: string;
  readonly fetchImplementation?: typeof fetch;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly url: string;
  readonly validate: (value: unknown) => T;
}

export interface RemoteJsonLoadOptions {
  readonly offline?: boolean;
  readonly preferCache?: boolean;
}

export interface RemoteJsonResult<T> {
  readonly data: T;
  readonly source: 'cache' | 'network';
}

function validateRemoteUrl(value: string, allowLoopbackHttp: boolean): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && loopback)) {
    throw new TypeError('Remote JSON URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('Remote JSON URL must not contain credentials');
  }
  return url;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return resolved;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

export class RemoteJsonClient<T> {
  readonly #cachePath: string;
  readonly #fetch: typeof fetch;
  readonly #maxBytes: number;
  readonly #timeoutMs: number;
  readonly #url: URL;
  readonly #validate: (value: unknown) => T;
  #inFlight: Promise<RemoteJsonResult<T>> | null = null;

  public constructor(options: RemoteJsonClientOptions<T>) {
    if (!isAbsolute(options.cachePath)) {
      throw new TypeError('Remote JSON cachePath must be absolute');
    }
    this.#cachePath = resolve(options.cachePath);
    this.#url = validateRemoteUrl(options.url, options.allowLoopbackHttp === true);
    this.#validate = options.validate;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#maxBytes = normalizePositiveInteger(options.maxBytes, defaultMaxBytes, 'maxBytes');
    this.#timeoutMs = normalizePositiveInteger(options.timeoutMs, defaultTimeoutMs, 'timeoutMs');
  }

  public async load(options: RemoteJsonLoadOptions = {}): Promise<RemoteJsonResult<T>> {
    if (options.offline || !networkAvailable()) {
      return this.#loadCacheOrThrow();
    }
    if (options.preferCache) {
      try {
        return await this.#loadCacheOrThrow();
      } catch {
        /* First use needs a download. */
      }
    }
    if (this.#inFlight) {
      return this.#inFlight;
    }
    this.#inFlight = this.#loadOnline();
    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = null;
    }
  }

  async #loadOnline(): Promise<RemoteJsonResult<T>> {
    try {
      return await this.#loadNetwork();
    } catch (networkError) {
      try {
        return await this.#loadCacheOrThrow();
      } catch {
        if (networkError instanceof TypeError) {
          throw networkError;
        }
        throw new RemoteJsonUnavailableError('Remote JSON and cache are unavailable', {
          cause: networkError,
        });
      }
    }
  }

  async #loadNetwork(): Promise<RemoteJsonResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Remote JSON returned HTTP ${response.status}`);
      }
      const finalUrl = validateRemoteUrl(
        response.url || this.#url.toString(),
        this.#url.protocol === 'http:',
      );
      if (finalUrl.origin !== this.#url.origin) {
        throw new TypeError('Remote JSON redirected to another origin');
      }
      const rawText = await readBoundedResponse(response, this.#maxBytes);
      const rawValue = parseJson(rawText, 'Remote JSON response');
      const data = this.#validate(rawValue);
      const cacheValue = parseLegacyStorageDocument({ payload: rawValue }).values.payload;
      if (cacheValue === undefined) {
        throw new TypeError('Remote JSON cannot be cached safely');
      }
      await writeFileAtomically(this.#cachePath, `${JSON.stringify(cacheValue, null, 2)}\n`);
      return { data, source: 'network' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async #loadCacheOrThrow(): Promise<RemoteJsonResult<T>> {
    try {
      const content = await readBoundedRegularFile(this.#cachePath, this.#maxBytes);
      const rawValue = parseJson(content.toString('utf8'), 'Remote JSON cache');
      return { data: this.#validate(rawValue), source: 'cache' };
    } catch (error) {
      throw new RemoteJsonUnavailableError('Validated remote JSON cache is unavailable', {
        cause: error,
      });
    }
  }
}
