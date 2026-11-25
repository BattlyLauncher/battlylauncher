import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { InstanceSummary } from '../../shared/minecraft/instance';
import {
  isServerModloader,
  normalizeServerLoaderBuild,
  normalizeServerRelativePath,
} from '../../shared/servers/server-contract';

const contentRoots = [
  'mods',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'patchouli_books',
  'global_packs',
  'paxi',
] as const;

export function acceptServerModpackPath(value: string): boolean {
  const parts = normalizeServerRelativePath(value).split('/');
  if (!contentRoots.some((root) => root === parts[0])) {
    return false;
  }
  if (
    parts.some(
      (part) =>
        /[<>:"|?*]|[. ]$/.test(part) ||
        [...part].some((c) => c.charCodeAt(0) < 32) ||
        /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error('El modpack contiene un nombre de archivo incompatible.');
  }
  return parts.length > 1;
}

export function serverModpackSoftware(pack: InstanceSummary, gameVersion: string) {
  if (pack.version !== gameVersion) {
    throw new Error(
      `El modpack requiere Minecraft ${pack.version}. Este servidor usa ${gameVersion}.`,
    );
  }
  if (!pack.loader) {
    return { kind: 'vanilla' as const, build: undefined };
  }
  if (!isServerModloader(pack.loader)) {
    throw new Error('Battly Servers no admite el modloader de este modpack.');
  }
  const build = normalizeServerLoaderBuild(pack.loaderVersion ?? undefined);
  if (!build) {
    throw new Error('El modpack no indica la versión de su modloader.');
  }
  return { kind: pack.loader, build };
}

async function info(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

export async function installServerModpackContents(
  staging: string,
  target: string,
  installSoftware: () => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const addedFiles: string[] = [];
  const addedFolders: string[] = [];
  const merge = async (path: string): Promise<void> => {
    signal?.throwIfAborted();
    const source = join(staging, path);
    const destination = join(target, path);
    const original = await info(source);
    if (!original) {
      return;
    }
    const existing = await info(destination);
    if (original.isDirectory() && !original.isSymbolicLink()) {
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
        throw new Error(
          `El modpack necesita la carpeta «${path}», pero ya existe un archivo con ese nombre.`,
        );
      }
      if (!existing) {
        await mkdir(destination);
        addedFolders.push(destination);
      }
      for (const name of await readdir(source)) {
        const child = path + '/' + name;
        if (acceptServerModpackPath(child)) {
          await merge(child);
        }
      }
      return;
    }
    if (
      !acceptServerModpackPath(path) ||
      !original.isFile() ||
      original.isSymbolicLink() ||
      (existing && (!existing.isFile() || existing.isSymbolicLink()))
    ) {
      throw new Error(`El modpack contiene un archivo incompatible con el servidor: ${path}`);
    }
    if (existing) {
      if (
        original.size === existing.size &&
        (await digest(source)) === (await digest(destination))
      ) {
        return;
      }
      throw new Error(
        `El servidor ya tiene otra versión de «${path}». Archívala antes de instalar este modpack.`,
      );
    }
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    addedFiles.push(destination);
  };
  try {
    for (const path of contentRoots) {
      await merge(path);
    }
    signal?.throwIfAborted();
    await installSoftware();
  } catch (error) {
    const failures: unknown[] = [];
    for (const path of addedFiles.reverse()) {
      await unlink(path).catch((failure) => failures.push(failure));
    }
    for (const path of addedFolders.reverse()) {
      await rmdir(path).catch((failure) => failures.push(failure));
    }
    if (failures.length) {
      throw new AggregateError(failures, 'No se pudieron retirar todos los archivos del modpack.', {
        cause: error,
      });
    }
    throw error;
  }
}
