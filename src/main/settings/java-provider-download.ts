import { createHash } from 'node:crypto';
import { mkdir, open, readdir, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { runtimeLinkTarget } from '../files/runtime-link';
import type {
  JavaRuntimeProvider,
  ManagedJavaMajor,
} from '../../shared/settings/java-runtime-contract';

const limit = 2 * 1024 ** 3;
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Java provider response');
  }
  return value as Json;
}
function checkedUrl(value: unknown): string {
  const url = new URL(String(value));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    ![
      'api.adoptium.net',
      'api.azul.com',
      'cdn.azul.com',
      'github.com',
      'release-assets.githubusercontent.com',
      'objects.githubusercontent.com',
    ].includes(url.hostname)
  ) {
    throw new Error('Untrusted Java download URL');
  }
  return url.href;
}
async function response(fetcher: typeof fetch, url: string): Promise<Response> {
  for (let count = 0; count < 8; count++) {
    const result = await fetcher(checkedUrl(url), {
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
    });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      url = new URL(result.headers.get('location') ?? '', url).href;
      await result.body?.cancel();
      continue;
    }
    if (!result.ok) {
      throw new Error(`Java provider request failed (${result.status})`);
    }
    return result;
  }
  throw new Error('Too many Java download redirects');
}
async function json(fetcher: typeof fetch, url: string): Promise<unknown> {
  const result = await response(fetcher, url);
  if (!result.body) {
    throw new Error('Empty Java metadata');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of result.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > 8 * 1024 ** 2) {
      throw new Error('Java metadata too large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export interface JavaArchive {
  url: string;
  sha256: string;
  size: number;
  version: string;
  zip: boolean;
  sizeIsExact?: boolean;
}
export async function resolveJavaArchive(
  provider: Exclude<JavaRuntimeProvider, 'mojang'>,
  major: ManagedJavaMajor,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
  fetcher: typeof fetch,
): Promise<JavaArchive> {
  const os =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin'
        ? 'mac'
        : platform === 'linux'
          ? 'linux'
          : null;
  if (!os || !['x64', 'ia32', 'arm64'].includes(architecture)) {
    throw new Error('Plataforma de Java no compatible');
  }
  let metadata: Json | undefined;
  let version = '';
  // Prefer the smaller JRE, but some releases only publish a JDK.
  for (const kind of ['jre', 'jdk']) {
    if (provider === 'adoptium') {
      const arch = architecture === 'arm64' ? 'aarch64' : architecture === 'ia32' ? 'x86' : 'x64';
      const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&os=${os}&image_type=${kind}&vendor=eclipse`;
      let releases: unknown;
      try {
        releases = await json(fetcher, url);
      } catch (error) {
        if (error instanceof Error && error.message.includes('(404)')) {
          continue;
        }
        throw error;
      }
      if (!Array.isArray(releases) || !releases.length) {
        continue;
      }
      const release = object(releases[0]);
      const binary = object(release.binary);
      if (binary.architecture !== arch || binary.os !== os) {
        throw new Error('Java provider architecture mismatch');
      }
      metadata = object(binary.package);
      version = String(object(release.version).semver);
    } else {
      const query = new URLSearchParams({
        java_version: String(major),
        os: os === 'mac' ? 'macos' : os,
        arch: architecture === 'arm64' ? 'arm' : 'x86',
        hw_bitness: architecture === 'ia32' ? '32' : '64',
        java_package_type: kind,
        archive_type: os === 'windows' ? 'zip' : 'tar.gz',
        javafx_bundled: 'false',
        release_status: 'ga',
        availability_types: 'CA',
        latest: 'true',
        page_size: '1',
      });
      const releases = await json(
        fetcher,
        `https://api.azul.com/metadata/v1/zulu/packages/?${query}`,
      );
      if (!Array.isArray(releases) || !releases.length) {
        continue;
      }
      const id = object(releases[0]).package_uuid;
      if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) {
        throw new Error('Invalid Zulu package');
      }
      const detail = object(
        await json(fetcher, `https://api.azul.com/metadata/v1/zulu/packages/${id}`),
      );
      if (
        detail.hw_bitness !== (architecture === 'ia32' ? 32 : 64) ||
        !Array.isArray(detail.java_version) ||
        detail.java_version[0] !== major
      ) {
        throw new Error('Zulu package mismatch');
      }
      metadata = { link: detail.download_url, checksum: detail.sha256_hash, size: detail.size };
      version = detail.java_version.join('.');
    }
    break;
  }
  if (!metadata) {
    throw new Error(
      `Java ${major} no está disponible en ${provider} para ${os}/${architecture}. Selecciona otro proveedor.`,
    );
  }
  if (
    typeof metadata.checksum !== 'string' ||
    !/^[a-f\d]{64}$/i.test(metadata.checksum) ||
    typeof metadata.size !== 'number' ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size <= 0 ||
    metadata.size > limit
  ) {
    throw new Error('Invalid Java package checksum or size');
  }
  return {
    url: checkedUrl(metadata.link),
    sha256: metadata.checksum.toLowerCase(),
    size: metadata.size,
    version,
    zip: os === 'windows',
    sizeIsExact: provider === 'adoptium',
  };
}

export async function installJavaArchive(
  archive: JavaArchive,
  staging: string,
  fetcher: typeof fetch,
  progress: (current: number, total: number) => void,
  extracting: () => void = () => {},
): Promise<string> {
  const path = join(staging, archive.zip ? 'java.zip' : 'java.tar.gz');
  const result = await response(fetcher, archive.url);
  if (!result.body) {
    throw new Error('Empty Java download');
  }
  const declaredSize = Number(result.headers.get('content-length'));
  const total =
    Number.isSafeInteger(declaredSize) && declaredSize > 0 ? declaredSize : archive.size;
  if (total > limit) {
    throw new Error('Java download exceeds size limit');
  }
  const handle = await open(path, 'wx');
  const digest = createHash('sha256');
  let bytes = 0;
  let lastProgress = 0;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let buffered = 0;
  try {
    for await (const chunk of result.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > limit || (archive.sizeIsExact !== false && bytes > archive.size)) {
        throw new Error('Java download size mismatch');
      }
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const length = Math.min(buffer.length - buffered, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + length), buffered);
        buffered += length;
        offset += length;
        if (buffered === buffer.length) {
          await handle.writeFile(buffer);
          buffered = 0;
        }
      }
      if (Date.now() - lastProgress >= 100) {
        progress(bytes, total);
        lastProgress = Date.now();
      }
    }
    if (buffered) {
      await handle.writeFile(buffer.subarray(0, buffered));
    }
    progress(bytes, total);
  } finally {
    await handle.close();
  }
  if (archive.sizeIsExact !== false && bytes !== archive.size) {
    throw new Error('Java download size mismatch');
  }
  if (digest.digest('hex') !== archive.sha256) {
    throw new Error('Java download checksum mismatch');
  }
  extracting();
  const extracted = join(staging, 'extracted');
  await mkdir(extracted);
  let files = 0,
    expanded = 0;
  function safe(path: string, size: number): string {
    const destination = resolve(extracted, path);
    const rel = relative(extracted, destination);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === '..' ||
      rel.startsWith('..\\') ||
      rel.startsWith('../') ||
      path.includes('\\') ||
      path.includes(':')
    ) {
      throw new Error('Unsafe Java archive path');
    }
    if (++files > 20000 || (expanded += size) > limit) {
      throw new Error('Java archive exceeds limits');
    }
    return destination;
  }
  if (archive.zip) {
    const zip = new AdmZip(path);
    for (const entry of zip.getEntries()) {
      const destination = safe(entry.entryName, entry.header.size);
      if (((entry.attr >>> 16) & 0xf000) === 0xa000) {
        throw new Error('Unexpected Java ZIP link');
      }
      if (entry.isDirectory) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, entry.getData(), { flag: 'wx' });
    }
  } else {
    let invalidEntry: Error | undefined;
    await tar.t({
      file: path,
      onReadEntry: (entry) => {
        try {
          const destination = safe(entry.path, entry.size);
          if (!['File', 'Directory', 'SymbolicLink'].includes(entry.type)) {
            throw new Error('Unsupported Java archive entry');
          }
          if (entry.type === 'SymbolicLink') {
            runtimeLinkTarget(extracted, destination, entry.linkpath ?? '');
          }
        } catch (error) {
          invalidEntry = error instanceof Error ? error : new Error('Invalid Java archive');
        }
      },
    });
    if (invalidEntry) {
      throw invalidEntry;
    }
    await tar.x({ file: path, cwd: extracted, strict: true, preservePaths: false });
  }
  const roots = await readdir(extracted, { withFileTypes: true });
  if (roots.length !== 1 || !roots[0].isDirectory()) {
    throw new Error('Unexpected Java archive layout');
  }
  let root = join(extracted, roots[0].name);
  if ((await readdir(root)).includes('Contents')) {
    root = join(root, 'Contents', 'Home');
  }
  const runtime = join(staging, 'runtime');
  await rename(root, runtime);
  if (!archive.zip) {
    await chmod(join(runtime, 'bin', 'java'), 0o755);
  }
  return runtime;
}
