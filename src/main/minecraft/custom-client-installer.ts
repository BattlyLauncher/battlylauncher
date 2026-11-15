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
      let expanded = 0;
      for (const entry of entries) {
        this.#signal?.throwIfAborted();
        const name = entryName(entry.entryName);
        if (!name) {
          continue;
        }
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
