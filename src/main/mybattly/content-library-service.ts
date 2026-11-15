import { lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

import AdmZip from 'adm-zip';

import type { MyBattlyResourcePack, MyBattlyWorld } from '../../shared/mybattly/mybattly-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

function safeEntryName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

const maximumIconBytes = 1024 * 1024;

function pngDataUrl(bytes: Buffer): string | undefined {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumIconBytes ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return undefined;
  }
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function worldIcon(directory: string): Promise<string | undefined> {
  const path = join(directory, 'icon.png');
  if (!(await pathExists(path))) {
    return undefined;
  }
  try {
    return pngDataUrl(await readBoundedRegularFile(path, maximumIconBytes));
  } catch {
    return undefined;
  }
}

function resourcePackIcon(path: string): string | undefined {
  try {
    const entry = new AdmZip(path).getEntry('pack.png');
    if (!entry || entry.isDirectory || entry.header.size > maximumIconBytes) {
      return undefined;
    }
    return pngDataUrl(entry.getData());
  } catch {
    return undefined;
  }
}

async function enabledResourcePacks(optionsPath: string): Promise<ReadonlySet<string>> {
  if (!(await pathExists(optionsPath))) {
    return new Set();
  }
  try {
    const content = (await readBoundedRegularFile(optionsPath, 1024 * 1024)).toString('utf8');
    const line = content.match(/^resourcePacks:(\[.*\])$/m)?.[1];
    if (!line) {
      return new Set();
    }
    const parsed = JSON.parse(line) as unknown;
    if (!Array.isArray(parsed) || parsed.length > 1_000) {
      return new Set();
    }
    return new Set(
      parsed
        .filter((value): value is string => typeof value === 'string' && value.length <= 300)
        .map((value) => value.replace(/^file\//, '')),
    );
  } catch {
    return new Set();
  }
}

export class ContentLibraryService {
  constructor(
    private readonly root: string,
    private readonly archiveRoot = join(root, '.battly-remake-archive'),
  ) {}

  async worlds(): Promise<readonly MyBattlyWorld[]> {
    const directory = join(this.root, 'saves');
    if (!(await pathExists(directory))) {
      return [];
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const worlds = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && !entry.isSymbolicLink() && safeEntryName(entry.name),
        )
        .slice(0, 1_000)
        .map(async (entry) => {
          const worldDirectory = join(directory, entry.name);
          const [info, iconDataUrl] = await Promise.all([
            lstat(worldDirectory),
            worldIcon(worldDirectory),
          ]);
          return {
            name: entry.name,
            modifiedAt: info.mtime.toISOString(),
            ...(iconDataUrl ? { iconDataUrl } : {}),
          };
        }),
    );
    return worlds.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  async resourcePacks(): Promise<readonly MyBattlyResourcePack[]> {
    const directory = join(this.root, 'resourcepacks');
    if (!(await pathExists(directory))) {
      return [];
    }
    const [entries, enabled] = await Promise.all([
      readdir(directory, { withFileTypes: true }),
      enabledResourcePacks(join(this.root, 'options.txt')),
    ]);
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          safeEntryName(entry.name) &&
          entry.name.toLowerCase().endsWith('.zip'),
      )
      .slice(0, 1_000)
      .map((entry) => {
        const iconDataUrl = resourcePackIcon(join(directory, entry.name));
        return {
          name: entry.name,
          enabled: enabled.has(entry.name),
          ...(iconDataUrl ? { iconDataUrl } : {}),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async archiveWorld(name: string): Promise<readonly MyBattlyWorld[]> {
    this.#assertName(name);
    const source = join(this.root, 'saves', name);
    const info = await lstat(source);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new TypeError('Invalid world');
    }
    const archive = join(this.archiveRoot, 'worlds');
    await mkdir(archive, { recursive: true });
    await rename(source, join(archive, `${Date.now()}-${name}`));
    return this.worlds();
  }

  async toggleResourcePack(name: string): Promise<readonly MyBattlyResourcePack[]> {
    await this.#assertResourcePack(name);
    const optionsPath = join(this.root, 'options.txt');
    const current = await enabledResourcePacks(optionsPath);
    const next = new Set(current);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    const source = (await pathExists(optionsPath)) ? await readFile(optionsPath, 'utf8') : '';
    const line = `resourcePacks:${JSON.stringify([...next].map((entry) => `file/${entry}`))}`;
    const output = /^resourcePacks:.*$/m.test(source)
      ? source.replace(/^resourcePacks:.*$/m, line)
      : `${source}${source && !source.endsWith('\n') ? '\n' : ''}${line}\n`;
    await writeFileAtomically(optionsPath, output);
    return this.resourcePacks();
  }

  async archiveResourcePack(name: string): Promise<readonly MyBattlyResourcePack[]> {
    await this.#assertResourcePack(name);
    const enabled = await enabledResourcePacks(join(this.root, 'options.txt'));
    if (enabled.has(name)) {
      await this.toggleResourcePack(name);
    }
    const archive = join(this.archiveRoot, 'resourcepacks');
    await mkdir(archive, { recursive: true });
    await rename(join(this.root, 'resourcepacks', name), join(archive, `${Date.now()}-${name}`));
    return this.resourcePacks();
  }

  #assertName(name: string): void {
    if (!safeEntryName(name)) {
      throw new TypeError('Invalid content name');
    }
  }

  async #assertResourcePack(name: string): Promise<void> {
    this.#assertName(name);
    if (!name.toLowerCase().endsWith('.zip')) {
      throw new TypeError('Invalid resource pack');
    }
    const info = await lstat(join(this.root, 'resourcepacks', name));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Invalid resource pack');
    }
  }
}
