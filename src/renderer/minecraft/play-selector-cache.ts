import type { PlayVersionSnapshot } from '../../shared/minecraft/play-version-contract';

export const playSelectorCacheKey = 'battly.play-selector-cache.v1';
const maxCacheLength = 2 * 1024 * 1024;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 256 && !value.includes('\0');

function isSnapshot(value: unknown): value is PlayVersionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.installed) || !Array.isArray(value.recent)) {
    return false;
  }
  return (
    value.installed.length <= 4096 &&
    value.recent.length <= 256 &&
    value.installed.every(
      (entry: unknown) =>
        isRecord(entry) &&
        isText(entry.id) &&
        entry.id.length > 0 &&
        isText(entry.version) &&
        typeof entry.custom === 'boolean' &&
        isText(entry.loader) &&
        isText(entry.loaderVersion) &&
        (entry.requiredJavaVersion === null || isText(entry.requiredJavaVersion)) &&
        (entry.installedAt === undefined ||
          (typeof entry.installedAt === 'number' &&
            Number.isFinite(entry.installedAt) &&
            entry.installedAt >= 0)) &&
        Array.isArray(entry.compatibleLoaders) &&
        entry.compatibleLoaders.length <= 32 &&
        entry.compatibleLoaders.every(isText),
    ) &&
    value.recent.every(
      (entry: unknown) =>
        isRecord(entry) &&
        isText(entry.version) &&
        isText(entry.customVersion) &&
        typeof entry.isExtra === 'boolean' &&
        isText(entry.loader) &&
        isText(entry.loaderVersion) &&
        isText(entry.requiredJavaVersion) &&
        isText(entry.dateOpened),
    )
  );
}

/** Show the last local discovery immediately; each opening still requests a fresh snapshot. */
export class PlaySelectorCache {
  private snapshot: PlayVersionSnapshot | null | undefined;
  private pending: Promise<PlayVersionSnapshot> | null = null;
  private serialized: string | null = null;

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'>,
    private readonly discover: () => Promise<PlayVersionSnapshot>,
  ) {}

  read(): PlayVersionSnapshot | null {
    if (this.snapshot !== undefined) {
      return this.snapshot;
    }
    this.snapshot = null;
    try {
      const raw = this.storage.getItem(playSelectorCacheKey);
      if (!raw || raw.length > maxCacheLength) {
        return null;
      }
      const cached: unknown = JSON.parse(raw);
      if (isRecord(cached) && cached.schema === 1 && isSnapshot(cached.snapshot)) {
        this.snapshot = cached.snapshot;
        this.serialized = raw;
      }
    } catch {
      // An invalid cache never prevents fresh local discovery.
    }
    return this.snapshot;
  }

  refresh(): Promise<PlayVersionSnapshot> {
    return (this.pending ??= this.discover()
      .then((snapshot) => {
        if (!isSnapshot(snapshot)) {
          throw new Error('INVALID_PLAY_SNAPSHOT');
        }
        this.snapshot = snapshot;
        try {
          const serialized = JSON.stringify({ schema: 1, snapshot });
          if (serialized.length <= maxCacheLength && serialized !== this.serialized) {
            this.storage.setItem(playSelectorCacheKey, serialized);
            this.serialized = serialized;
          }
        } catch {
          // The in-memory snapshot remains usable if persistence is unavailable.
        }
        return snapshot;
      })
      .finally(() => {
        this.pending = null;
      }));
  }
}
