import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import AdmZip from 'adm-zip';

import type { JsonValue } from '../../shared/storage/legacy-storage';
import {
  normalizeContentName,
  type WorldBackupSummary,
} from '../../shared/mybattly/mybattly-contract';
import { pathExists } from '../files/atomic-file';
import type { SettingsStore } from '../settings/settings-store';

const MAX_FILES = 100_000;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

function serializedHistory(history: readonly WorldBackupSummary[]): JsonValue {
  return history.map((entry) => ({
    id: entry.id,
    worldName: entry.worldName,
    createdAt: entry.createdAt,
    archiveName: entry.archiveName,
    sizeBytes: entry.sizeBytes,
  }));
}

function historyEntries(value: JsonValue): WorldBackupSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, JsonValue>;
    if (
      item.remoteHistory === true ||
      typeof item.id !== 'string' ||
      typeof item.worldName !== 'string' ||
      typeof item.createdAt !== 'string' ||
      typeof item.archiveName !== 'string' ||
      !/^[a-z0-9_-][a-z0-9._-]{0,200}\.zip$/i.test(item.archiveName) ||
      typeof item.sizeBytes !== 'number'
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        worldName: item.worldName,
        createdAt: item.createdAt,
        archiveName: item.archiveName,
        sizeBytes: item.sizeBytes,
      },
    ];
  });
}

interface ArchiveState {
  files: number;
  bytes: number;
}

async function addDirectory(
  zip: AdmZip,
  root: string,
  relative = '',
  state: ArchiveState = { files: 0, bytes: 0 },
): Promise<void> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const child = join(relative, entry.name);
    const absolute = join(root, child);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      continue;
    }
    if (info.isDirectory()) {
      zip.addFile(`${child.replaceAll('\\', '/')}/`, Buffer.alloc(0));
      await addDirectory(zip, root, child, state);
    } else if (info.isFile()) {
      state.files += 1;
      state.bytes += info.size;
      if (state.files > MAX_FILES) {
        throw new RangeError('World contains too many files');
      }
      if (state.bytes > MAX_TOTAL_BYTES) {
        throw new RangeError('World is too large to back up');
      }
      zip.addFile(child.replaceAll('\\', '/'), await readFile(absolute));
    }
  }
}

export class WorldBackupService {
  constructor(
    private readonly contentRoot: string,
    private readonly backupRoot: string,
    private readonly archiveRoot: string,
    private readonly settings: SettingsStore,
  ) {}

  async list(): Promise<readonly WorldBackupSummary[]> {
    return historyEntries(await this.settings.backupHistory()).sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  async create(worldName: string): Promise<readonly WorldBackupSummary[]> {
    worldName = normalizeContentName(worldName);
    const worldPath = join(this.contentRoot, 'saves', worldName);
    const info = await lstat(worldPath);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new TypeError('Invalid world');
    }
    const id = randomUUID();
    const safeWorldName = basename(worldName)
      .replaceAll(/[^a-z0-9._-]+/gi, '-')
      .slice(0, 80);
    const archiveName = `${safeWorldName || 'world'}-${id}.zip`;
    await mkdir(this.backupRoot, { recursive: true });
    const output = join(this.backupRoot, archiveName);
    const temporary = `${output}.partial`;
    const zip = new AdmZip();
    await addDirectory(zip, worldPath);
    await new Promise<void>((resolve, reject) => {
      zip.writeZip(temporary, (error) => (error ? reject(error) : resolve()));
    });
    await rename(temporary, output);
    const entry: WorldBackupSummary = {
      id,
      worldName,
      createdAt: new Date().toISOString(),
      archiveName,
      sizeBytes: (await stat(output)).size,
    };
    await this.settings.replaceBackupHistory(serializedHistory([entry, ...(await this.list())]));
    return this.list();
  }

  async archive(id: string): Promise<readonly WorldBackupSummary[]> {
    const history = await this.list();
    const entry = history.find((backup) => backup.id === id);
    if (!entry) {
      throw new TypeError('Unknown backup');
    }
    const source = join(this.backupRoot, entry.archiveName);
    if (await pathExists(source)) {
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TypeError('Invalid backup archive');
      }
      await mkdir(this.archiveRoot, { recursive: true });
      await rename(source, join(this.archiveRoot, `${Date.now()}-${entry.archiveName}`));
    }
    const storedHistory = await this.settings.backupHistory();
    await this.settings.replaceBackupHistory(
      Array.isArray(storedHistory)
        ? storedHistory.filter(
            (backup) =>
              !backup || typeof backup !== 'object' || Array.isArray(backup) || backup.id !== id,
          )
        : [],
    );
    return this.list();
  }
}
