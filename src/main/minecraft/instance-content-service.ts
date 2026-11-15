import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizeInstanceContentKind,
  normalizeInstanceContentName,
  type InstanceContentEntry,
  type InstanceContentKind,
} from '../../shared/minecraft/instance-content';
import { pathExists } from '../files/atomic-file';
import { readIconDataUrl, type InstanceStore } from './instance-store';
import { inspectLocalMod } from '../mods/local-mod-compatibility';
import { backupInstanceWorld } from './instance-world-backup';
import { readPackMetadata } from './instance-pack-metadata';
import type { ContentArtwork } from './content-artwork';

export class InstanceContentService {
  #queue: Promise<unknown> = Promise.resolve();
  #metadata = new Map<string, { stamp: string; value: Partial<InstanceContentEntry> }>();
  constructor(
    private readonly store: Pick<InstanceStore, 'directoryPathInternal'>,
    private readonly assertEditable: (directory: string) => void = () => undefined,
    private readonly artwork?: ContentArtwork,
  ) {}

  async directory(
    id: string,
    kindValue: unknown,
    archived: boolean | 'backups' = false,
  ): Promise<string> {
    const kind = normalizeInstanceContentKind(kindValue);
    const root = await this.store.directoryPathInternal(id);
    let directory = root;
    for (const part of archived === 'backups'
      ? ['backups', kind]
      : archived
        ? ['.battly-content-archive', kind]
        : [kind]) {
      directory = join(directory, part);
      await mkdir(directory, { recursive: true });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('La carpeta de contenido no puede ser un enlace');
      }
    }
    return directory;
  }

  async list(id: string, kindValue: unknown): Promise<readonly InstanceContentEntry[]> {
    const kind = normalizeInstanceContentKind(kindValue);
    const directory = await this.directory(id, kind);
    const result: InstanceContentEntry[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !this.#accepts(kind, entry.name, entry.isDirectory())) {
        continue;
      }
      const info = await lstat(join(directory, entry.name));
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        continue;
      }
      const path = join(directory, entry.name);
      let metadata: Partial<InstanceContentEntry> = {};
      if (kind === 'mods') {
        const stamp = `${info.size}:${info.mtimeMs}`;
        const cached = this.#metadata.get(path);
        if (cached?.stamp === stamp) {
          metadata = cached.value;
        } else {
          const mod = await inspectLocalMod(path, {
            filename: entry.name,
            enabled: true,
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          });
          metadata = {
            title: mod.name,
            version: mod.version?.includes('${') ? null : mod.version,
            gameVersion: mod.gameVersion,
            iconDataUrl: mod.iconDataUrl,
            loader: mod.loader,
          };
          if (this.#metadata.size >= 2000) {
            this.#metadata.clear();
          }
          this.#metadata.set(path, { stamp, value: metadata });
        }
      } else if (kind === 'resourcepacks' || kind === 'shaderpacks') {
        metadata = await readPackMetadata(path, info.isDirectory());
      } else if (info.isDirectory()) {
        metadata = { iconDataUrl: await readIconDataUrl(path) };
      }
      if (kind === 'saves') {
        const backups = join(await this.directory(id, 'saves', 'backups'), entry.name);
        const backupInfo = await lstat(backups).catch(() => null);
        metadata = {
          ...metadata,
          backups:
            backupInfo?.isDirectory() && !backupInfo.isSymbolicLink()
              ? (await readdir(backups)).filter((name) => name.endsWith('.zip')).length
              : 0,
        };
      }
      result.push({
        ...metadata,
        name: entry.name,
        directory: info.isDirectory(),
        size: info.size,
        enabled: !/\.(disabled|old)$/i.test(entry.name),
      });
    }
    if (kind !== 'saves') {
      await this.artwork?.enrich(directory, result).catch(() => undefined);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  import(
    id: string,
    kindValue: unknown,
    sources: readonly string[],
  ): Promise<readonly InstanceContentEntry[]> {
    return this.#mutate(async () => {
      this.assertEditable(await this.store.directoryPathInternal(id));
      const kind = normalizeInstanceContentKind(kindValue);
      if (kind === 'saves') {
        throw new Error('Añade los mundos desde su carpeta');
      }
      const directory = await this.directory(id, kind);
      for (const source of sources) {
        const name = normalizeInstanceContentName(basename(source));
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink() || !this.#accepts(kind, name, false)) {
          throw new Error(`Archivo incompatible: ${name}`);
        }
        // Exclusive copy preserves existing files even when imports overlap.
        await copyFile(source, join(directory, name), constants.COPYFILE_EXCL);
      }
      return this.list(id, kind);
    });
  }

  act(
    id: string,
    kindValue: unknown,
    nameValue: unknown,
    action: unknown,
  ): Promise<readonly InstanceContentEntry[]> {
    return this.#mutate(async () => {
      this.assertEditable(await this.store.directoryPathInternal(id));
      const kind = normalizeInstanceContentKind(kindValue);
      const name = normalizeInstanceContentName(nameValue);
      const directory = await this.directory(id, kind);
      const source = join(directory, name);
      const info = await lstat(source);
      if (info.isSymbolicLink() || !this.#accepts(kind, name, info.isDirectory())) {
        throw new Error('Contenido inválido');
      }
      if (action === 'backup' && kind === 'saves' && info.isDirectory()) {
        await backupInstanceWorld(source, join(await this.directory(id, kind, 'backups'), name));
      } else if (action === 'archive') {
        const archive = await this.directory(id, kind, true);
        await rename(source, join(archive, `${randomUUID()}-${name}`));
      } else if (action === 'toggle' && kind === 'mods') {
        const targetName = /\.jar$/i.test(name)
          ? `${name}.disabled`
          : /\.jar\.(disabled|old)$/i.test(name)
            ? name.replace(/\.(disabled|old)$/i, '')
            : name.replace(/\.(disabled|old)$/i, '.jar');
        const target = join(directory, targetName);
        if (await pathExists(target)) {
          throw new Error('Ya existe un mod con ese nombre');
        }
        await rename(source, target);
      } else {
        throw new Error('Acción de contenido inválida');
      }
      return this.list(id, kind);
    });
  }

  #accepts(kind: InstanceContentKind, name: string, directory: boolean): boolean {
    try {
      normalizeInstanceContentName(name);
    } catch {
      return false;
    }
    if (kind === 'saves') {
      return directory;
    }
    if (kind === 'mods') {
      return !directory && /\.(jar|disabled|old)$/i.test(name);
    }
    return directory || /\.zip$/i.test(name);
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }
}
