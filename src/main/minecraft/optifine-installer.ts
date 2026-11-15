import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';
import { optifineDownloadsUrl, parseOptiFineCatalog } from './optifine-catalog';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';

const officialHosts = new Set([
  'optifine.net',
  'www.optifine.net',
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'launcher.mojang.com',
  'libraries.minecraft.net',
]);
function officialUrl(value: string): string {
  const url = new URL(value, 'https://optifine.net/');
  if (
    url.protocol !== 'https:' ||
    !officialHosts.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('Dirección oficial de descarga no válida');
  }
  return url.href;
}
async function download(
  url: string,
  emit: MinecraftLaunchEventSink,
  item: string,
  limit = 128 * 1024 * 1024,
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetch(officialUrl(url), {
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`${item}: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > limit) {
    throw new Error(`${item}: archivo demasiado grande`);
  }
  const chunks: Buffer[] = [];
  let size = 0,
    last = 0;
  if (total) {
    emit({ type: 'progress', current: 0, total, item });
  }
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`${item}: archivo demasiado grande`);
    }
    chunks.push(Buffer.from(chunk));
    if (total && (Date.now() - last > 100 || size === total)) {
      last = Date.now();
      emit({ type: 'progress', current: Math.min(size, total), total, item });
    }
  }
  return Buffer.concat(chunks);
}
function validJar(bytes: Buffer): void {
  if (bytes.length < 100 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('La descarga no es un JAR válido');
  }
  new AdmZip(bytes).getEntries();
}
async function atomic(path: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, bytes);
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
function checkHash(bytes: Buffer, sha1: string): boolean {
  return /^[a-f0-9]{40}$/.test(sha1) && createHash('sha1').update(bytes).digest('hex') === sha1;
}
async function artifact(
  path: string,
  source: { url: string; sha1: string },
  emit: MinecraftLaunchEventSink,
  item: string,
  signal?: AbortSignal,
): Promise<Buffer> {
  const cached = await readFile(path).catch(() => undefined);
  if (cached && checkHash(cached, source.sha1)) {
    return cached;
  }
  const bytes = await download(source.url, emit, item, undefined, signal);
  if (!checkHash(bytes, source.sha1)) {
    throw new Error(`${item}: verificación SHA-1 incorrecta`);
  }
  await atomic(path, bytes);
  return bytes;
}
/** A profile alone does not mean its locally installed OptiFine library exists. */
export async function isOptiFineInstalled(options: MinecraftLaunchOptions): Promise<boolean> {
  const id = options.version.customId;
  if (!id || parseWorldsVersion(id)?.loader !== 'optifine') {
    return false;
  }
  try {
    const profile = JSON.parse(
      await readFile(join(options.root, 'versions', id, id + '.json'), 'utf8'),
    ) as {
      libraries?: { name?: string; downloads?: { artifact?: { sha1?: string } } }[];
    };
    const library = profile.libraries?.find((item) => item.name?.startsWith('optifine:OptiFine:'));
    const version = library?.name?.split(':')[2];
    if (!version || !/^[A-Za-z0-9_+.-]+$/.test(version) || version.includes('..')) {
      return false;
    }
    const path = join(
      options.root,
      'libraries',
      'optifine',
      'OptiFine',
      version,
      `OptiFine-${version}.jar`,
    );
    const info = await stat(path);
    if (!info.isFile() || info.size > 128 * 1024 * 1024) {
      return false;
    }
    const bytes = await readFile(path);
    if (library?.downloads?.artifact?.sha1 && !checkHash(bytes, library.downloads.artifact.sha1)) {
      return false;
    }
    return Boolean(new AdmZip(bytes).getEntry('optifine/OptiFineTweaker.class'));
  } catch {
    return false;
  }
}

async function optiFineInstaller(
  root: string,
  mc: string,
  requested: string,
  emit: MinecraftLaunchEventSink,
  signal?: AbortSignal,
  forge = false,
): Promise<{ filename: string; build: string; installer: Buffer }> {
  signal?.throwIfAborted();
  const get = (url: string, sink: MinecraftLaunchEventSink, item: string, limit?: number) =>
    download(url, sink, item, limit, signal);
  const index = (
    await get(optifineDownloadsUrl, emit, 'Catálogo OptiFine', 4 * 1024 * 1024)
  ).toString('utf8');
  const releases = parseOptiFineCatalog(index).filter(
    (entry) => !forge || typeof entry.forgeVersion === 'string',
  );
  if (forge) {
    releases.sort((a, b) => Number(b.isStable) - Number(a.isStable));
  }
  const files = releases.map((entry) => entry.filename);
  const prefix = `OptiFine_${mc}_HD_`;
  const filename = files.find((file) => {
    const name = file.replace(/^preview_/, '');
    return (
      name.startsWith(prefix) &&
      (!requested || name.toLowerCase() === (prefix + requested + '.jar').toLowerCase())
    );
  });
  if (!filename) {
    throw new Error(
      `OptiFine ${mc} ${requested}: la edición del anfitrión no está disponible en el catálogo oficial`,
    );
  }
  const build = filename.replace(/^preview_/, '').slice(prefix.length, -4);
  const installerPath = join(root, 'optifine', filename);
  let installer: Buffer | undefined = await readFile(installerPath).catch(() => undefined);
  if (installer) {
    try {
      validJar(installer);
    } catch {
      installer = undefined;
    }
  }
  if (!installer) {
    const mirror = (
      await get(
        `https://optifine.net/adloadx?f=${encodeURIComponent(filename)}`,
        emit,
        'Enlace OptiFine',
        4 * 1024 * 1024,
      )
    ).toString('utf8');
    const href = [...mirror.matchAll(/href=['"]([^'"]+)['"]/g)]
      .map((m) => m[1].replaceAll('&amp;', '&'))
      .find((link) => {
        try {
          const u = new URL(officialUrl(link));
          return u.pathname === '/downloadx' && u.searchParams.get('f') === filename;
        } catch {
          return false;
        }
      });
    if (!href) {
      throw new Error('OptiFine no ha devuelto el enlace oficial de descarga');
    }
    installer = await get(officialUrl(href), emit, filename);
    validJar(installer);
    await atomic(installerPath, installer);
  }
  return { filename, build, installer };
}

/** The same Patcher + LaunchWrapper installation contract used by Battly Mobile. */
export async function ensureOptiFine(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  signal?: AbortSignal,
): Promise<MinecraftLaunchOptions> {
  signal?.throwIfAborted();
  const get = (url: string, sink: MinecraftLaunchEventSink, item: string, limit?: number) =>
    download(url, sink, item, limit, signal);
  const target = parseWorldsVersion(options.version.customId || '');
  if (target?.loader !== 'optifine') {
    return options;
  }
  if (await isOptiFineInstalled(options)) {
    return options;
  }
  if (!options.javaPath) {
    throw new Error('Java no está preparado para instalar OptiFine');
  }
  const mc = options.version.id;
  emit({ type: 'phase', phase: 'downloading' });
  emit({ type: 'log', stream: 'game', message: `[OptiFine] Preparando ${mc} automáticamente` });
  const requested = target.loaderVersion === 'latest' ? '' : target.loaderVersion;
  const { filename, build, installer } = await optiFineInstaller(
    options.root,
    mc,
    requested,
    emit,
    signal,
  );
  const installerPath = join(options.root, 'optifine', filename);
  const id = `${mc}-OptiFine_HD_${build}`;
  const manifest = JSON.parse(
    (
      await get(
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
        emit,
        'Catálogo Minecraft',
        4 * 1024 * 1024,
      )
    ).toString('utf8'),
  ) as { versions: { id: string; url: string; sha1: string }[] };
  const version = manifest.versions.find((v) => v.id === mc);
  if (!version) {
    throw new Error(`Minecraft ${mc} no aparece en el catálogo oficial`);
  }
  const basePath = join(options.root, 'versions', mc, mc);
  const base = JSON.parse(
    (
      await artifact(basePath + '.json', version, emit, `Minecraft ${mc}: metadatos`, signal)
    ).toString('utf8'),
  ) as {
    downloads: { client: { url: string; sha1: string } };
    arguments?: unknown;
    minecraftArguments?: string;
  };
  await artifact(basePath + '.jar', base.downloads.client, emit, `Minecraft ${mc}`, signal);
  const zip = new AdmZip(installer);
  const mavenVersion = `${mc}_HD_${build}`;
  const runtimeRelative = `optifine/OptiFine/${mavenVersion}/OptiFine-${mavenVersion}.jar`;
  const runtimePath = join(options.root, 'libraries', runtimeRelative);
  await mkdir(dirname(runtimePath), { recursive: true });
  emit({ type: 'phase', phase: 'loader-install' });
  if (zip.getEntry('optifine/Patcher.class')) {
    const temp = runtimePath + '.' + randomUUID() + '.tmp';
    try {
      await new Promise<void>((resolve, reject) =>
        execFile(
          options.javaPath!,
          [
            '-Djava.awt.headless=true',
            '-cp',
            installerPath,
            'optifine.Patcher',
            basePath + '.jar',
            installerPath,
            temp,
          ],
          { windowsHide: true, signal, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
          (error) =>
            error
              ? reject(new Error('OptiFine no pudo generar el cliente parcheado', { cause: error }))
              : resolve(),
        ),
      );
      validJar(await readFile(temp));
      await rename(temp, runtimePath);
    } finally {
      await unlink(temp).catch(() => undefined);
    }
  } else {
    await atomic(runtimePath, installer);
  }
  if (!new AdmZip(await readFile(runtimePath)).getEntry('optifine/OptiFineTweaker.class')) {
    throw new Error(
      'El archivo de OptiFine no contiene OptiFineTweaker; no se puede iniciar esta instalación',
    );
  }
  let wrapperName = 'net.minecraft:launchwrapper:1.12';
  let wrapperRelative = 'net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar';
  let wrapper = zip.getEntry('launchwrapper-2.0.jar');
  if (wrapper) {
    wrapperName = 'optifine:launchwrapper:2.0';
    wrapperRelative = 'optifine/launchwrapper/2.0/launchwrapper-2.0.jar';
  } else {
    const entry = zip.getEntry('launchwrapper-of.txt');
    if (entry && entry.header.size < 128) {
      const v = entry.getData().toString('utf8').trim();
      if (!/^[\w.-]+$/.test(v)) {
        throw new Error('Versión de LaunchWrapper no válida');
      }
      wrapper = zip.getEntry(`launchwrapper-of-${v}.jar`);
      if (!wrapper) {
        throw new Error('El instalador no contiene LaunchWrapper');
      }
      wrapperName = `optifine:launchwrapper-of:${v}`;
      wrapperRelative = `optifine/launchwrapper-of/${v}/launchwrapper-of-${v}.jar`;
    }
  }
  if (wrapper && wrapper.header.size > 16 * 1024 * 1024) {
    throw new Error('LaunchWrapper demasiado grande');
  }
  const wrapperBytes = wrapper
    ? wrapper.getData()
    : await get('https://libraries.minecraft.net/' + wrapperRelative, emit, 'LaunchWrapper');
  validJar(wrapperBytes);
  await atomic(join(options.root, 'libraries', wrapperRelative), wrapperBytes);
  const library = (name: string, path: string, bytes: Buffer) => ({
    name,
    downloads: {
      artifact: {
        path,
        sha1: createHash('sha1').update(bytes).digest('hex'),
        size: bytes.length,
      },
    },
  });
  signal?.throwIfAborted();
  const json = {
    id,
    inheritsFrom: mc,
    mainClass: 'net.minecraft.launchwrapper.Launch',
    type: 'release',
    ...(base.arguments
      ? { arguments: { game: ['--tweakClass', 'optifine.OptiFineTweaker'] } }
      : {
          minecraftArguments: `${base.minecraftArguments || ''} --tweakClass optifine.OptiFineTweaker`,
        }),
    libraries: [
      library(`optifine:OptiFine:${mavenVersion}`, runtimeRelative, await readFile(runtimePath)),
      library(wrapperName, wrapperRelative, wrapperBytes),
    ],
  };
  await atomic(join(options.root, 'versions', id, id + '.json'), JSON.stringify(json, null, 2));
  emit({ type: 'log', stream: 'game', message: `[OptiFine] ${id} instalado` });
  return { ...options, version: { ...options.version, customId: id } };
}

/** Forge discovers the official OptiFine JAR in mods; it does not use a standalone OptiFine profile. */
export async function ensureForgeOptiFine(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  signal?: AbortSignal,
): Promise<void> {
  if (!options.installOptiForge) {
    return;
  }
  signal?.throwIfAborted();
  const mc = options.version.id;
  const directory = join(options.gameDirectory, 'mods');
  const prefix = `OptiFine_${mc}_HD_`;
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    },
  );
  const validMod = (bytes: Buffer): boolean => {
    try {
      validJar(bytes);
      return Boolean(new AdmZip(bytes).getEntry('optifine/OptiFineTweaker.class'));
    } catch {
      return false;
    }
  };
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.replace(/^preview_/, '').startsWith(prefix) ||
      !entry.name.endsWith('.jar')
    ) {
      continue;
    }
    const file = join(directory, entry.name);
    const info = await stat(file);
    if (info.size <= 128 * 1024 * 1024 && validMod(await readFile(file))) {
      return;
    }
  }
  emit({ type: 'phase', phase: 'downloading' });
  const { filename, installer } = await optiFineInstaller(options.root, mc, '', emit, signal, true);
  if (!validMod(installer)) {
    throw new Error('La descarga no es un JAR válido');
  }
  signal?.throwIfAborted();
  emit({ type: 'phase', phase: 'loader-install' });
  await atomic(join(directory, filename), installer);
  emit({ type: 'file-complete', category: 'mods', item: filename });
}
