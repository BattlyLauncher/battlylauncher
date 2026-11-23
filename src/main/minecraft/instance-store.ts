import { createHash, randomUUID } from 'node:crypto';
import { PrivateDataDecryptionError } from '../storage/protected-data';
import { setTimeout as delay } from 'node:timers/promises';
import { copyFile, lstat, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  instanceCopyParts,
  instanceIdPattern,
  normalizeInstanceDraft,
  normalizeInstanceSummary,
  type InstanceCopyRequest,
  type InstanceSummary,
} from '../../shared/minecraft/instance';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

const maximumInstances = 500;
const maximumMetadataBytes = 1024 * 1024;
const maximumIconBytes = 1024 * 1024;
type InstanceDirectory = { root: string; name: string; id: string };

const copyEntries: Record<InstanceCopyRequest['parts'][number], readonly string[]> = {
  mods: ['mods'],
  settings: [
    'config',
    'defaultconfigs',
    'kubejs',
    'scripts',
    'options.txt',
    'optionsof.txt',
    'optionsshaders.txt',
  ],
  worlds: ['saves'],
  resourcepacks: ['resourcepacks', 'texturepacks'],
  shaderpacks: ['shaderpacks'],
  screenshots: ['screenshots'],
  servers: ['servers.dat'],
};

async function copyInstanceEntry(source: string, target: string, root: string): Promise<void> {
  const info = await lstat(source);
  const path = relative(root, await realpath(source));
  if (
    info.isSymbolicLink() ||
    !path ||
    isAbsolute(path) ||
    path === '..' ||
    path.startsWith(`..${sep}`)
  ) {
    throw new Error('La selección contiene un enlace o un archivo fuera de la instancia.');
  }
  if (info.isDirectory()) {
    await mkdir(target);
    for (const entry of await readdir(source)) {
      if (entry.toLowerCase() !== 'session.lock') {
        await copyInstanceEntry(join(source, entry), join(target, entry), root);
      }
    }
  } else if (info.isFile()) {
    await copyFile(source, target);
  } else {
    throw new Error('La selección contiene un archivo especial que no se puede copiar.');
  }
}

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

async function savedWorldState(directory: string): Promise<'present' | 'empty' | 'unknown'> {
  const saves = join(directory, 'saves');
  try {
    const stats = await lstat(saves);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return 'unknown';
    }
    for (const world of await readdir(saves, { withFileTypes: true })) {
      if (world.isSymbolicLink()) {
        return 'unknown';
      }
      if (world.isDirectory()) {
        for (const name of ['level.dat', 'level.dat_old']) {
          try {
            const level = await lstat(join(saves, world.name, name));
            if (level.isFile()) {
              return 'present';
            }
            if (level.isSymbolicLink()) {
              return 'unknown';
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              return 'unknown';
            }
          }
        }
      }
    }
    return 'empty';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'empty' : 'unknown';
  }
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
    let unreadable: PrivateDataDecryptionError | undefined;
    const groups = new Map<string, InstanceDirectory[]>();
    for (const entry of await this.#directories()) {
      const group = groups.get(entry.id);
      if (group) {
        group.push(entry);
      } else {
        groups.set(entry.id, [entry]);
      }
    }
    for (const entries of groups.values()) {
      if (summaries.length >= maximumInstances) {
        break;
      }
      try {
        const { directory, summary } = await this.#selectDirectory(entries);
        const iconDataUrl = await readIconDataUrl(directory);
        summaries.push(iconDataUrl ? { ...summary, iconDataUrl } : summary);
      } catch (error) {
        if (error instanceof PrivateDataDecryptionError) {
          unreadable ??= error;
        }
        // Incomplete metadata remains untouched; another configured root may have a valid copy.
      }
    }
    if (!summaries.length && unreadable) {
      throw unreadable;
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
    return this.#enqueue(() => this.#create(draft));
  }

  duplicate(
    id: string,
    value: unknown,
    assertEditable: (directory: string) => void,
  ): Promise<InstanceSummary> {
    const request = value as Partial<InstanceCopyRequest> | undefined;
    if (
      !request ||
      typeof request.name !== 'string' ||
      !Array.isArray(request.parts) ||
      request.parts.length > instanceCopyParts.length ||
      request.parts.some((part: unknown) => !instanceCopyParts.some((allowed) => allowed === part))
    ) {
      throw new TypeError('Selección de copia inválida.');
    }
    const { name } = request;
    const parts: InstanceCopyRequest['parts'] = request.parts;
    return this.#enqueue(async () => {
      const source = await this.#instanceDirectory(id);
      assertEditable(source);
      const root = await realpath(source);
      const entries = new Set(parts.flatMap((part) => copyEntries[part]));
      const metadata = await readMetadata(join(source, 'instance.json'));
      const iconDataUrl = await readIconDataUrl(source);
      const draft = normalizeInstanceDraft({
        ...metadata,
        name,
        iconDataUrl,
        launchProfile: parts.includes('settings') ? metadata.launchProfile : undefined,
      });
      return this.#create(
        draft,
        async (staging) => {
          for (const entry of await readdir(source)) {
            if (entries.has(entry.toLowerCase())) {
              await copyInstanceEntry(join(source, entry), join(staging, entry), root);
            }
          }
          assertEditable(source);
        },
        entries.has('mods') ? { modrinth: metadata.modrinth, curseforge: metadata.curseforge } : {},
      );
    });
  }

  async #create(
    draft: ReturnType<typeof normalizeInstanceDraft>,
    populate?: (directory: string) => Promise<void>,
    packMetadata: Record<string, unknown> = {},
  ): Promise<InstanceSummary> {
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
      (await Promise.all(this.#roots.map((root) => pathExists(join(root, id))))).some(Boolean) ||
      (await this.#directories()).some((entry) => entry.id === id)
    ) {
      throw new Error('Instance id already exists');
    }
    await mkdir(staging);
    try {
      await writeFileAtomically(
        join(staging, 'instance.json'),
        `${JSON.stringify({ ...packMetadata, ...metadataDraft(draft) }, null, 2)}\n`,
      );
      const icon = iconBytes(draft.iconDataUrl);
      if (icon) {
        await writeFileAtomically(join(staging, 'icon.png'), icon);
      }
      await populate?.(staging);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
    return { id, ...draft };
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
    const selected = await this.#selectDirectory(
      (await this.#directories()).filter((entry) => entry.id === id),
    );
    return selected.directory;
  }

  async #selectDirectory(entries: readonly InstanceDirectory[]) {
    let unreadable: PrivateDataDecryptionError | undefined;
    let primary: { directory: string; summary: InstanceSummary } | undefined;
    let recovered: typeof primary;
    for (const entry of entries) {
      const directory = join(entry.root, entry.name);
      try {
        await assertRealDirectory(directory);
        const summary = normalizeInstanceSummary(
          entry.id,
          await readMetadata(join(directory, 'instance.json')),
        );
        if (!primary) {
          primary = { directory, summary };
          if (entries.length === 1 || (await savedWorldState(directory)) !== 'empty') {
            return primary;
          }
          continue;
        }
        if (
          summary.name === primary.summary.name &&
          summary.version === primary.summary.version &&
          summary.loader === primary.summary.loader &&
          summary.loaderVersion === primary.summary.loaderVersion &&
          (await savedWorldState(directory)) === 'present'
        ) {
          if (recovered) {
            return primary;
          }
          recovered = { directory, summary };
        }
      } catch (error) {
        if (error instanceof PrivateDataDecryptionError) {
          unreadable ??= error;
        }
      }
    }
    if (primary) {
      return recovered ?? primary;
    }
    if (unreadable) {
      throw unreadable;
    }
    throw new Error('Instance directory does not exist');
  }

  async #directories(): Promise<InstanceDirectory[]> {
    const directories: { root: string; name: string }[] = [];
    const reserved = new Set<string>();
    for (const root of this.#roots) {
      if (!(await pathExists(root))) {
        continue;
      }
      await assertRealDirectory(root);
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) {
          continue;
        }
        directories.push({ root, name: entry.name });
        if (instanceIdPattern.test(entry.name)) {
          reserved.add(entry.name);
        }
      }
    }
    const aliases = new Map<string, string>();
    return directories.map((entry) => {
      if (instanceIdPattern.test(entry.name)) {
        return { ...entry, id: entry.name };
      }
      let id = aliases.get(entry.name);
      if (!id) {
        let attempt = 0;
        do {
          id =
            'legacy-' +
            createHash('sha256')
              .update(JSON.stringify([entry.name, attempt++]))
              .digest('base64url');
        } while (reserved.has(id));
        aliases.set(entry.name, id);
        reserved.add(id);
      }
      // Keep the folder and its encrypted metadata unchanged. Only the API ID is normalized.
      return { ...entry, id };
    });
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
