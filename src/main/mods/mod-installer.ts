import { acquireModInstallLock } from './mod-install-lock';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { ModInstallRequest, ModProjectType } from '../../shared/mods/mod-contract';
import type { ModrinthClient, ModrinthVersion, ModrinthVersionFile } from './modrinth-client';
import { VerifiedDownloader } from './verified-download';

const maxDependencies = 64;
const targetDirectory: Record<ModProjectType, string> = {
  mod: 'mods',
  modpack: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
};

export interface ModInstallOutcome {
  readonly installed: readonly string[];
}

export class ModInstaller {
  readonly #client: ModrinthClient;
  readonly #downloader: VerifiedDownloader;
  readonly #rootDirectory: string;

  constructor(client: ModrinthClient, rootDirectory: string, fetchImplementation = fetch) {
    if (!isAbsolute(rootDirectory)) {
      throw new TypeError('Mod installation root must be absolute');
    }
    this.#client = client;
    this.#rootDirectory = resolve(rootDirectory);
    this.#downloader = new VerifiedDownloader({
      archiveDirectory: join(this.#rootDirectory, '.replaced-mods'),
      fetchImplementation,
    });
  }

  async install(
    request: ModInstallRequest,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
    onFile?: (filename: string) => void,
  ): Promise<ModInstallOutcome> {
    const release = acquireModInstallLock(this.#rootDirectory);
    if (!release) {
      throw new Error('Espera a que termine la otra instalación de mods');
    }
    try {
      return await this.#install(request, signal, onProgress, onFile);
    } finally {
      release();
    }
  }

  async #install(
    request: ModInstallRequest,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
    onFile?: (filename: string) => void,
  ): Promise<ModInstallOutcome> {
    const versions = await this.#resolveVersions(request, signal);
    const installed: string[] = [];
    let completed = 0;
    const files = versions.map((version, index) =>
      index === versions.length - 1
        ? (version.files.find((file) => file.primary) ?? version.files[0])
        : (version.files.find((file) => file.filename.toLowerCase().endsWith('.jar')) ??
          version.files.find((file) => file.primary) ??
          version.files[0]),
    );
    const total = files.reduce((sum, file) => sum + (file?.size ?? 0), 0);
    for (const [index, version] of versions.entries()) {
      const root = index === versions.length - 1;
      const file = root
        ? (version.files.find((candidate) => candidate.primary) ?? version.files[0])
        : (version.files.find((candidate) => candidate.filename.toLowerCase().endsWith('.jar')) ??
          version.files.find((candidate) => candidate.primary) ??
          version.files[0]);
      if (!file) {
        throw new Error(`Modrinth version has no downloadable file: ${version.id}`);
      }
      onFile?.(file.filename);
      const directoryName =
        root && request.projectType === 'datapack' && request.destinationWorld
          ? join('saves', request.destinationWorld, 'datapacks')
          : root
            ? targetDirectory[request.projectType]
            : 'mods';
      await this.#download(file, join(this.#rootDirectory, directoryName), signal, (current) =>
        onProgress?.(completed + current, total),
      );
      completed += file.size;
      onProgress?.(completed, total);
      installed.push(file.filename);
    }
    return { installed: installed.sort((left, right) => left.localeCompare(right)) };
  }

  async #resolveVersions(
    request: ModInstallRequest,
    signal?: AbortSignal,
  ): Promise<readonly ModrinthVersion[]> {
    const roots = request.versionId
      ? [await this.#client.version(request.versionId, signal)]
      : await this.#client.projectVersions(
          request.projectId,
          request.gameVersion,
          request.loader,
          signal,
        );
    const root = roots[0];
    if (!root) {
      throw new Error('No compatible Modrinth version was found');
    }
    if (
      request.projectType === 'datapack' &&
      (root.projectId !== request.projectId ||
        !root.loaders.includes('datapack') ||
        !root.gameVersions.includes(request.gameVersion) ||
        !(root.files.find((file) => file.primary) ?? root.files[0])?.filename
          .toLowerCase()
          .endsWith('.zip'))
    ) {
      throw new Error('No hay versiones compatibles');
    }
    if (request.destinationServerId && root.projectId !== request.projectId) {
      throw new Error('La versión no pertenece al mod seleccionado');
    }
    const resolved: ModrinthVersion[] = [];
    const visited = new Set<string>();
    const visit = async (candidate: ModrinthVersion): Promise<void> => {
      if (visited.has(candidate.id)) {
        return;
      }
      if (request.destinationServerId) {
        if (
          !candidate.gameVersions.includes(request.gameVersion) ||
          !candidate.loaders.includes(request.loader)
        ) {
          throw new Error(
            `El mod ${candidate.name} no es compatible con la versión o loader del servidor.`,
          );
        }
        const project = await this.#client.project(candidate.projectId, signal);
        if (project.serverSide === 'unsupported') {
          throw new Error(
            `${project.title} solo funciona en el cliente y no se puede instalar en el servidor.`,
          );
        }
      }
      if (visited.size >= maxDependencies) {
        throw new Error('Modrinth dependency limit exceeded');
      }
      visited.add(candidate.id);
      for (const dependency of candidate.dependencies) {
        if (dependency.dependencyType !== 'required') {
          continue;
        }
        let dependencyVersion: ModrinthVersion | undefined;
        if (dependency.versionId) {
          dependencyVersion = await this.#client.version(dependency.versionId, signal);
        } else if (dependency.projectId) {
          dependencyVersion = (
            await this.#client.projectVersions(
              dependency.projectId,
              request.gameVersion,
              request.loader,
              signal,
            )
          )[0];
        }
        if (!dependencyVersion) {
          throw new Error(
            `Required Modrinth dependency is unavailable: ${dependency.projectId ?? ''}`,
          );
        }
        await visit(dependencyVersion);
      }
      resolved.push(candidate);
    };
    await visit(root);
    return resolved;
  }

  async #download(
    file: ModrinthVersionFile,
    destinationDirectory: string,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    await mkdir(destinationDirectory, { recursive: true });
    await this.#downloader.download(
      { url: file.url, expectedSize: file.size, expectedSha512: file.sha512 },
      join(destinationDirectory, file.filename),
      signal,
      onProgress,
    );
  }
}
