import { lstat, readdir, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const contentRoots = new Set([
  'instances',
  'versions',
  'mods',
  'resourcepacks',
  'shaderpacks',
  'saves',
  'logs',
  'config',
]);
const maximumTextBytes = 16 * 1024;
const protectedFilename =
  /^(?:\.env|accounts?(?:\.json)?|tokens?(?:\.json)?|credentials.*|private.*|launcher_accounts\.json)$/i;
const privateKeyExtension = /\.(?:pem|pfx|key)$/i;

export class RemoteFiles {
  constructor(private readonly root: string) {}

  private async contentPath(value: unknown, allowMissing = false): Promise<string> {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) {
      throw new TypeError('Invalid content path');
    }
    const parts = value.replaceAll('\\', '/').split('/');
    if (parts.some((part) => protectedFilename.test(part) || privateKeyExtension.test(part))) {
      throw new Error('Protected file');
    }
    if (
      !contentRoots.has(parts[0]) ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      /^[A-Za-z]:/.test(value)
    ) {
      throw new Error('Path outside Battly content');
    }

    const target = resolve(this.root, ...parts);
    const local = relative(resolve(this.root), target);
    if (local.startsWith('..')) {
      throw new Error('Path outside Battly content');
    }

    let current = resolve(this.root);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error('Linked root is not accessible remotely');
    }
    for (let index = 0; index < parts.length; index += 1) {
      current = join(current, parts[index]);
      try {
        if ((await lstat(current)).isSymbolicLink()) {
          throw new Error('Links are not accessible remotely');
        }
      } catch (error) {
        const missingFinalEntry =
          allowMissing &&
          index === parts.length - 1 &&
          (error as NodeJS.ErrnoException).code === 'ENOENT';
        if (missingFinalEntry) {
          break;
        }
        throw error;
      }
    }
    return target;
  }

  async list(value: unknown): Promise<unknown> {
    if (value === '' || value === undefined) {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter(
          (entry) => contentRoots.has(entry.name) && entry.isDirectory() && !entry.isSymbolicLink(),
        )
        .map((entry) => ({ name: entry.name, isDirectory: true, size: 0 }));
    }
    const directory = await this.contentPath(value);
    const entries = await readdir(directory, { withFileTypes: true });
    const listed = await Promise.all(
      entries
        .filter((entry) => !entry.isSymbolicLink())
        .slice(0, 1000)
        .map(async (entry) => {
          try {
            const metadata = await lstat(join(directory, entry.name));
            if (metadata.isSymbolicLink()) {
              return undefined;
            }
            return { name: entry.name, isDirectory: metadata.isDirectory(), size: metadata.size };
          } catch (error) {
            // Minecraft puede mover un temporal entre readdir y lstat.
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              return undefined;
            }
            throw error;
          }
        }),
    );
    return listed.filter((entry) => entry !== undefined);
  }

  async read(value: unknown): Promise<string> {
    const file = await this.contentPath(value);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > maximumTextBytes) {
      throw new Error('Only text files up to 16 KiB can be opened');
    }
    const bytes = await readFile(file);
    if (bytes.includes(0)) {
      throw new Error('Binary file');
    }
    return bytes.toString('utf8');
  }

  async write(value: unknown, text: unknown): Promise<void> {
    if (typeof text !== 'string' || Buffer.byteLength(text) > maximumTextBytes) {
      throw new Error('File size limit');
    }
    const file = await this.contentPath(value, true);
    const temporary = join(dirname(file), '.remote-' + randomUUID());
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }

  async make(value: unknown): Promise<void> {
    await mkdir(await this.contentPath(value, true));
  }

  async archive(value: unknown): Promise<void> {
    const file = await this.contentPath(value);
    if (contentRoots.has(relative(this.root, file))) {
      throw new Error('Cannot archive content roots');
    }

    const trash = join(this.root, '.remote-trash');
    await mkdir(trash, { recursive: true });
    if ((await lstat(trash)).isSymbolicLink()) {
      throw new Error('Invalid archive directory');
    }

    const id = randomUUID();
    await writeFile(
      join(trash, id + '.json'),
      JSON.stringify({ original: relative(this.root, file), date: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600 },
    );
    await rename(file, join(trash, id));
  }
}
