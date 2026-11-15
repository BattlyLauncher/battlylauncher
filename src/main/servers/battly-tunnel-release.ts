import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

export const tunnelReleaseRepository = 'BattlyLauncher/BattlyTunnel';
export const tunnelReleaseVersion = '1.0.1';
const maximumBytes = 128 * 1024 * 1024;
const allowedHosts = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
interface ReleaseEntry {
  target: string;
  role: string;
  file: string;
  bytes: number;
  sha256: string;
}

async function download(url: string, limit: number, fetcher: typeof fetch): Promise<Buffer> {
  let current = new URL(url);
  const signal = AbortSignal.timeout(60_000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      current.protocol !== 'https:' ||
      current.username ||
      current.password ||
      !allowedHosts.has(current.hostname)
    ) {
      throw new Error('Unsafe tunnel release destination');
    }
    const response = await fetcher(current.href, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Invalid tunnel release redirect');
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Tunnel release download failed (${response.status})`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (declared > limit) {
      await response.body.cancel();
      throw new Error('Tunnel release exceeds size limit');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        size += next.value.byteLength;
        if (size > limit) {
          throw new Error('Tunnel release exceeds size limit');
        }
        chunks.push(Buffer.from(next.value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }
  throw new Error('Too many tunnel release redirects');
}

export function tunnelReleaseClient(
  cacheRoot: string,
  target = `${process.platform}-${process.arch}`,
  fetcher: typeof fetch = fetch,
) {
  if (!/^(win32-(x64|ia32|arm64)|linux-(x64|arm64)|darwin-(x64|arm64))$/.test(target)) {
    throw new Error('Unsupported tunnel platform');
  }
  const directory = join(cacheRoot, tunnelReleaseVersion, target);
  const asset = `battly-tunnel-client-${target}${target.startsWith('win32-') ? '.exe' : ''}`;
  const executable = join(directory, asset);
  const manifestPath = join(directory, 'manifest.json');
  const releaseUrl = `https://github.com/${tunnelReleaseRepository}/releases/download/v${tunnelReleaseVersion}`;
  let pending: Promise<void> | undefined;
  const prepare = async (): Promise<void> => {
    let manifestBytes: Buffer;
    if (await pathExists(manifestPath)) {
      manifestBytes = await readBoundedRegularFile(manifestPath, 1024 * 1024);
    } else {
      manifestBytes = await download(`${releaseUrl}/manifest.json`, 1024 * 1024, fetcher);
    }
    const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Invalid tunnel manifest');
    }
    const record = manifest as { version?: unknown; entries?: unknown };
    if (
      record.version !== tunnelReleaseVersion ||
      !Array.isArray(record.entries) ||
      record.entries.length > 32
    ) {
      throw new Error('Invalid tunnel release version');
    }
    const matches = record.entries.filter(
      (value: ReleaseEntry) => value && value.role === 'client' && value.target === target,
    );
    if (matches.length !== 1) {
      throw new Error('Tunnel release target missing or duplicated');
    }
    const entry = matches[0] as ReleaseEntry;
    if (
      entry.file !== asset ||
      !Number.isInteger(entry.bytes) ||
      entry.bytes < 1 ||
      entry.bytes > maximumBytes ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error('Invalid tunnel release asset');
    }
    const valid = (bytes: Buffer): boolean =>
      bytes.length === entry.bytes &&
      createHash('sha256').update(bytes).digest('hex') === entry.sha256;
    if (await pathExists(executable)) {
      if (!valid(await readBoundedRegularFile(executable, maximumBytes))) {
        throw new Error('El componente Battly Tunnel está dañado');
      }
    } else {
      const bytes = await download(`${releaseUrl}/${asset}`, maximumBytes, fetcher);
      if (!valid(bytes)) {
        throw new Error('El componente Battly Tunnel está dañado');
      }
      await mkdir(dirname(executable), { recursive: true });
      const temporary = `${executable}.${randomUUID()}.pending`;
      try {
        const file = await open(temporary, 'wx', 0o700);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, executable);
      } finally {
        await rm(temporary, { force: true });
      }
    }
    await writeFileAtomically(manifestPath, manifestBytes);
    if (!target.startsWith('win32-')) {
      await chmod(executable, 0o700);
    }
  };
  return {
    executable,
    prepare: (): Promise<void> =>
      (pending ??= prepare().finally(() => {
        pending = undefined;
      })),
  };
}
