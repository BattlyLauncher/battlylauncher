import { RemoteJsonClient } from '../config/remote-json-client';

interface Recommendations {
  readonly modrinth: readonly string[];
  readonly curseforge: readonly string[];
}

const initialRecommendations: Recommendations = {
  modrinth: ['AANobbMI', 'YL57xq9U', 'oePruTVg'],
  curseforge: [],
};

export function validateRecommendations(value: unknown): Recommendations {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Invalid recommendations');
  }
  const result = {} as Record<keyof Recommendations, string[]>;
  for (const provider of ['modrinth', 'curseforge'] as const) {
    const ids: unknown = (value as Record<string, unknown>)[provider];
    const pattern = provider === 'modrinth' ? /^[A-Za-z0-9]{8}$/ : /^[1-9][0-9]{0,9}$/;
    if (
      !Array.isArray(ids) ||
      ids.length > 200 ||
      !ids.every((id) => typeof id === 'string' && pattern.test(id))
    ) {
      throw new TypeError('Invalid recommended project IDs');
    }
    result[provider] = [...new Set(ids as string[])];
  }
  return result;
}

export class RecommendedMods {
  private readonly client: RemoteJsonClient<Recommendations>;
  private current = initialRecommendations;
  private refreshAt = 0;
  private pending?: Promise<Recommendations>;

  constructor(
    cachePath: string,
    request: typeof fetch = fetch,
    endpoint = 'https://api.battlylauncher.com/api/mods/recommended',
  ) {
    this.client = new RemoteJsonClient({
      url: endpoint,
      cachePath,
      fetchImplementation: request,
      allowLoopbackHttp: true,
      timeoutMs: 1500,
      maxBytes: 16384,
      validate: validateRecommendations,
    });
  }

  async load(): Promise<Recommendations> {
    if (Date.now() < this.refreshAt) {
      return this.current;
    }
    if (this.pending) {
      return this.pending;
    }
    this.pending = this.client
      .load()
      .then((result) => (this.current = result.data))
      .catch(() => this.current)
      .finally(() => {
        this.refreshAt = Date.now() + 60_000;
        this.pending = undefined;
      });
    return this.pending;
  }
}
