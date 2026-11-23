import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { horizonArchive, horizonMinecraftVersion } from '../../shared/minecraft/horizon';
import type { MinecraftLaunchWindow } from '../../shared/minecraft/launch-contract';
import type { MinecraftLaunchEventSink } from './launcher-adapter';
import { systemArchitecture } from '../settings/system-architecture';

const exec = promisify(execFile);
const repo = 'https://github.com/horizon-rust/horizon/releases/download';
const metadata = 'https://api.github.com/repos/horizon-rust/horizon/releases/tags/nightly';
// Upstream crates/horizon-release-sign/release-keys.txt. DER prefix for an Ed25519 public key.
const releaseKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from('MU4oiIQcCxkZvbwSjjXs7SySCuM6ywRQ3nGaJYZG0gw=', 'base64'),
  ]),
  format: 'der',
  type: 'spki',
});
const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const playerName = /^[A-Za-z0-9_]{1,16}$/;

interface RemoteFile {
  readonly url: string;
  readonly sha1: string;
  readonly size?: number;
}

interface VanillaManifest {
  readonly id: string;
  readonly downloads: { readonly client: RemoteFile; readonly server: RemoteFile };
  readonly assetIndex: RemoteFile & { readonly id: string };
  readonly libraries: readonly { downloads?: { artifact?: RemoteFile & { path: string } } }[];
}

export interface HorizonSession {
  readonly name: string;
  readonly uuid: string;
  readonly access_token: string;
  readonly user_type: 'msa';
}

interface HorizonOfflinePlayer {
  readonly name: string;
}

export async function horizonSession(
  account: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<HorizonSession | HorizonOfflinePlayer> {
  const { name: localName, uuid, access_token } = account;
  if (account.type === 'offline' || account.type === 'battly') {
    if (typeof localName !== 'string' || !playerName.test(localName)) {
      throw new Error(
        'Para jugar a Horizon, usa un nombre de Minecraft de 1 a 16 caracteres: letras, números o guion bajo.',
      );
    }
    return { name: localName };
  }
  if (
    account.type !== 'microsoft' ||
    typeof uuid !== 'string' ||
    typeof access_token !== 'string' ||
    !access_token
  ) {
    throw new Error('Vuelve a iniciar sesión en Battly para jugar a Horizon.');
  }
  const options = {
    headers: { authorization: `Bearer ${access_token}` },
    redirect: 'error' as const,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  };
  const [license, profile] = await Promise.all([
    fetch('https://api.minecraftservices.com/entitlements/mcstore', options),
    fetch('https://api.minecraftservices.com/minecraft/profile', options),
  ]);
  if ([license.status, profile.status].includes(401)) {
    throw new Error(
      'La sesión de Microsoft ha caducado. Vuelve a iniciar sesión para jugar a Horizon.',
    );
  }
  if (!license.ok || (!profile.ok && profile.status !== 404)) {
    throw new Error('No se pudo comprobar la licencia de Minecraft para Horizon.');
  }
  const { items } = (await license.json()) as { items?: { name: string }[] };
  if (
    !items?.some(({ name }) => name === 'game_minecraft' || name === 'product_minecraft') ||
    !profile.ok
  ) {
    throw new Error('Horizon requiere una cuenta de Microsoft con Minecraft: Java Edition.');
  }
  const { name, id } = (await profile.json()) as { name?: string; id?: string };
  if (
    !id ||
    !/^[a-f\d]{32}$/i.test(id) ||
    id.toLowerCase() !== uuid.replaceAll('-', '').toLowerCase() ||
    !name ||
    !playerName.test(name)
  ) {
    throw new Error('No se pudo comprobar el perfil de Minecraft para Horizon.');
  }
  return { name, uuid: id, access_token, user_type: 'msa' } satisfies HorizonSession;
}

function safeName(name: string): boolean {
  return name.split('/').every((part) => /^[\w.+@$ -]+$/.test(part) && !/[. ]$/.test(part));
}

async function digest(path: string, algorithm: 'sha1' | 'sha256'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function response(url: string, signal: AbortSignal, timeout = 120_000): Promise<Response> {
  const result = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
  });
  if (!result.ok || !result.body) {
    throw new Error(`Horizon: error de descarga HTTP ${result.status}.`);
  }
  return result;
}

export function verifyHorizonRelease(
  tag: string,
  sums: Buffer,
  signatures: string,
  archive: string,
): string {
  const signed = Buffer.concat([Buffer.from(`horizon release ${tag}\n`), sums]);
  if (
    !signatures
      .split(/\r?\n/)
      .some((line) => verify(null, signed, releaseKey, Buffer.from(line.trim(), 'base64')))
  ) {
    throw new Error('La firma de la compilación de Horizon no es válida.');
  }
  const entries = sums
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => /^([a-f\d]{64})\s+\*?(\S+)$/.exec(line));
  const matches = entries.filter((entry) => entry?.[2] === archive);
  if (matches.length !== 1 || !matches[0]) {
    throw new Error('No se encontró el SHA-256 de Horizon.');
  }
  return matches[0][1];
}

async function download(
  url: string,
  target: string,
  expected: string,
  signal: AbortSignal,
  max: number,
  progress?: (size: number) => void,
): Promise<void> {
  const algorithm = expected.length === 40 ? 'sha1' : 'sha256';
  const reply = await response(url, signal);
  const hash = createHash(algorithm);
  let size = 0;
  await pipeline(
    Readable.fromWeb(reply.body! as NodeReadableStream),
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > max) {
          return done(new Error('La descarga de Horizon supera el tamaño esperado.'));
        }
        hash.update(chunk);
        progress?.(size);
        done(null, chunk);
      },
    }),
    createWriteStream(target, { flags: 'wx' }),
    { signal },
  );
  if (hash.digest('hex') !== expected) {
    throw new Error('La descarga de Horizon no coincide con su suma de verificación.');
  }
}

async function unpack(archive: string, target: string): Promise<void> {
  let files = 0;
  let size = 0;
  const validate = (name: string, bytes: number): void => {
    if (!safeName(name.replace(/\/$/, '')) || ++files > 25_000 || (size += bytes) > 1024 ** 3) {
      throw new Error('El paquete de Horizon no tiene un formato válido.');
    }
  };
  if (archive.endsWith('.zip')) {
    for (const entry of new AdmZip(archive).getEntries()) {
      validate(entry.entryName, entry.header.size);
      const dest = join(target, entry.entryName);
      if (entry.isDirectory) {
        await mkdir(dest, { recursive: true });
      } else {
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, entry.getData(), {
          flag: 'wx',
          mode: (entry.attr >>> 16) & 0o111 ? 0o755 : 0o644,
        });
      }
    }
    return;
  }
  let failure: Error | undefined;
  await tar.t({
    file: archive,
    strict: true,
    onReadEntry(entry) {
      try {
        validate(entry.path, entry.size);
        if (entry.type !== 'File' && entry.type !== 'Directory') {
          throw new Error('Entrada de Horizon no admitida.');
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    },
  });
  if (failure) {
    throw failure;
  }
  await tar.x({ file: archive, cwd: target, strict: true });
}

function progress(
  emit: MinecraftLaunchEventSink,
  item: string,
  current: number,
  total: number,
  unit: NonNullable<Extract<Parameters<MinecraftLaunchEventSink>[0], { type: 'progress' }>['unit']>,
): void {
  emit({ type: 'progress', item, current, total, unit });
}

const binary = (folder: string, name: string) =>
  join(folder, process.platform === 'win32' ? `${name}.exe` : name);
export const horizonGameDirectory = (root: string) => join(root, 'horizon', 'game');
const activeRoot = (root: string) =>
  join(root, 'horizon', 'installed', `${process.platform}-${systemArchitecture()}`);

export async function installedHorizon(root: string): Promise<string | null> {
  try {
    const tag = (await readFile(join(activeRoot(root), '26.3'), 'utf8')).trim();
    if (!/^nightly-\d{4}-\d{2}-\d{2}-[a-f\d]{7,12}$/.test(tag)) {
      return null;
    }
    const client = await lstat(binary(join(activeRoot(root), tag), 'horizon-client'));
    return client.isFile() ? join(activeRoot(root), tag) : null;
  } catch {
    return null;
  }
}

async function installBuild(root: string, emit: MinecraftLaunchEventSink, signal: AbortSignal) {
  const archive = horizonArchive(process.platform, systemArchitecture());
  if (!archive) {
    throw new Error('Horizon no está disponible para esta plataforma.');
  }
  const release = (await (await response(metadata, signal, 15_000)).json()) as {
    name?: string;
    assets?: { name: string; size: number }[];
  };
  const build = /^Nightly (\d{4}-\d{2}-\d{2}) · ([a-f\d]{7,12})$/.exec(release.name ?? '');
  const asset = release.assets?.find(({ name }) => name === archive);
  if (
    !build ||
    !asset ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > 512 * 1024 ** 2
  ) {
    throw new Error('No se encontró una compilación de Horizon para esta plataforma.');
  }
  const tag = `nightly-${build[1]}-${build[2]}`;
  const destination = join(activeRoot(root), tag);
  if ((await lstat(binary(destination, 'horizon-client')).catch(() => null))?.isFile()) {
    await inspectBuild(destination, signal);
    return { folder: destination, tag };
  }
  const stage = await mkdtemp(join(activeRoot(root), '.download-'));
  try {
    const [sumFile, signatureFile] = await Promise.all([
      response(`${repo}/nightly/SHA256SUMS`, signal),
      response(`${repo}/nightly/SHA256SUMS.v2.sig`, signal),
    ]);
    const hash = verifyHorizonRelease(
      tag,
      Buffer.from(await sumFile.arrayBuffer()),
      await signatureFile.text(),
      archive,
    );
    const file = join(stage, archive);
    let reported = 0;
    emit({ type: 'phase', phase: 'downloading' });
    await download(`${repo}/nightly/${archive}`, file, hash, signal, asset.size, (size) => {
      if (size === asset.size || size - reported >= 512 * 1024) {
        reported = size;
        progress(emit, 'Horizon', size, asset.size, 'bytes');
      }
    });
    emit({ type: 'phase', phase: 'extract' });
    await unpack(file, stage);
    const folder = join(stage, archive.replace(/\.zip$|\.tar\.gz$/, ''));
    await inspectBuild(folder, signal);
    signal.throwIfAborted();
    await rename(folder, destination).catch(async (error: unknown) => {
      if (!(await lstat(binary(destination, 'horizon-client')).catch(() => null))?.isFile()) {
        throw error;
      }
    });
    return { folder: destination, tag };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function inspectBuild(folder: string, signal: AbortSignal): Promise<void> {
  const inspect = async (name: string, required: string[]) => {
    const { stdout } = await exec(binary(folder, name), ['--launch-api'], {
      cwd: folder,
      signal,
      timeout: 15_000,
      windowsHide: true,
    });
    const api = JSON.parse(stdout) as {
      launch_api: string;
      minecraft?: string;
      java_major?: number;
      options: { name: string }[];
    };
    if (
      !/^0\.1\.\d+$/.test(api.launch_api) ||
      !required.every((option) => api.options.some(({ name }) => name === option))
    ) {
      throw new Error('Esta compilación de Horizon usa una interfaz de inicio incompatible.');
    }
    return api;
  };
  const [prepare] = await Promise.all([
    inspect('horizon-prepare', [
      '--check',
      '--output',
      '--prepare',
      '--complete',
      '--progress',
      '--server-jar',
      '--version-json',
      '--client-jar',
      '--libraries-dir',
      '--assets-dir',
      '--java-home',
    ]),
    inspect('horizon-client', [
      '--resources',
      '--game-dir',
      '--home',
      '--session-stdin',
      '--width',
      '--height',
      '--fullscreen',
      '--quickPlayMultiplayer',
    ]),
  ]);
  if (prepare.minecraft !== horizonMinecraftVersion || prepare.java_major !== 25) {
    throw new Error('Esta compilación de Horizon requiere otra versión de Minecraft o Java.');
  }
}

async function verifiedFile(
  file: RemoteFile,
  target: string,
  signal: AbortSignal,
  hosts: string[],
  cached?: string,
): Promise<void> {
  const url = new URL(file.url);
  if (
    url.protocol !== 'https:' ||
    !hosts.includes(url.hostname) ||
    !/^[a-f\d]{40}$/.test(file.sha1)
  ) {
    throw new Error('Horizon recibió una referencia de Minecraft no válida.');
  }
  if (
    (await lstat(target).catch(() => null))?.isFile() &&
    (await digest(target, 'sha1')) === file.sha1
  ) {
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const stage = await mkdtemp(join(dirname(target), '.horizon-'));
  try {
    const pending = join(stage, 'download');
    if (
      cached &&
      (await lstat(cached).catch(() => null))?.isFile() &&
      (await digest(cached, 'sha1')) === file.sha1
    ) {
      await link(cached, pending).catch(() => copyFile(cached, pending));
    } else {
      await download(url.href, pending, file.sha1, signal, file.size ?? 32 * 1024 ** 2);
    }
    await rename(pending, target);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function prepareMinecraft(
  root: string,
  working: string,
  emit: MinecraftLaunchEventSink,
  signal: AbortSignal,
) {
  const version = horizonMinecraftVersion;
  const { versions } = (await (await response(manifestUrl, signal)).json()) as {
    versions: (RemoteFile & { id: string })[];
  };
  const selected = versions.find(({ id }) => id === version);
  if (!selected) {
    throw new Error('Minecraft 26.3 no está disponible en el catálogo oficial.');
  }
  const meta = ['piston-meta.mojang.com', 'launchermeta.mojang.com'];
  const data = ['piston-data.mojang.com', 'launcher.mojang.com'];
  const versionPath = join(working, `${version}.json`);
  await verifiedFile(selected, versionPath, signal, meta);
  const manifest = JSON.parse(await readFile(versionPath, 'utf8')) as VanillaManifest;
  if (manifest.id !== version || !/^\d+$/.test(manifest.assetIndex.id)) {
    throw new Error('Manifiesto de Minecraft no válido.');
  }
  const server = join(working, `${version}-server.jar`);
  const client = join(working, `${version}-client.jar`);
  const assets = join(working, 'assets');
  const index = join(assets, 'indexes', `${manifest.assetIndex.id}.json`);
  const libraries = join(working, 'libraries');
  await Promise.all([
    verifiedFile(
      manifest.downloads.client,
      client,
      signal,
      data,
      join(root, 'versions', version, `${version}.jar`),
    ),
    verifiedFile(manifest.downloads.server, server, signal, data),
    verifiedFile(manifest.assetIndex, index, signal, [...meta, ...data]),
  ]);
  const { objects } = JSON.parse(await readFile(index, 'utf8')) as {
    objects: Record<string, { hash: string; size: number }>;
  };
  const work = manifest.libraries.flatMap(({ downloads }) => {
    const file = downloads?.artifact;
    if (!file || !safeName(file.path)) {
      return [];
    }
    return [
      {
        file,
        dest: join(libraries, file.path),
        hosts: ['libraries.minecraft.net'],
        cached: join(root, 'libraries', file.path),
      },
    ];
  });
  const gameAssets = new Map(
    Object.entries(objects)
      .filter(([name]) =>
        /^(?:pack\.mcmeta$|minecraft\/(?:sounds\.json$|sounds\/|font\/|lang\/|textures\/gui\/title\/background\/panorama|resourcepacks\/))/.test(
          name,
        ),
      )
      .map(([, entry]) => [entry.hash, entry]),
  );
  for (const { hash, size } of gameAssets.values()) {
    const key = `${hash.slice(0, 2)}/${hash}`;
    if (!/^[a-f\d]{40}$/.test(hash)) {
      throw new Error('Índice de recursos de Minecraft no válido.');
    }
    work.push({
      file: { url: `https://resources.download.minecraft.net/${key}`, sha1: hash, size, path: key },
      dest: join(assets, 'objects', key),
      hosts: ['resources.download.minecraft.net'],
      cached: join(root, 'assets', 'objects', key),
    });
  }
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(12, work.length) }, async () => {
    while (next < work.length) {
      signal.throwIfAborted();
      const { file, dest, hosts, cached } = work[next++];
      await verifiedFile(file, dest, signal, hosts, cached);
      if (++done % 25 === 0 || done === work.length) {
        progress(emit, 'Minecraft 26.3', done, work.length, 'files');
      }
    }
  });
  const results = await Promise.allSettled(workers);
  const error = results.find((result) => result.status === 'rejected');
  if (error) {
    throw error.reason;
  }
  return { server, client, versionPath, libraries, assets };
}

function captureProcess(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

export async function prepareHorizon(
  root: string,
  javaHome: () => Promise<string>,
  emit: MinecraftLaunchEventSink,
  signal: AbortSignal,
): Promise<string> {
  const installed = await installedHorizon(root);
  await mkdir(activeRoot(root), { recursive: true });
  emit({ type: 'phase', phase: 'files-check' });
  const build = installed
    ? { folder: installed, tag: basename(installed) }
    : await installBuild(root, emit, signal);
  const { folder, tag } = build;
  const resources = join(folder, 'battly-resources');
  const prepare = binary(folder, 'horizon-prepare');
  const options = { cwd: folder, signal, windowsHide: true };
  if (!installed) {
    emit({ type: 'phase', phase: 'files-check' });
  }
  const current = await exec(prepare, ['--check', '--output', resources], {
    ...options,
    timeout: 30_000,
  }).then(
    () => true,
    () => false,
  );
  signal.throwIfAborted();
  if (!current) {
    emit({ type: 'phase', phase: 'preparing' });
    const { server, client, versionPath, libraries, assets } = await prepareMinecraft(
      root,
      join(root, 'horizon', 'minecraft'),
      emit,
      signal,
    );
    const java = await javaHome();
    emit({ type: 'phase', phase: 'horizon-prepare' });
    const child = spawn(
      prepare,
      [
        '--prepare',
        '--version-json',
        versionPath,
        '--client-jar',
        client,
        '--libraries-dir',
        libraries,
        '--assets-dir',
        assets,
        '--server-jar',
        server,
        '--java-home',
        java,
        '--output',
        resources,
        '--complete',
        '--progress',
        'json',
      ],
      { ...options, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exit = captureProcess(child);
    child.stderr.resume();
    let explanation = '';
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const item = JSON.parse(line) as { fraction?: number; message?: string; error?: string };
        if (typeof item.fraction === 'number') {
          progress(emit, 'Horizon', item.fraction * 100, 100, 'percent');
        }
        if (item.message) {
          emit({ type: 'log', stream: 'game', message: item.message });
        }
        if (item.error) {
          explanation = item.error.slice(0, 600);
        }
      } catch {
        /* The preparation protocol uses JSON lines. */
      }
    });
    if ((await exit).code !== 0) {
      throw new Error(explanation || 'Horizon no pudo preparar los recursos.');
    }
  }
  signal.throwIfAborted();
  const pointer = join(activeRoot(root), horizonMinecraftVersion);
  const stage = await mkdtemp(join(activeRoot(root), '.activate-'));
  try {
    const pending = join(stage, 'version');
    await writeFile(pending, tag);
    await rename(pending, pointer);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return folder;
}

export async function startHorizon(
  folder: string,
  directory: string,
  session: HorizonSession | HorizonOfflinePlayer,
  window: MinecraftLaunchWindow,
  server: string | undefined,
  emit: MinecraftLaunchEventSink,
  onExit: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void,
): Promise<void> {
  const online = 'access_token' in session;
  const child = spawn(
    binary(folder, 'horizon-client'),
    [
      '--resources',
      join(folder, 'battly-resources'),
      '--game-dir',
      directory,
      '--home',
      directory,
      '--width',
      String(window.width),
      '--height',
      String(window.height),
      ...(online ? ['--session-stdin'] : ['--name', session.name]),
      ...(window.fullscreen ? ['--fullscreen'] : []),
      ...(server ? ['--quickPlayMultiplayer', server] : []),
    ],
    { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const exit = captureProcess(child);
  void exit.then(
    (result) => onExit(result),
    () => {},
  );
  let ready = false;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      const message = online ? line.replaceAll(session.access_token, '[redacted]') : line;
      emit({ type: 'log', stream: 'game', message });
      if (!ready && /^Horizon: first frame after \d+/.test(line)) {
        ready = true;
        emit({ type: 'client-ready' });
      }
    });
  }
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (child.pid) {
    emit({ type: 'process', pid: child.pid });
  }
  emit({ type: 'state', state: 'running' });
  child.stdin.on('error', () => {}); // The process may fail before reading its session.
  child.stdin.end(online ? JSON.stringify(session) : undefined);
}
