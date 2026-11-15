import type {
  LoaderBuildSnapshot,
  LoaderGameVersionSnapshot,
  MinecraftLoaderKind,
} from '../../shared/minecraft/loader-build-contract';

type Snapshot = LoaderBuildSnapshot | LoaderGameVersionSnapshot;
const cacheKey = 'battly.loader-catalog.v1';
const lifetime = 5 * 60_000;
const maximumEntries = 64;
const loaders: readonly MinecraftLoaderKind[] = [
  'fabric',
  'forge',
  'legacyfabric',
  'neoforge',
  'quilt',
  'optifine',
];

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function valid(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const snapshot = value as Partial<LoaderBuildSnapshot & LoaderGameVersionSnapshot>;
  if (!loaders.includes(snapshot.loader as MinecraftLoaderKind)) {
    return false;
  }
  const entries = snapshot.builds ?? snapshot.versions;
  return (
    Array.isArray(entries) &&
    entries.length <= 2000 &&
    entries.every(
      (entry: unknown) =>
        record(entry) &&
        typeof entry.version === 'string' &&
        entry.version.length <= 128 &&
        (snapshot.builds ? typeof entry.isStable === 'boolean' : typeof entry.stable === 'boolean'),
    ) &&
    (!snapshot.builds ||
      (typeof snapshot.minecraftVersion === 'string' && snapshot.minecraftVersion.length <= 128))
  );
}

/** Keep visited catalogues available while refreshing them in the background. */
export class LoaderCatalogCache {
  private readonly entries = new Map<string, { savedAt: number; value: Snapshot }>();
  private readonly pending = new Map<string, Promise<Snapshot>>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly api: {
      getLoaderGameVersions(loader: MinecraftLoaderKind): Promise<LoaderGameVersionSnapshot>;
      getLoaderBuilds(loader: MinecraftLoaderKind, version: string): Promise<LoaderBuildSnapshot>;
    },
  ) {
    try {
      const raw = storage.getItem(cacheKey);
      if (!raw || raw.length > 2 * 1024 * 1024) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }
      for (const entry of parsed.slice(-maximumEntries)) {
        if (!Array.isArray(entry) || entry.length !== 2) {
          continue;
        }
        const [key, cached] = entry as unknown[];
        if (
          typeof key !== 'string' ||
          !record(cached) ||
          typeof cached.savedAt !== 'number' ||
          !Number.isFinite(cached.savedAt) ||
          cached.savedAt > Date.now() ||
          !valid(cached.value)
        ) {
          continue;
        }
        const expected =
          'builds' in cached.value
            ? `${cached.value.loader}:${cached.value.minecraftVersion}`
            : cached.value.loader;
        if (key === expected) {
          this.entries.set(key, { savedAt: cached.savedAt, value: cached.value });
        }
      }
    } catch {
      /* A damaged cache must not prevent discovery. */
    }
  }

  gameVersions(loader: MinecraftLoaderKind): Promise<LoaderGameVersionSnapshot> {
    return this.get(loader, () =>
      this.api.getLoaderGameVersions(loader),
    ) as Promise<LoaderGameVersionSnapshot>;
  }

  builds(loader: MinecraftLoaderKind, version: string): Promise<LoaderBuildSnapshot> {
    return this.get(`${loader}:${version}`, () =>
      this.api.getLoaderBuilds(loader, version),
    ) as Promise<LoaderBuildSnapshot>;
  }

  private get(key: string, load: () => Promise<Snapshot>): Promise<Snapshot> {
    const cached = this.entries.get(key);
    if (cached && Date.now() - cached.savedAt < lifetime) {
      return Promise.resolve(cached.value);
    }
    let request = this.pending.get(key);
    if (!request) {
      request = load()
        .then((value) => {
          if (
            !valid(value) ||
            key !== ('builds' in value ? `${value.loader}:${value.minecraftVersion}` : value.loader)
          ) {
            throw new TypeError('LOADER_CATALOG_INVALID');
          }
          this.entries.delete(key);
          this.entries.set(key, { savedAt: Date.now(), value });
          while (this.entries.size > maximumEntries) {
            this.entries.delete(this.entries.keys().next().value!);
          }
          if (!this.saveTimer) {
            this.saveTimer = setTimeout(() => {
              this.saveTimer = undefined;
              try {
                let raw = JSON.stringify([...this.entries]);
                while (raw.length > 2 * 1024 * 1024 && this.entries.size > 1) {
                  this.entries.delete(this.entries.keys().next().value!);
                  raw = JSON.stringify([...this.entries]);
                }
                if (raw.length <= 2 * 1024 * 1024) {
                  this.storage.setItem(cacheKey, raw);
                }
              } catch {
                /* Memory caching still works if storage is full. */
              }
            }, 250);
          }
          return value;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    if (cached) {
      void request.catch(() => undefined);
      return Promise.resolve(cached.value);
    }
    return request;
  }

  async preload(): Promise<void> {
    const queue = [...loaders];
    const worker = async (): Promise<void> => {
      for (let loader = queue.shift(); loader; loader = queue.shift()) {
        try {
          const snapshot = await this.gameVersions(loader);
          const version =
            snapshot.versions.find((entry) => entry.stable)?.version ??
            snapshot.versions[0]?.version;
          if (version) {
            await this.builds(loader, version);
          }
        } catch {
          /* A failed provider must not block the remaining loaders. */
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }
}
