import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { release } from 'node:os';
import AdmZip from 'adm-zip';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): RecordValue =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as RecordValue) : {};
const digest = (b: Buffer, algorithm = 'sha256'): string =>
  createHash(algorithm).update(b).digest('hex');
const nativeFile = /\.(?:dll|dylib|jnilib|so(?:\.\d+)*)$/i;
const maxArchive = 64 * 1024 * 1024;
export interface NativeTarget {
  platform: NodeJS.Platform;
  arch: string;
  osVersion?: string;
}
export interface NativeArtifact {
  name: string;
  path: string;
  url: string;
  sha1: string;
}
export interface LwjglNativePlan {
  versions: readonly string[];
  artifacts: readonly NativeArtifact[];
  fingerprint: string;
}

function matches(expression: unknown, value: string, whole = false): boolean {
  if (typeof expression !== 'string' || expression.length > 128) {
    return false;
  }
  try {
    return new RegExp(whole ? `^(?:${expression})$` : expression).test(value);
  } catch {
    return false;
  }
}
export function nativeLibraryAllowed(library: RecordValue, target: NativeTarget): boolean {
  if (!Array.isArray(library.rules)) {
    return true;
  }
  let allowed = false;
  const os =
    target.platform === 'win32'
      ? 'windows'
      : target.platform === 'darwin'
        ? 'osx'
        : target.platform;
  const arch =
    target.arch === 'x64'
      ? 'amd64'
      : target.arch === 'ia32'
        ? 'x86'
        : target.arch === 'arm64'
          ? 'aarch64'
          : target.arch;
  for (const raw of library.rules) {
    const rule = object(raw),
      system = object(rule.os),
      features = object(rule.features);
    if (system.name && system.name !== os) {
      continue;
    }
    if (
      system.arch &&
      !matches(system.arch, arch, true) &&
      !matches(system.arch, target.arch === 'x64' ? 'x86_64' : target.arch, true)
    ) {
      continue;
    }
    if (system.version && !matches(system.version, target.osVersion ?? release())) {
      continue;
    }
    if (Object.values(features).some((v) => v !== false)) {
      continue;
    }
    allowed = rule.action === 'allow';
  }
  return allowed;
}
function coordinate(name: string): {
  group: string;
  module: string;
  version: string;
  classifier?: string;
} {
  const [group, module, version, classifier, ...extra] = name.split(':');
  if (
    !group ||
    !module ||
    !version ||
    extra.length ||
    ![group, module, version, classifier ?? 'valid'].every((p) =>
      /^[a-zA-Z0-9_.+-]{1,160}$/.test(p),
    )
  ) {
    throw new Error('Invalid native Maven coordinate');
  }
  return { group, module, version, classifier };
}
function artifact(name: string, raw: unknown, classifier?: string): NativeArtifact {
  const entry = object(raw),
    c = coordinate(name);
  const path =
    typeof entry.path === 'string'
      ? entry.path
      : `${c.group.replaceAll('.', '/')}/${c.module}/${c.version}/${c.module}-${c.version}${classifier ? '-' + classifier : c.classifier ? '-' + c.classifier : ''}.jar`;
  if (
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':'))
  ) {
    throw new Error('Unsafe native archive path');
  }
  if (
    entry.sha1 !== undefined &&
    (typeof entry.sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(entry.sha1))
  ) {
    throw new Error(`Invalid native checksum: ${name}`);
  }
  const url = new URL(
    typeof entry.url === 'string' ? entry.url : `https://libraries.minecraft.net/${path}`,
  );
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Unsafe native archive URL');
  }
  return {
    name,
    path,
    url: url.href,
    sha1: typeof entry.sha1 === 'string' ? entry.sha1.toLowerCase() : '',
  };
}
/** Uses the first applicable Java artifact, matching the classpath order. */
export function planLwjglNatives(metadata: unknown, target: NativeTarget): LwjglNativePlan | null {
  const libraries = object(metadata).libraries;
  if (!Array.isArray(libraries)) {
    return null;
  }
  const active = libraries.map(object).filter((l) => nativeLibraryAllowed(l, target));
  const versions = new Map<string, string>();
  for (const l of active) {
    if (typeof l.name !== 'string' || !/^org\.lwjgl(?:\.lwjgl)?:/.test(l.name)) {
      continue;
    }
    const c = coordinate(l.name);
    if (
      ((c.group === 'org.lwjgl.lwjgl' && c.module === 'lwjgl') || c.group === 'org.lwjgl') &&
      // Minecraft 26.2 selects LWJGL's Java core with the unsafe classifier.
      (!c.classifier ||
        (c.group === 'org.lwjgl' && c.module === 'lwjgl' && c.classifier === 'unsafe')) &&
      !versions.has(c.group + ':' + c.module)
    ) {
      versions.set(c.group + ':' + c.module, c.version);
    }
  }
  if (!versions.size) {
    return null;
  }
  if (!['x64', 'ia32', 'arm64'].includes(target.arch)) {
    throw new Error(`Unsupported LWJGL native architecture: ${target.arch}`);
  }
  const os =
    target.platform === 'win32'
      ? 'windows'
      : target.platform === 'darwin'
        ? 'osx'
        : target.platform;
  const artifacts: NativeArtifact[] = [],
    seen = new Set<string>();
  for (const l of active) {
    if (typeof l.name !== 'string' || !/^org\.lwjgl(?:\.lwjgl)?:/.test(l.name)) {
      continue;
    }
    const c = coordinate(l.name),
      lwjgl = c.group === 'org.lwjgl' || c.group === 'org.lwjgl.lwjgl';
    const expected = versions.get(
      c.group + ':' + (c.module === 'lwjgl-platform' ? 'lwjgl' : c.module),
    );
    if (!expected || expected !== c.version) {
      continue;
    }
    const downloads = object(l.downloads),
      natives = object(l.natives),
      classifiers = object(downloads.classifiers);
    let selected: NativeArtifact | undefined;
    if (typeof natives[os] === 'string') {
      if (target.arch !== 'x64' && target.arch !== 'ia32') {
        throw new Error(`LWJGL ${c.version} does not provide legacy natives for ${target.arch}`);
      }
      const classifier = natives[os].replaceAll('${arch}', target.arch === 'ia32' ? '32' : '64');
      selected = artifact(l.name, classifiers[classifier], classifier);
    } else if (c.classifier?.startsWith('natives-') && lwjgl) {
      const classifierOs = target.platform === 'darwin' ? 'macos' : os;
      const suffix = target.arch === 'arm64' ? '-arm64' : target.arch === 'ia32' ? '-x86' : '';
      if (c.classifier !== `natives-${classifierOs}${suffix}`) {
        continue;
      }
      selected = artifact(l.name, downloads.artifact);
    }
    if (selected && !seen.has(selected.path)) {
      artifacts.push(selected);
      seen.add(selected.path);
    }
  }
  const core = versions.has('org.lwjgl.lwjgl:lwjgl')
    ? 'org.lwjgl.lwjgl:lwjgl-platform:'
    : 'org.lwjgl:lwjgl:';
  if (!artifacts.some((a) => a.name.startsWith(core))) {
    throw new Error('LWJGL native metadata does not match the selected platform and architecture');
  }
  const fingerprint = digest(
    Buffer.from(
      JSON.stringify({
        platform: target.platform,
        arch: target.arch,
        versions: [...versions],
        artifacts: artifacts.map((a) => [a.path, a.sha1]),
      }),
    ),
  ).slice(0, 32);
  return {
    versions: [...versions].map(([module, version]) => `${module}:${version}`),
    artifacts,
    fingerprint,
  };
}
async function archiveBytes(
  root: string,
  item: NativeArtifact,
  fetcher: typeof fetch,
): Promise<Buffer> {
  const path = join(root, 'libraries', item.path);
  const current = await readBoundedRegularFile(path, maxArchive).catch(() => null);
  if (current && digest(current, 'sha1') === item.sha1) {
    return current;
  }
  const response = await fetcher(item.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) {
    throw new Error(`Native archive download failed: HTTP ${response.status}`);
  }
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      size += part.value.length;
      if (size > maxArchive) {
        throw new Error('Native archive exceeds limit');
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes, 'sha1') !== item.sha1) {
    throw new Error(`Native archive integrity check failed: ${item.name}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomically(path, bytes);
  return bytes;
}

/** Older custom profiles omit download metadata. Resolve checksums from the official repository, never from the DLL being repaired. */
async function verifiedArtifact(
  root: string,
  item: NativeArtifact,
  fetcher: typeof fetch,
): Promise<NativeArtifact> {
  if (item.sha1) {
    return item;
  }
  const repository = item.name.startsWith('org.lwjgl.lwjgl:')
    ? 'https://libraries.minecraft.net/'
    : 'https://repo.maven.apache.org/maven2/';
  const checksumPath = join(
    root,
    'cache',
    'lwjgl-checksums',
    digest(Buffer.from(repository + item.path)) + '.sha1',
  );
  let sha1 = (await readBoundedRegularFile(checksumPath, 128).catch(() => null))
    ?.toString('ascii')
    .trim();
  if (!sha1 || !/^[a-f0-9]{40}$/i.test(sha1)) {
    const response = await fetcher(repository + item.path + '.sha1', {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`Cannot verify LWJGL natives: ${item.name} (HTTP ${response.status})`);
    }
    const reader = response.body.getReader();
    let bytes = Buffer.alloc(0);
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        if (bytes.length + part.value.length > 128) {
          throw new Error('Invalid native checksum response');
        }
        bytes = Buffer.concat([bytes, part.value]);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    sha1 = bytes.toString('ascii').trim();
    if (!/^[a-f0-9]{40}$/i.test(sha1)) {
      throw new Error(`Invalid repository checksum: ${item.name}`);
    }
    await mkdir(dirname(checksumPath), { recursive: true });
    await writeFileAtomically(checksumPath, Buffer.from(sha1.toLowerCase()));
  }
  return { ...item, url: repository + item.path, sha1: sha1.toLowerCase() };
}

export async function prepareLwjglNatives(
  root: string,
  metadata: unknown,
  target: NativeTarget = { platform: process.platform, arch: process.arch },
  fetcher: typeof fetch = fetch,
): Promise<{ directory: string; versions: readonly string[]; repaired: number } | null> {
  if (!isAbsolute(root)) {
    throw new Error('Native cache root must be absolute');
  }
  const plan = planLwjglNatives(metadata, target);
  if (!plan) {
    return null;
  }
  const artifacts: NativeArtifact[] = [];
  for (const item of plan.artifacts) {
    artifacts.push(await verifiedArtifact(root, item, fetcher));
  }
  const fingerprint = digest(
    Buffer.from(JSON.stringify({ plan: plan.fingerprint, hashes: artifacts.map((a) => a.sha1) })),
  ).slice(0, 32);
  const directory = join(root, 'natives', 'lwjgl-verified', fingerprint),
    contents = new Map<string, Buffer>();
  let extracted = 0;
  for (const item of artifacts) {
    const zip = new AdmZip(await archiveBytes(root, item, fetcher));
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !nativeFile.test(e.entryName)) {
        continue;
      }
      if (
        e.entryName.includes('\\') ||
        e.entryName.split('/').some((p) => p === '..' || p === '.' || p.includes(':'))
      ) {
        throw new Error('Unsafe native library entry');
      }
      extracted += e.header.size;
      if (extracted > 256 * 1024 * 1024 || contents.size > 512) {
        throw new Error('Extracted native libraries exceed limit');
      }
      const name = basename(e.entryName),
        bytes = e.getData();
      if (bytes.length !== e.header.size) {
        throw new Error('Damaged native library entry');
      }
      const prior = contents.get(name);
      if (prior && !prior.equals(bytes)) {
        throw new Error(`Conflicting native libraries: ${name}`);
      }
      contents.set(name, bytes);
    }
  }
  if (!contents.size) {
    throw new Error('No native libraries in selected archives');
  }
  await mkdir(directory, { recursive: true });
  let repaired = 0;
  for (const [name, bytes] of contents) {
    const path = join(directory, name),
      within = relative(directory, path);
    if (within.startsWith('..' + sep) || isAbsolute(within)) {
      throw new Error('Unsafe native destination');
    }
    const existing = await readBoundedRegularFile(path, maxArchive).catch(() => null);
    if (!existing || !existing.equals(bytes)) {
      await writeFileAtomically(path, bytes);
      repaired++;
    }
  }
  return { directory, versions: plan.versions, repaired };
}
