import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Parser } from 'tar';
import { readBoundedRegularFile } from '../files/atomic-file';

export const terracottaVersion = '0.4.2-battly.3';

interface ReleaseTarget {
  version?: string;
  asset: string;
  sha256: string;
}

const targets: Record<string, ReleaseTarget> = {
  'win32-x64': {
    version: '0.4.2-battly.4-rc.1',
    asset: 'windows-x86_64',
    sha256: 'e1b9077d7d4b0bb433ec9c6a7e273ab631d06aa073faf8d3d33fcba0d009a960',
  },
  'win32-arm64': {
    asset: 'windows-arm64',
    sha256: '11a886f4d3c849becf2fa279c67c8c1b1b38ab592e2286075416b8bacea98750',
  },
  'linux-x64': {
    asset: 'linux-x86_64',
    sha256: '2cbe0f92974aafbf72e0d16d251f06065c27d395a165100d2c3386bf5c6823b2',
  },
  'linux-arm64': {
    asset: 'linux-arm64',
    sha256: 'f1dfd59926fdcfc05794569edf38a984d23106c0994be1f8535a4ebdc2441f95',
  },
  'linux-loong64': {
    asset: 'linux-loongarch64',
    sha256: '9e12faa634cf7c15e30ebbd3061550d0ded2c92394b754f3fac0e35ebfd6eb8d',
  },
  'linux-riscv64': {
    asset: 'linux-riscv64',
    sha256: 'af501952fc9872d07cffeaa6fd003725a6064f54fa954d09c8c65de4e06dd56c',
  },
  'darwin-x64': {
    asset: 'macos-x86_64',
    sha256: 'f00f793622329c0748aa63278e99ab5d71c723276768c959db95aaabf0e35121',
  },
  'darwin-arm64': {
    asset: 'macos-arm64',
    sha256: '04f241e1b4c02c7f91d89f15f8a59702677252e9fcb8d5d5aea1f15b085827f6',
  },
  'freebsd-x64': {
    asset: 'freebsd-x86_64',
    sha256: 'f41b8a6345f9ee947fba26568ebf9957b63bc8f446403afcc3971fa1ad8bf426',
  },
};

const maximumArchiveBytes = 32 * 1024 * 1024;
const maximumBinaryBytes = 64 * 1024 * 1024;
const downloadHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function downloadArchive(url: string, fetcher: typeof fetch): Promise<Buffer> {
  const signal = AbortSignal.timeout(60_000);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const destination = new URL(url);
    if (
      destination.protocol !== 'https:' ||
      destination.username ||
      destination.password ||
      !downloadHosts.has(destination.hostname)
    ) {
      throw new Error('Unsafe Terracotta download destination');
    }

    const response = await fetcher(url, { redirect: 'manual', signal });
    if (redirectStatuses.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Invalid Terracotta redirect');
      }
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error('Terracotta release download failed');
    }

    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maximumArchiveBytes) {
        throw new Error('Terracotta archive too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many Terracotta redirects');
}

async function writeAtomically(file: string, bytes: Buffer): Promise<void> {
  const temporaryFile = `${file}.${randomUUID()}.pending`;
  try {
    const handle = await open(temporaryFile, 'wx', 0o700);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryFile, file);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

async function readReleaseFiles(
  archive: Buffer,
  expectedExecutable: string,
  windows: boolean,
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const parser = new Parser({
    onReadEntry: (entry) => {
      const runtimeLibrary = windows && entry.path === 'VCRUNTIME140.DLL';
      if (entry.path !== expectedExecutable && !runtimeLibrary) {
        entry.resume();
        return;
      }
      if (entry.type !== 'File' || entry.size > maximumBinaryBytes || files.has(entry.path)) {
        parser.abort(new Error('Invalid Terracotta archive entry'));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      entry.on('data', (bytes: Buffer) => {
        size += bytes.length;
        if (size > maximumBinaryBytes) {
          parser.abort(new Error('Terracotta binary too large'));
        } else {
          chunks.push(bytes);
        }
      });
      entry.on('end', () => files.set(entry.path, Buffer.concat(chunks)));
    },
  });
  await pipeline(Readable.from([archive]), parser);
  if (!files.get(expectedExecutable)?.length) {
    throw new Error('Terracotta executable missing');
  }
  return files;
}

/** Prepara el binario fijado por hash; las llamadas simultáneas comparten la misma operación. */
export function terracottaRelease(
  cacheRoot: string,
  target = `${process.platform}-${process.arch}`,
  fetcher: typeof fetch = fetch,
): { executable: string; prepare: () => Promise<string> } {
  const selected = Object.hasOwn(targets, target) ? targets[target] : undefined;
  if (!selected) {
    throw new Error('Unsupported Terracotta platform');
  }
  const checksum = selected.sha256;
  const version = selected.version ?? terracottaVersion;
  const base = `terracotta-${version}-${selected.asset}`;
  const directory = join(cacheRoot, version, target);
  const windows = target.startsWith('win32-');
  const executable = join(directory, windows ? 'terracotta.exe' : 'terracotta');
  const archivePath = join(directory, 'release.tar.gz');
  const expectedExecutable = base + (windows ? '.exe' : '');
  let pending: Promise<string> | undefined;

  async function prepare(): Promise<string> {
    await mkdir(directory, { recursive: true });
    let archive = await readBoundedRegularFile(archivePath, maximumArchiveBytes).catch(() => null);
    if (!archive || hash(archive) !== checksum) {
      archive = await downloadArchive(
        `https://github.com/BattlyLauncher/Terracotta/releases/download/v${version}/${base}-pkg.tar.gz`,
        fetcher,
      );
      if (hash(archive) !== checksum) {
        throw new Error('Terracotta release checksum mismatch');
      }
      await writeAtomically(archivePath, archive);
    }

    const files = await readReleaseFiles(archive, expectedExecutable, windows);
    for (const [name, bytes] of files) {
      const destination =
        name === expectedExecutable ? executable : join(directory, 'VCRUNTIME140.DLL');
      const cached = await readBoundedRegularFile(destination, maximumBinaryBytes).catch(
        () => null,
      );
      if (!cached || hash(cached) !== hash(bytes)) {
        await writeAtomically(destination, bytes);
      }
      if (!windows) {
        await chmod(destination, 0o700);
      }
    }
    return executable;
  }

  function prepareOnce(): Promise<string> {
    pending ??= prepare().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return { executable, prepare: prepareOnce };
}
