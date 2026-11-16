import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  instanceIdPattern,
  normalizeInstanceDraft,
  normalizeInstanceSummary,
  type InstanceSummary,
} from '../../shared/minecraft/instance';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

const maximumInstances = 500;
const maximumMetadataBytes = 1024 * 1024;
const maximumIconBytes = 1024 * 1024;

function iconBytes(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) {
    return null;
  }
  const comma = dataUrl.indexOf(',');
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  if (!bytes.length || bytes.length > maximumIconBytes) {
    throw new TypeError('Invalid instance icon');
  }
  const signature = bytes.subarray(0, 12).toString('hex');
  const valid =
    signature.startsWith('89504e470d0a1a0a') ||
    signature.startsWith('ffd8ff') ||
    (signature.startsWith('52494646') && signature.endsWith('57454250'));
  if (!valid) {
    throw new TypeError('Invalid instance icon');
  }
  return bytes;
}

function metadataDraft(value: ReturnType<typeof normalizeInstanceDraft>): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...value };
  delete metadata.iconDataUrl;
  return metadata;
}

export async function readIconDataUrl(directory: string): Promise<string | null> {
  try {
    const bytes = await readBoundedRegularFile(join(directory, 'icon.png'), maximumIconBytes);
    const signature = bytes.subarray(0, 12).toString('hex');
    const type = signature.startsWith('89504e470d0a1a0a')
      ? 'png'
      : signature.startsWith('ffd8ff')
        ? 'jpeg'
        : signature.startsWith('52494646') && signature.endsWith('57454250')
          ? 'webp'
          : null;
    if (!type) {
      return null;
    }
    return `data:image/${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export type InstanceIdFactory = () => string;
export type InstanceClock = () => number;

function absoluteDirectory(path: string, label: string): string {
  if (!path || !isAbsolute(path)) {
    throw new TypeError(`${label} must be absolute`);
  }
  return resolve(path);
}

async function assertRealDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError(`Expected a real directory: ${path}`);
  }
}

async function readMetadata(path: string): Promise<Record<string, unknown>> {
  const content = await readBoundedRegularFile(path, maximumMetadataBytes);
  let value: unknown;
  try {
    value = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Instance metadata is not valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Instance metadata must be an object');
  }
  return value as Record<string, unknown>;
}

export class InstanceStore {
  readonly #archiveRoot: string;
  readonly #clock: InstanceClock;
  readonly #createId: InstanceIdFactory;
  readonly #root: string;
  readonly #roots: readonly string[];
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(
    root: string,
    archiveRoot: string,
    createId: InstanceIdFactory = () => randomUUID().replaceAll('-', '').slice(0, 12),
    clock: InstanceClock = Date.now,
    legacyRoots: readonly string[] = [],
  ) {
    this.#root = absoluteDirectory(root, 'Instance root');
    this.#archiveRoot = absoluteDirectory(archiveRoot, 'Instance archive root');
    this.#roots = [
      ...new Set([
        this.#root,
        ...legacyRoots.map((root) => absoluteDirectory(root, 'Legacy instance root')),
      ]),
    ];
    if (this.#root === this.#archiveRoot) {
      throw new TypeError('Instance root and archive root must be different');
    }
    this.#createId = createId;
    this.#clock = clock;
  }

  async list(): Promise<InstanceSummary[]> {
    await this.#writeQueue;
    await mkdir(this.#root, { recursive: true });
    await assertRealDirectory(this.#root);
    const summaries: InstanceSummary[] = [];
    const seen = new Set<string>();
    for (const root of this.#roots) {
      if (!(await pathExists(root))) {
        continue;
      }
      await assertRealDirectory(root);
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (summaries.length >= maximumInstances) {
          return summaries;
        }
        if (!entry.isDirectory() || entry.isSymbolicLink() || !instanceIdPattern.test(entry.name)) {
          continue;
        }
        if (seen.has(entry.name)) {
          continue;
        }
        seen.add(entry.name);
        try {
          const metadata = await readMetadata(join(root, entry.name, 'instance.json'));
          const summary = normalizeInstanceSummary(entry.name, metadata);
          const iconDataUrl = await readIconDataUrl(join(root, entry.name));
          summaries.push(iconDataUrl ? { ...summary, iconDataUrl } : summary);
        } catch {
          // A partially downloaded or historical invalid instance remains untouched.
        }
      }
    }
    // Keep the filesystem order used by Battly legacy. On Windows this is the
    // instance directory order, and users rely on it remaining stable.
    return summaries;
  }

  async readInternal(id: string): Promise<Readonly<Record<string, unknown>>> {
    await this.#writeQueue;
    return { ...(await readMetadata(join(await this.#instanceDirectory(id), 'instance.json'))) };
  }

  async directoryPathInternal(id: string): Promise<string> {
    await this.#writeQueue;
    return this.#instanceDirectory(id);
  }

  create(value: unknown): Promise<InstanceSummary> {
    const draft = normalizeInstanceDraft(value);
    return this.#enqueue(async () => {
      await mkdir(this.#root, { recursive: true });
      await assertRealDirectory(this.#root);
      const id = this.#createId();
      if (!instanceIdPattern.test(id)) {
        throw new TypeError('Instance id factory returned an invalid id');
      }
      const target = join(this.#root, id);
      const staging = join(this.#root, `.creating-${id}`);
      if (
        (await pathExists(staging)) ||
        (await Promise.all(this.#roots.map((root) => pathExists(join(root, id))))).some(Boolean)
      ) {
        throw new Error('Instance id already exists');
      }
      await mkdir(staging);
      try {
        await writeFileAtomically(
          join(staging, 'instance.json'),
          `${JSON.stringify(metadataDraft(draft), null, 2)}\n`,
        );
        const icon = iconBytes(draft.iconDataUrl);
        if (icon) {
          await writeFileAtomically(join(staging, 'icon.png'), icon);
        }
        await rename(staging, target);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
      return { id, ...draft };
    });
  }

  update(id: string, value: unknown): Promise<InstanceSummary> {
    const draft = normalizeInstanceDraft(value);
    return this.#enqueue(async () => {
      const directory = await this.#instanceDirectory(id);
      const metadataPath = join(directory, 'instance.json');
      const existing = await readMetadata(metadataPath);
      await writeFileAtomically(
        metadataPath,
        `${JSON.stringify({ ...existing, ...metadataDraft(draft) }, null, 2)}\n`,
      );
      const icon = iconBytes(draft.iconDataUrl);
      if (icon) {
        await writeFileAtomically(join(directory, 'icon.png'), icon);
      }
      const storedIcon = draft.iconDataUrl ?? (await readIconDataUrl(directory));
      return { id, ...draft, ...(storedIcon ? { iconDataUrl: storedIcon } : {}) };
    });
  }

  archive(id: string): Promise<string> {
    return this.#enqueue(async () => {
      const directory = await this.#instanceDirectory(id);
      await mkdir(this.#archiveRoot, { recursive: true });
      await assertRealDirectory(this.#archiveRoot);
      const archivedPath = join(this.#archiveRoot, `${id}-${this.#clock()}`);
      if (await pathExists(archivedPath)) {
        throw new Error('Instance archive target already exists');
      }
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(directory, archivedPath);
          break;
        } catch (error) {
          if (
            process.platform !== 'win32' ||
            attempt >= 20 ||
            !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')
          ) {
            throw error;
          }
          await delay(250);
        }
      }
      return archivedPath;
    });
  }

  async #instanceDirectory(id: string): Promise<string> {
    if (!instanceIdPattern.test(id)) {
      throw new TypeError('Invalid instance id');
    }
    for (const root of this.#roots) {
      const directory = join(root, id);
      if (await pathExists(directory)) {
        await assertRealDirectory(root);
        await assertRealDirectory(directory);
        return directory;
      }
    }
    throw new Error('Instance directory does not exist');
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
