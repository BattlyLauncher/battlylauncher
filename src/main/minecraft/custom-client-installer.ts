import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';

import type { BattlyCustomClient } from '../../shared/minecraft/custom-client-contract';

const maximumArchiveBytes = 768 * 1024 * 1024;
const maximumExtractedBytes = 2 * 1024 * 1024 * 1024;
const maximumEntries = 100_000;

function within(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference !== '' &&
    difference !== '..' &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function entryName(value: string): string | null {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.endsWith('/')) {
    return null;
  }
  const parts = normalized.split('/');
  if (
    parts.some(
      (part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes(':'),
    )
  ) {
    throw new TypeError('El cliente contiene una ruta insegura');
  }
  return parts.join('/');
}

async function discardClientStaging(path: string): Promise<void> {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 30,
    retryDelay: 250,
  }).catch(() => undefined);
}

export interface CustomClientInstallerOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class CustomClientInstaller {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #signal?: AbortSignal;

  constructor(options: CustomClientInstallerOptions = {}) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#signal = options.signal;
  }

  async install(client: BattlyCustomClient, instanceDirectory: string): Promise<void> {
    if (!isAbsolute(instanceDirectory)) {
      throw new TypeError('La instancia debe tener una ruta absoluta');
    }
    const root = resolve(instanceDirectory);
    const staging = resolve(root, `.client-${randomUUID()}`);
    if (!within(root, staging)) {
      throw new TypeError('Ruta temporal inválida');
    }
    await mkdir(staging, { recursive: false });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(client.downloadUrl, {
        headers: { 'User-Agent': 'BattlyLauncher' },
        redirect: 'follow',
        signal: this.#signal
          ? AbortSignal.any([controller.signal, this.#signal])
          : controller.signal,
      });
      if (!response.ok || !response.body) {
        if (response.status === 404) {
          throw new Error(
            `La descarga de ${client.name} ya no está disponible en el servidor (HTTP 404).`,
          );
        }
        throw new Error(`La descarga devolvió HTTP ${response.status}`);
      }
      const finalUrl = new URL(response.url || client.downloadUrl);
      if (finalUrl.protocol !== 'https:' || finalUrl.username || finalUrl.password) {
        throw new TypeError('La descarga redirigió a una URL insegura');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maximumArchiveBytes) {
        throw new TypeError('El cliente supera el límite de descarga');
      }
      const chunks: Buffer[] = [];
      let archiveBytes = 0;
      const reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        archiveBytes += part.value.byteLength;
        if (archiveBytes > maximumArchiveBytes) {
          await reader.cancel();
          throw new TypeError('El cliente supera el límite de descarga');
        }
        chunks.push(Buffer.from(part.value));
      }
      const archive = Buffer.concat(chunks, archiveBytes);
      if (client.size !== undefined && archiveBytes !== client.size) {
        throw new Error('Client download size mismatch');
      }
      if (
        client.sha256 !== undefined &&
        createHash('sha256').update(archive).digest('hex') !== client.sha256
      ) {
        throw new Error('Client download integrity check failed');
      }
      const entries = new AdmZip(archive).getEntries();
      if (!entries.length || entries.length > maximumEntries) {
        throw new TypeError('ZIP de cliente inválido');
      }
      const names = entries.map((entry) => entryName(entry.entryName));
      const versionPrefix = `versions/${client.folderName}/`;
      const manifestName = `${client.folderName}.json`;
      const nestedPrefix = `${versionPrefix}${client.folderName}/`;
      const canonical = names.includes(`${versionPrefix}${manifestName}`);
      const bare = !canonical && names.includes(manifestName);
      const nested = !canonical && !bare && names.includes(`${nestedPrefix}${manifestName}`);
      const destinations = new Set<string>();
      let expanded = 0;
      for (const [index, entry] of entries.entries()) {
        this.#signal?.throwIfAborted();
        let name = names[index];
        if (!name) {
          continue;
        }
        // Older client packages contain either the version pair at the ZIP root
        // or a duplicated version directory. Keep shared libraries at the root.
        if (bare && (name === manifestName || name === `${client.folderName}.jar`)) {
          name = `${versionPrefix}${name}`;
        } else if (nested && name.startsWith(nestedPrefix)) {
          name = `${versionPrefix}${name.slice(nestedPrefix.length)}`;
        }
        if (destinations.has(name)) {
          throw new TypeError('El cliente contiene archivos de versión duplicados');
        }
        destinations.add(name);
        expanded += entry.header.size;
        if (expanded > maximumExtractedBytes) {
          throw new TypeError('El cliente extraído supera el límite');
        }
        const target = resolve(staging, name);
        if (!within(staging, target)) {
          throw new TypeError('El cliente escapó de su instancia');
        }
        const data = entry.getData();
        if (data.byteLength !== entry.header.size) {
          throw new TypeError('Entrada ZIP dañada');
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data, { mode: 0o600 });
      }
      const versionJson = resolve(
        staging,
        'versions',
        client.folderName,
        `${client.folderName}.json`,
      );
      if (!within(staging, versionJson)) {
        throw new TypeError('Versión de cliente inválida');
      }
      const info = await lstat(versionJson).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) {
        throw new TypeError('El cliente no incluye su JSON de versión');
      }
      for (const item of await readdir(staging)) {
        this.#signal?.throwIfAborted();
        await cp(resolve(staging, item), resolve(root, item), {
          recursive: true,
          force: true,
          errorOnExist: false,
          // Client archives may contain defaults. Updates must not replace the
          // player's Minecraft, OptiFine or shader preferences with those defaults.
          filter: async (source, destination) => {
            if (!/(?:^|[\\/])options(?:of|shaders)?\.txt$/i.test(source)) {
              return true;
            }
            try {
              await lstat(destination);
              return false;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return true;
              }
              throw error;
            }
          },
        });
      }
    } catch (error) {
      await discardClientStaging(staging);
      throw error;
    } finally {
      clearTimeout(timeout);
      await discardClientStaging(staging);
    }
  }
}
