import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { readBoundedRegularFile } from '../files/atomic-file';

export const overlayReleaseRepository = 'BattlyLauncher/BattlyOverlay';
export const overlayReleaseVersion = '1.0.4';
const limit = 32 * 1024 * 1024;
const hosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
export interface OverlayPackage {
  directory: string;
  renderer: string;
  tracker: string;
}
interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
  executable: boolean;
}
interface Entry {
  target: string;
  file: string;
  bytes: number;
  sha256: string;
  files: FileEntry[];
}
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const validHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function download(url: string, maximum: number, fetcher: typeof fetch): Promise<Buffer> {
  let current = new URL(url);
  const signal = AbortSignal.timeout(60_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.port ||
      current.username ||
      current.password ||
      !hosts.has(current.hostname)
    ) {
      throw new Error('Unsafe overlay release destination');
    }
    const response = await fetcher(current.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Missing overlay redirect');
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Overlay release unavailable (${response.status})`);
    }
    const reader = response.body.getReader(),
      chunks: Buffer[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get('content-length')) > maximum) {
        throw new Error('Overlay download exceeds limit');
      }
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        size += chunk.value.byteLength;
        if (size > maximum) {
          throw new Error('Overlay download exceeds limit');
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error('Too many overlay redirects');
}

function manifestEntry(bytes: Buffer, target: string): Entry {
  const manifest = JSON.parse(bytes.toString('utf8')) as {
    version: unknown;
    protocol: unknown;
    entries: Entry[];
  };
  if (
    !manifest ||
    manifest.version !== overlayReleaseVersion ||
    manifest.protocol !== 1 ||
    !Array.isArray(manifest.entries) ||
    manifest.entries.length > 16
  ) {
    throw new Error('Incompatible overlay manifest');
  }
  const entries = manifest.entries.filter((entry) => entry && entry.target === target);
  if (entries.length !== 1) {
    throw new Error('Overlay target missing or duplicated');
  }
  const entry = entries[0],
    tracker = target.startsWith('win32-') ? 'WindowTracker.exe' : 'WindowTracker';
  if (
    entry.file !== `battly-overlay-${target}.zip` ||
    !validHash(entry.sha256) ||
    !Number.isSafeInteger(entry.bytes) ||
    entry.bytes < 1 ||
    entry.bytes > limit ||
    !Array.isArray(entry.files) ||
    entry.files.length < 2 ||
    entry.files.length > 512
  ) {
    throw new Error('Invalid overlay package');
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of entry.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      file.path.length > 240 ||
      !/^[a-zA-Z0-9_./-]+$/.test(file.path) ||
      file.path
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
      seen.has(file.path.toLowerCase()) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      file.bytes > limit ||
      !validHash(file.sha256) ||
      typeof file.executable !== 'boolean' ||
      file.executable !== (file.path === tracker)
    ) {
      throw new Error('Invalid overlay file');
    }
    seen.add(file.path.toLowerCase());
    total += file.bytes;
  }
  if (
    total > limit ||
    !entry.files.some((file) => file.path === 'renderer/worlds-overlay.html') ||
    !entry.files.some((file) => file.path === tracker)
  ) {
    throw new Error('Incomplete overlay package');
  }
  return entry;
}

async function ensureDirectory(path: string): Promise<void> {
  // Check ancestors too: a replaced cache parent must not redirect executable writes.
  const parent = dirname(path);
  if (parent !== path) {
    await ensureDirectory(parent);
  }
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Unsafe overlay cache directory');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await mkdir(path);
  }
}

export function overlayRelease(
  cacheRoot: string,
  target = `${process.platform}-${process.arch}`,
  fetcher: typeof fetch = fetch,
) {
  if (!/^(win32-(ia32|x64)|linux-(x64|arm64)|darwin-(x64|arm64))$/.test(target)) {
    throw new Error('Unsupported overlay platform');
  }
  const parent = join(cacheRoot, overlayReleaseVersion),
    directory = join(parent, target);
  const metadata = join(directory, 'release-manifest.json');
  const base = `https://github.com/${overlayReleaseRepository}/releases/download/v${overlayReleaseVersion}`;
  const tracker = target.startsWith('win32-') ? 'WindowTracker.exe' : 'WindowTracker';
  let pending: Promise<OverlayPackage> | undefined;
  const result = (): OverlayPackage => ({
    directory,
    renderer: join(directory, 'renderer', 'worlds-overlay.html'),
    tracker: join(directory, tracker),
  });
  const verify = async (entry: Entry): Promise<void> => {
    const expected = new Set(entry.files.map((file) => file.path));
    expected.add('release-manifest.json');
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      const info = await lstat(dir);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error('Unsafe overlay cache directory');
      }
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const name = prefix + item.name;
        if (item.isDirectory() && !item.isSymbolicLink()) {
          await walk(join(dir, item.name), name + '/');
        } else if (!item.isFile() || !expected.has(name)) {
          throw new Error('Unexpected overlay cache entry');
        }
      }
    };
    await walk(directory);
    for (const file of entry.files) {
      const bytes = await readBoundedRegularFile(join(directory, file.path), file.bytes);
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) {
        throw new Error('Overlay cache integrity check failed');
      }
    }
  };
  const prepare = async (): Promise<OverlayPackage> => {
    await ensureDirectory(parent);
    let cached: Buffer | undefined;
    try {
      cached = await readBoundedRegularFile(metadata, 1024 * 1024);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (cached) {
      await verify(manifestEntry(cached, target));
      return result();
    }
    const manifest = await download(`${base}/manifest.json`, 1024 * 1024, fetcher);
    const entry = manifestEntry(manifest, target);
    const bytes = await download(`${base}/${entry.file}`, limit, fetcher);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) {
      throw new Error('Overlay archive integrity check failed');
    }
    const archive = new AdmZip(bytes),
      files = archive.getEntries();
    if (files.length !== entry.files.length) {
      throw new Error('Unexpected overlay archive entries');
    }
    const expected = new Map(entry.files.map((file) => [file.path, file]));
    const staging = join(parent, `${target}.${randomUUID()}.pending`);
    await mkdir(staging);
    try {
      for (const item of files) {
        const file = expected.get(item.entryName);
        const mode = (item.attr >>> 16) & 0o170000;
        if (
          !file ||
          item.isDirectory ||
          (mode && mode !== 0o100000) ||
          item.header.size !== file.bytes
        ) {
          throw new Error('Invalid overlay archive entry');
        }
        expected.delete(item.entryName);
        const data = item.getData();
        if (data.length !== file.bytes || hash(data) !== file.sha256) {
          throw new Error('Overlay file integrity check failed');
        }
        const destination = join(staging, file.path);
        await mkdir(dirname(destination), { recursive: true });
        const handle = await open(destination, 'wx', file.executable ? 0o700 : 0o600);
        try {
          await handle.writeFile(data);
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (file.executable && !target.startsWith('win32-')) {
          await chmod(destination, 0o700);
        }
      }
      const handle = await open(join(staging, 'release-manifest.json'), 'wx', 0o600);
      try {
        await handle.writeFile(manifest);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(staging, directory);
      } catch (error) {
        // Another launcher process may have installed the same immutable version.
        if (
          !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')
        ) {
          throw error;
        }
        await verify(entry);
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await verify(entry);
    return result();
  };
  return {
    prepare: (): Promise<OverlayPackage> =>
      (pending ??= prepare().finally(() => {
        pending = undefined;
      })),
  };
}
