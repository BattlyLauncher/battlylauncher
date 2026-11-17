import { strict as assert } from 'node:assert';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
  open,
  statfs,
  unlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, parse } from 'node:path';
import type {
  BattlyDataRootSnapshot,
  DataRootProgress,
} from '../../shared/settings/data-root-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

function nested(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part));
}
async function safePath(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    if (await pathExists(current)) {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error('Symbolic links are not supported for migration');
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}
async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose portable directory fsync through Node. Files are flushed on all platforms.
  if (process.platform === 'win32') {
    return;
  }
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function hash(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    const data: unknown = chunk;
    assert(Buffer.isBuffer(data));
    digest.update(data);
  }
  return digest.digest('hex');
}
interface Entry {
  path: string;
  size: number;
  mtime: number;
  mode: number;
  directory: boolean;
}
async function inventory(root: string, sub = ''): Promise<Entry[]> {
  const result: Entry[] = [];
  for (const name of (await readdir(resolve(root, sub))).sort()) {
    const path = sub ? `${sub}/${name}` : name;
    const info = await lstat(resolve(root, path));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error('Unsupported entry in Battly data');
    }
    result.push({
      path,
      size: info.isDirectory() ? 0 : info.size,
      mtime: info.mtimeMs,
      mode: info.mode,
      directory: info.isDirectory(),
    });
    if (info.isDirectory()) {
      // Instance trees can contain hundreds of thousands of entries. Spreading
      // them into push exceeds V8's argument limit before copying even starts.
      for (const entry of await inventory(root, path)) {
        result.push(entry);
      }
    }
  }
  return result;
}
interface Journal {
  source: string;
  target: string;
  staging: string;
}
export class BattlyDataRootService {
  #busy = false;
  #recovered = false;
  #recovery?: string;
  constructor(
    private readonly configPath: string,
    private readonly defaultPath: string,
    private readonly progress: (value: DataRootProgress) => void = () => {},
  ) {
    if (![configPath, defaultPath].every(isAbsolute)) {
      throw new TypeError('Battly data paths must be absolute');
    }
  }
  get busy(): boolean {
    return this.#busy;
  }
  get journalPath(): string {
    return `${this.configPath}.migration.json`;
  }
  async #save(path: string, value: unknown): Promise<void> {
    await writeFileAtomically(path, JSON.stringify(value));
    await syncDirectory(dirname(path));
  }
  async #recover(): Promise<void> {
    if (this.#recovered) {
      return;
    }
    if (await pathExists(this.journalPath)) {
      const journal = JSON.parse(
        (await readBoundedRegularFile(this.journalPath, 16384)).toString(),
      ) as Journal;
      if (
        ![journal.source, journal.target, journal.staging].every(
          (value) => typeof value === 'string' && isAbsolute(value),
        )
      ) {
        throw new Error('Invalid migration recovery record');
      }
      await safePath(journal.source);
      if (!(await lstat(journal.source)).isDirectory()) {
        throw new Error('Reconnect the original Battly data drive to recover migration');
      }
      // Original data is never removed. No application writes to the new root until the journal is cleared.
      await this.#save(this.configPath, { path: journal.source });
      this.#recovery = (await pathExists(journal.target)) ? journal.target : journal.staging;
      await unlink(this.journalPath);
      await syncDirectory(dirname(this.journalPath));
    }
    this.#recovered = true;
  }
  async snapshot(): Promise<BattlyDataRootSnapshot> {
    if (!this.#busy) {
      await this.#recover();
    }
    let currentPath = this.defaultPath;
    if (await pathExists(this.configPath)) {
      const parsed = JSON.parse(
        (await readBoundedRegularFile(this.configPath, 8192)).toString(),
      ) as { path?: unknown };
      if (typeof parsed.path !== 'string' || !isAbsolute(parsed.path)) {
        throw new Error('Invalid Battly data location; restore its configuration');
      }
      currentPath = resolve(parsed.path);
      await safePath(currentPath);
      if (!(await lstat(currentPath)).isDirectory()) {
        throw new Error('Reconnect the Battly data drive before continuing');
      }
    }
    return {
      configurable: true,
      currentPath,
      defaultPath: this.defaultPath,
      custom: currentPath !== this.defaultPath,
      recoveryPath: this.#recovery,
    };
  }
  async migrate(targetValue: string): Promise<BattlyDataRootSnapshot> {
    if (this.#busy) {
      throw new Error('A migration is already running');
    }
    const source = (await this.snapshot()).currentPath;
    if (this.#busy) {
      throw new Error('A migration is already running');
    }
    this.#busy = true;
    let journalWritten = false;
    try {
      if (!isAbsolute(targetValue) || targetValue.length > 4096) {
        throw new Error('Invalid destination');
      }
      const target = resolve(targetValue);
      if (nested(source, target) || nested(target, source) || target === parse(target).root) {
        throw new Error('Source and destination must be separate folders');
      }
      await safePath(source);
      await safePath(target);
      if (!(await lstat(source)).isDirectory()) {
        throw new Error('The original Battly data folder is unavailable');
      }
      if (await pathExists(target)) {
        if (!(await lstat(target)).isDirectory() || (await readdir(target)).length) {
          throw new Error('Destination must be empty');
        }
      }
      const parent = dirname(target);
      // Windows rejects mkdir('D:\\', { recursive: true }) even when the drive
      // exists. Only create missing parents; never try to create a volume root.
      if (!(await pathExists(parent))) {
        await mkdir(parent, { recursive: true });
      }
      if (!(await lstat(parent)).isDirectory()) {
        throw new Error('Invalid destination');
      }
      this.progress({ phase: 'checking', source, target, bytes: 0, total: 0, file: '' });
      const entries = await inventory(source);
      const total = entries.reduce((sum, entry) => sum + entry.size, 0);
      const space = await statfs(parent);
      if (space.bavail * space.bsize < total + 64 * 1024 * 1024) {
        throw new Error('Insufficient free disk space');
      }
      const staging = resolve(parent, `.battly-data-${randomUUID()}.staging`);
      await this.#save(this.journalPath, { source, target, staging });
      journalWritten = true;
      await mkdir(staging);
      let bytes = 0,
        lastProgress = 0;
      const hashes = new Map<string, string>();
      for (const entry of entries) {
        const from = resolve(source, entry.path),
          to = resolve(staging, entry.path);
        if (entry.directory) {
          await mkdir(to, { mode: entry.mode | 0o700 });
          continue;
        }
        const digest = createHash('sha256');
        const output = await open(to, 'wx', entry.mode);
        try {
          for await (const chunk of createReadStream(from)) {
            const buffer = chunk as Buffer;
            let offset = 0;
            while (offset < buffer.length) {
              offset += (await output.write(buffer, offset, buffer.length - offset)).bytesWritten;
            }
            digest.update(buffer);
            bytes += buffer.length;
            if (Date.now() - lastProgress > 100) {
              this.progress({ phase: 'copying', source, target, bytes, total, file: entry.path });
              lastProgress = Date.now();
            }
          }
          await output.chmod(entry.mode);
          await output.sync();
        } finally {
          await output.close();
        }
        hashes.set(entry.path, digest.digest('hex'));
      }
      let verified = 0;
      for (const entry of entries.filter((entry) => !entry.directory)) {
        this.progress({
          phase: 'verifying',
          source,
          target,
          bytes: verified,
          total,
          file: entry.path,
        });
        if (
          (await hash(resolve(staging, entry.path))) !== hashes.get(entry.path) ||
          (await hash(resolve(source, entry.path))) !== hashes.get(entry.path)
        ) {
          throw new Error('Data changed or verification failed; original location retained');
        }
        verified += entry.size;
      }
      const finalEntries = await inventory(source);
      if (JSON.stringify(entries) !== JSON.stringify(finalEntries)) {
        throw new Error('Source changed during migration; close applications and retry');
      }
      for (const entry of [...entries].reverse()) {
        if (entry.directory) {
          await chmod(resolve(staging, entry.path), entry.mode);
          await syncDirectory(resolve(staging, entry.path));
        }
      }
      await syncDirectory(staging);
      this.progress({ phase: 'committing', source, target, bytes: total, total, file: '' });
      await safePath(target);
      if (await pathExists(target)) {
        await rmdir(target);
      } // Fails if another process populated it.
      await rename(staging, target);
      await syncDirectory(parent);
      await this.#save(this.configPath, { path: target });
      await unlink(this.journalPath);
      journalWritten = false;
      // The new root is committed. A cleanup flush failure must not resume writers on the old root.
      await syncDirectory(dirname(this.journalPath)).catch(() =>
        console.warn('[migration] Journal cleanup flush failed'),
      );
      this.progress({ phase: 'complete', source, target, bytes: total, total, file: '' });
      return {
        configurable: true,
        currentPath: target,
        defaultPath: this.defaultPath,
        custom: target !== this.defaultPath,
      };
    } catch (error) {
      if (journalWritten) {
        await this.#save(this.configPath, { path: source });
        this.#recovered = false; // Next start reconciles the journal; partial copies remain available.
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }
}
