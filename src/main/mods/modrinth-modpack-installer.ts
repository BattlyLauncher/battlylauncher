import { readBoundedResponseBytes } from '../network/read-bounded-response';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type { InstanceSummary } from '../../shared/minecraft/instance';
import type { ModInstallRequest } from '../../shared/mods/mod-contract';
import type { ModpackInstallProgressSink } from '../../shared/mods/modpack-install-contract';
import type { ModrinthClient } from './modrinth-client';
import type { MrpackInstaller } from './mrpack-installer';
import { VerifiedDownloader } from './verified-download';

export class ModrinthModpackInstaller {
  readonly #client: ModrinthClient;
  readonly #mrpack: MrpackInstaller;
  readonly #temporaryRoot: string;

  constructor(
    client: ModrinthClient,
    mrpack: MrpackInstaller,
    temporaryRoot: string,
    private readonly fetchCatalog = fetch,
  ) {
    if (!isAbsolute(temporaryRoot)) {
      throw new TypeError('Modpack temporary root must be absolute');
    }
    this.#client = client;
    this.#mrpack = mrpack;
    this.#temporaryRoot = resolve(temporaryRoot);
  }

  async install(
    request: ModInstallRequest,
    signal?: AbortSignal,
    onProgress?: ModpackInstallProgressSink,
  ): Promise<InstanceSummary> {
    const project = await this.#client.project(request.projectId, signal).catch(() => null);
    const versions = request.versionId
      ? [await this.#client.version(request.versionId, signal)]
      : await this.#client.projectVersions(
          request.projectId,
          request.gameVersion,
          request.loader,
          signal,
        );
    const version = versions[0];
    const file = version?.files.find((candidate) => candidate.primary) ?? version?.files[0];
    if (!file || !file.filename.toLowerCase().endsWith('.mrpack')) {
      throw new Error('No compatible Modrinth modpack file was found');
    }
    await mkdir(this.#temporaryRoot, { recursive: true });
    const temporary = join(
      this.#temporaryRoot,
      `${Date.now()}-${randomBytes(6).toString('hex')}.mrpack`,
    );
    try {
      await new VerifiedDownloader({ fetchImplementation: this.fetchCatalog }).download(
        { url: file.url, expectedSize: file.size, expectedSha512: file.sha512 },
        temporary,
        signal,
        (current, total) =>
          onProgress?.({
            phase: 'downloading-archive',
            current,
            total,
            item: file.filename,
            message: `Descargando ${file.filename}`,
          }),
      );
      let iconDataUrl: string | undefined;
      if (project?.iconUrl) {
        try {
          const iconResponse = await this.fetchCatalog(project.iconUrl, {
            redirect: 'follow',
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
              : AbortSignal.timeout(15_000),
          });
          if (iconResponse.ok) {
            const icon = await readBoundedResponseBytes(
              iconResponse,
              1_000_000,
              'Modpack icon is too large',
            );
            const signature = icon.subarray(0, 12).toString('hex');
            const type = signature.startsWith('89504e470d0a1a0a')
              ? 'png'
              : signature.startsWith('ffd8ff')
                ? 'jpeg'
                : signature.startsWith('52494646') && signature.endsWith('57454250')
                  ? 'webp'
                  : null;
            if (type && icon.length <= 1_000_000) {
              iconDataUrl = `data:image/${type};base64,${icon.toString('base64')}`;
            }
          }
        } catch {
          // A missing remote project icon must not abort a valid ModPack installation.
        }
      }
      return await this.#mrpack.install(temporary, signal, onProgress, {
        ...(project?.title ? { name: project.title } : {}),
        ...(project?.description ? { description: project.description } : {}),
        ...(iconDataUrl ? { iconDataUrl } : {}),
      });
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
