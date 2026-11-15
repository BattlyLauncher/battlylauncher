import { createReadStream } from 'node:fs';
import { bypackDownloadUrl, type BypackRemote } from '../../shared/minecraft/bypack';

export interface BypackCandidate {
  readonly path: string;
  readonly absolutePath: string;
  readonly size: number;
  readonly sha1: string;
  readonly sha512: string;
}
export interface CurseForgeReference {
  readonly projectId: number;
  readonly fileId: number;
}
export interface BypackSourceOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly curseForgeKey?: string;
  readonly curseForgeFingerprintUrl?: string;
  readonly curseForgeApiBase?: string;
}

// CurseForge uses MurmurHash2 (seed 1), ignoring TAB, LF, CR and space bytes.
// Two streaming passes keep memory bounded even for unusually large mod JARs.
export async function curseForgeFingerprint(path: string): Promise<number> {
  const whitespace = (byte: number): boolean =>
    byte === 9 || byte === 10 || byte === 13 || byte === 32;
  let length = 0;
  for await (const chunk of createReadStream(path)) {
    for (const byte of chunk as Buffer) {
      if (!whitespace(byte)) {
        length++;
      }
    }
  }
  let hash = (1 ^ length) >>> 0;
  let word = 0;
  let count = 0;
  for await (const chunk of createReadStream(path)) {
    for (const byte of chunk as Buffer) {
      if (whitespace(byte)) {
        continue;
      }
      word |= byte << (count * 8);
      if (++count === 4) {
        word = Math.imul(word, 0x5bd1e995);
        word ^= word >>> 24;
        hash = Math.imul(hash, 0x5bd1e995) ^ Math.imul(word, 0x5bd1e995);
        word = 0;
        count = 0;
      }
    }
  }
  if (count) {
    hash = Math.imul(hash ^ word, 0x5bd1e995);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  return (hash ^ (hash >>> 15)) >>> 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function endpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('La API de mods debe usar HTTPS');
  }
  return url.toString();
}
function payload(value: unknown): Record<string, unknown> {
  let result = record(value);
  for (let depth = 0; depth < 3 && result.data && typeof result.data === 'object'; depth++) {
    result = record(result.data);
  }
  return result;
}
export class BypackSources {
  readonly #fetch: typeof fetch;
  constructor(private readonly options: BypackSourceOptions = {}) {
    this.#fetch = options.fetchImplementation ?? fetch;
  }
  async #json(url: string, body?: unknown, key?: string): Promise<unknown> {
    const response = await this.#fetch(endpoint(url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)',
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(key ? { 'x-api-key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      throw new Error(`API de mods: HTTP ${response.status}`);
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 8 * 1024 ** 2) {
        throw new Error('Respuesta de mods demasiado grande');
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  async identify(
    files: readonly BypackCandidate[],
    references: readonly CurseForgeReference[] = [],
    progress?: (message: string, current: number, total: number) => void,
  ): Promise<{
    readonly matches: ReadonlyMap<string, BypackRemote>;
    readonly warnings: readonly string[];
  }> {
    const matches = new Map<string, BypackRemote>();
    const warnings: string[] = [];
    // Exact byte hashes identify the installed version, never the latest version or a similar filename.
    let modrinthFailures = 0;
    for (let start = 0; start < files.length; start += 64) {
      const batch = files.slice(start, start + 64);
      progress?.(
        `Modrinth: comprobando ${start + 1}–${start + batch.length} de ${files.length} archivos (${matches.size} identificados)…`,
        start,
        files.length,
      );
      try {
        const versions = record(
          await this.#json('https://api.modrinth.com/v2/version_files', {
            hashes: batch.map((f) => f.sha512),
            algorithm: 'sha512',
          }),
        );
        for (const file of batch) {
          const version = record(versions[file.sha512]);
          if (
            !Array.isArray(version.files) ||
            typeof version.project_id !== 'string' ||
            typeof version.id !== 'string'
          ) {
            continue;
          }
          for (const raw of version.files as unknown[]) {
            const found = record(raw);
            if (record(found.hashes).sha512 !== file.sha512 || found.size !== file.size) {
              continue;
            }
            try {
              matches.set(file.path, {
                provider: 'modrinth',
                projectId: version.project_id,
                versionId: version.id,
                url: bypackDownloadUrl(found.url, 'modrinth'),
              });
            } catch {
              /* Keep the file embedded if no supported download is available. */
            }
          }
        }
        modrinthFailures = 0;
      } catch (error) {
        if (!warnings.length) {
          warnings.push(
            `No se pudo completar la identificación en Modrinth (${error instanceof Error ? error.message : 'error de red'}); los archivos no identificados se incluyen comprimidos.`,
          );
        }
        if (++modrinthFailures >= 3) {
          break;
        }
      }
    }
    progress?.(
      `Modrinth: ${matches.size} de ${files.length} archivos identificados.`,
      files.length,
      files.length,
    );
    const remaining = files.filter((file) => !matches.has(file.path));
    if (!remaining.length) {
      return { matches, warnings };
    }
    const matchCurseForge = (raw: unknown): void => {
      const found = record(raw);
      if (
        !Number.isSafeInteger(found.modId) ||
        Number(found.modId) <= 0 ||
        !Number.isSafeInteger(found.id) ||
        Number(found.id) <= 0 ||
        found.isAvailable === false ||
        !Array.isArray(found.hashes)
      ) {
        return;
      }
      const sha1 = (found.hashes as unknown[]).map(record).find((hash) => hash.algo === 1)?.value;
      for (const file of remaining) {
        if (
          typeof sha1 !== 'string' ||
          sha1.toLowerCase() !== file.sha1 ||
          found.fileLength !== file.size
        ) {
          continue;
        }
        try {
          matches.set(file.path, {
            provider: 'curseforge',
            projectId: String(found.modId),
            versionId: String(found.id),
            url: bypackDownloadUrl(found.downloadUrl, 'curseforge'),
          });
        } catch {
          /* Disabled distribution must not become a broken reference. */
        }
      }
    };
    {
      try {
        for (let start = 0; start < remaining.length; start += 64) {
          const batch = remaining.slice(start, start + 64);
          progress?.(
            `CurseForge: comprobando huellas ${start + 1}–${start + batch.length} de ${remaining.length}…`,
            start,
            remaining.length,
          );
          const fingerprints: number[] = [];
          for (const file of batch) {
            fingerprints.push(await curseForgeFingerprint(file.absolutePath));
          }
          const data = payload(
            await this.#json(
              this.options.curseForgeFingerprintUrl ??
                (this.options.curseForgeKey
                  ? 'https://api.curseforge.com/v1/fingerprints'
                  : new URL(
                      'fingerprints',
                      this.options.curseForgeApiBase ??
                        'https://api.battlylauncher.com/curseforge/',
                    ).toString()),
              { fingerprints },
              this.options.curseForgeKey,
            ),
          );
          if (!Array.isArray(data.exactMatches)) {
            throw new Error('Respuesta de CurseForge inválida');
          }
          for (const match of data.exactMatches as unknown[]) {
            matchCurseForge(record(match).file);
          }
        }
      } catch (error) {
        warnings.push(
          `No se pudo completar la identificación en CurseForge (${error instanceof Error ? error.message : 'error de red'}). Comprueba que el servidor tenga /curseforge/fingerprints actualizado; se conservan los archivos sin identificar.`,
        );
      }
    }
    // Known IDs also work without fingerprints. Bound concurrent requests and stop promptly
    // when the metadata service is unavailable instead of retrying thousands of files.
    const queue = [
      ...new Map(
        references.slice(0, 2000).map((ref) => [`${ref.projectId}/${ref.fileId}`, ref]),
      ).values(),
    ];
    let failures = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && failures < 3 && remaining.some((file) => !matches.has(file.path))) {
          const reference = queue.shift()!;
          progress?.(
            `CurseForge: comprobando referencias (${queue.length} pendientes)…`,
            references.length - queue.length,
            references.length,
          );
          try {
            const url = new URL(
              `mod/${reference.projectId}/file/${reference.fileId}`,
              this.options.curseForgeApiBase ?? 'https://api.battlylauncher.com/curseforge/',
            );
            const response = record(await this.#json(url.toString()));
            matchCurseForge(payload(response));
          } catch {
            failures++;
          }
        }
      }),
    );
    const curseforge = [...matches.values()].filter(
      (match) => match.provider === 'curseforge',
    ).length;
    progress?.(
      `Verificación completada: ${matches.size - curseforge} Modrinth, ${curseforge} CurseForge, ${files.length - matches.size} archivos sin identificar se incluirán comprimidos.`,
      files.length,
      files.length,
    );
    return { matches, warnings };
  }
}
