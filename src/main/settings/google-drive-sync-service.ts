import type { DriveTransferProgress } from '../../shared/settings/drive-progress';
import type { Dirent } from 'node:fs';
import type { DriveState, WorldBackupSummary } from '../../shared/mybattly/mybattly-contract';

import { normalizeContentName } from '../../shared/mybattly/mybattly-contract';

import type { JsonValue } from '../../shared/storage/legacy-storage';

import type { GoogleDriveCredentials, SettingsStore } from './settings-store';

import { copyFile, lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { createHash, randomUUID } from 'node:crypto';

import {
  collectWorldFiles,
  inventoryWorldFiles,
  hashWorldFile,
  restoreSnapshot,
  validateSnapshot,
  type DriveSnapshot,
} from './drive-snapshots';

const folderMimeType = 'application/vnd.google-apps.folder';

const maximumDriveResponseBytes = 32 * 1024 * 1024;

export interface GoogleDriveSyncOutcome {
  readonly success: boolean;

  readonly count: number;

  readonly reason?: 'no_tokens' | 'expired';
}

export interface GoogleDriveWorldSyncOutcome extends GoogleDriveSyncOutcome {
  readonly files: number;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

async function responseJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));

  if (Number.isFinite(declared) && declared > maximumDriveResponseBytes) {
    throw new TypeError('Google Drive response is too large');
  }

  if (!response.body) {
    throw new TypeError('Empty Google Drive response');
  }

  const chunks: Uint8Array[] = [];

  let length = 0;

  for await (const chunk of response.body) {
    length += chunk.byteLength;

    if (length > maximumDriveResponseBytes) {
      throw new TypeError('Google Drive response is too large');
    }

    chunks.push(chunk);
  }

  const bytes = Buffer.concat(chunks);

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new TypeError('Google Drive response is invalid JSON');
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid Google Drive ${label}`);
  }

  return value as Record<string, unknown>;
}

function fileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) {
    throw new TypeError('Invalid Google Drive file id');
  }

  return value;
}

function driveQueryUrl(query: string): URL {
  const url = new URL('https://www.googleapis.com/drive/v3/files');

  url.searchParams.set('q', query);

  url.searchParams.set('fields', 'files(id,name,modifiedTime)');

  url.searchParams.set('pageSize', '10');

  url.searchParams.set('spaces', 'drive');

  return url;
}

function escapeQueryValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function shortDriveProperty(value: string): string {
  let result = '';

  for (const char of value) {
    if (Buffer.byteLength(result + char, 'utf8') > 90) {
      break;
    }

    result += char;
  }

  return result;
}

function historyEntries(value: unknown): Record<string, JsonValue>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value

    .slice(0, 100)

    .filter(
      (entry): entry is Record<string, JsonValue> =>
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
    );
}

function entryKey(entry: Record<string, JsonValue>, index: number): string {
  const id = Object.getOwnPropertyDescriptor(entry, 'id')?.value as JsonValue | undefined;

  return typeof id === 'string' && id ? id : `anonymous:${index}:${JSON.stringify(entry)}`;
}

function timestamp(entry: Record<string, JsonValue>): number {
  const value = Object.getOwnPropertyDescriptor(entry, 'timestamp')?.value as JsonValue | undefined;

  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;

  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeBackupHistory(local: JsonValue, remote: unknown): JsonValue {
  const merged = new Map<string, Record<string, JsonValue>>();

  historyEntries(local).forEach((entry, index) => merged.set(entryKey(entry, index), entry));

  historyEntries(remote).forEach((entry, index) => {
    const key = entryKey(entry, index);

    const current = merged.get(key);

    if (!current || timestamp(entry) > timestamp(current)) {
      merged.set(key, entry);
    }
  });

  return [...merged.values()].sort((a, b) => timestamp(b) - timestamp(a)).slice(0, 50);
}

export class GoogleDriveSyncService {
  readonly #store: SettingsStore;

  readonly #fetch: typeof fetch;

  readonly #refreshUrl: URL;

  #refreshing: Promise<GoogleDriveCredentials | null> | null = null;

  readonly #renewedTokens = new Map<string, string>();

  #syncQueue: Promise<unknown> = Promise.resolve();

  async waitForIdle(): Promise<void> {
    await this.#syncQueue.catch(() => undefined);
  }

  constructor(
    store: SettingsStore,

    fetchImplementation: typeof fetch = fetch,

    refreshUrl = 'https://battlylauncher.com/google-drive/refresh-token',
  ) {
    this.#store = store;

    this.#fetch = fetchImplementation;

    this.#refreshUrl = new URL(refreshUrl);

    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(this.#refreshUrl.hostname);

    if (
      this.#refreshUrl.protocol !== 'https:' &&
      !(loopback && this.#refreshUrl.protocol === 'http:')
    ) {
      throw new TypeError('Google Drive refresh endpoint must use HTTPS');
    }
  }

  async state(): Promise<DriveState> {
    const result = await this.#credentials();

    if (!result.credentials) {
      return { connected: false, email: null, name: null, folderId: null };
    }

    let response: Response;

    try {
      response = await this.#request(
        new URL('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)'),

        result.credentials.accessToken,

        { method: 'GET' },
      );
    } catch (error) {
      if (error instanceof Error && /\((401|403)\)/.test(error.message)) {
        return { connected: false, email: null, name: null, folderId: null };
      }

      throw error;
    }

    const user = object(own(object(await responseJson(response), 'account'), 'user'), 'user');

    return {
      connected: true,

      email: typeof user.emailAddress === 'string' ? user.emailAddress : null,

      name: typeof user.displayName === 'string' ? user.displayName : null,

      folderId: await this.#findFile(
        result.credentials.accessToken,

        'Battly',

        'root',

        folderMimeType,
      ),
    };
  }

  async listBackups(): Promise<readonly WorldBackupSummary[]> {
    const result = await this.#credentials();

    if (!result.credentials) {
      return [];
    }

    const token = result.credentials.accessToken;

    const root = await this.#findFile(token, 'Battly', 'root', folderMimeType);

    if (!root) {
      return [];
    }

    const backups: WorldBackupSummary[] = [];

    let pageToken = '';

    do {
      const url = driveQueryUrl(
        `'${escapeQueryValue(root)}' in parents and mimeType='${folderMimeType}' and trashed=false`,
      );

      url.searchParams.set('fields', 'nextPageToken,files(id,name,modifiedTime)');

      url.searchParams.set('pageSize', '100');

      if (pageToken) {
        url.searchParams.set('pageToken', pageToken);
      }

      const data = object(
        await responseJson(await this.#request(url, token, { method: 'GET' })),

        'list',
      );

      if (!Array.isArray(data.files)) {
        throw new Error('Respuesta de Drive no válida');
      }

      for (const value of data.files) {
        const file = object(value, 'file');

        if (file.name === '.battly-snapshot-data') {
          continue;
        }

        backups.push({
          id: `drive:${fileId(file.id)}`,

          worldName: String(file.name),

          createdAt: String(file.modifiedTime),

          archiveName: '',

          sizeBytes: 0,

          storage: 'drive',

          restorable: true,
        });
      }

      pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    } while (pageToken);

    const snapshots = await this.#snapshotFiles(token, root);

    for (const file of snapshots) {
      const props = object(file.appProperties, 'snapshot properties');

      backups.push({
        id: `snapshot:${fileId(file.id)}`,

        worldName: String(props.worldName),

        createdAt: String(props.createdAt),

        archiveName: '',

        sizeBytes: Number(props.sizeBytes) || 0,

        scope: String(props.scope),

        storage: 'drive',

        restorable: true,
      });
    }

    return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async archiveBackup(id: string): Promise<void> {
    const result = await this.#credentials();

    if (!result.credentials) {
      throw new Error('Inicia sesión en Google Drive');
    }

    if (!(await this.listBackups()).some((entry) => entry.id === id)) {
      throw new Error('Copia desconocida');
    }

    await this.#request(
      new URL(`https://www.googleapis.com/drive/v3/files/${fileId(id.split(':')[1])}`),

      result.credentials.accessToken,

      {
        method: 'PATCH',

        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ trashed: true }),
      },
    );
  }

  async sync(signal?: AbortSignal): Promise<GoogleDriveSyncOutcome> {
    const credentials = await this.#credentials(signal);

    if (!credentials.credentials) {
      return { success: false, count: 0, reason: credentials.reason };
    }

    const activeCredentials = credentials.credentials;

    const folderId = await this.#findOrCreateFolder(activeCredentials.accessToken, signal);

    const existingId = await this.#findFile(
      activeCredentials.accessToken,

      'backup-history.json',

      folderId,

      undefined,

      signal,
    );

    let remote: unknown = [];

    if (existingId) {
      const response = await this.#request(
        new URL(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(existingId)}?alt=media`,
        ),

        activeCredentials.accessToken,

        { method: 'GET' },

        signal,
      );

      remote = await responseJson(response);
    }

    const account = await this.state();

    const local = historyEntries(await this.#store.backupHistory());

    const merged = mergeBackupHistory(
      local.filter((entry) => entry.driveAccount === account.email),

      remote,
    );

    // Cloud metadata must never replace or become a local filesystem authority.
    const retained = local.filter(
      (entry) => entry.remoteHistory !== true || entry.driveAccount !== account.email,
    );
    const localIds = new Set(retained.map((entry) => entry.id));

    await this.#store.replaceBackupHistory([
      ...retained,

      ...historyEntries(merged)
        .filter((entry) => !localIds.has(entry.id))
        .map((entry) => ({ ...entry, driveAccount: account.email, remoteHistory: true })),
    ]);

    await this.#uploadHistory(activeCredentials.accessToken, folderId, existingId, merged, signal);

    return { success: true, count: historyEntries(merged).length };
  }

  async syncWorlds(
    savesRoot: string,

    signal?: AbortSignal,

    selectedWorld?: string,

    progress: (message: string, detail?: DriveTransferProgress) => void = () => undefined,

    scope = 'general',
  ): Promise<GoogleDriveWorldSyncOutcome> {
    const work = this.#syncQueue

      .catch(() => undefined)

      .then(() => this.#saveWorldSnapshots(savesRoot, signal, selectedWorld, progress, scope));

    this.#syncQueue = work;

    return work;
  }

  /** One transfer denominator for the general saves folder and all instances. */
  async syncWorldGroups(
    sources: readonly { savesRoot: string; scope: string }[],
    progress: (message: string, detail?: DriveTransferProgress) => void,
    completed: (scope: string, result: GoogleDriveWorldSyncOutcome) => Promise<void> = () =>
      Promise.resolve(),
  ): Promise<GoogleDriveWorldSyncOutcome> {
    const work = this.#syncQueue
      .catch(() => undefined)
      .then(async () => {
        const credentials = await this.#credentials();
        if (!credentials.credentials) {
          return { success: false, count: 0, files: 0, reason: credentials.reason };
        }
        let totalBytes = 0,
          totalFiles = 0;
        const totals = [];
        progress('Guardando tus mundos', { phase: 'checking', completedFiles: 0, totalFiles: 0 });
        for (const source of sources) {
          let entries: Dirent[];
          try {
            entries = await readdir(source.savesRoot, { withFileTypes: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
            entries = [];
          }
          let bytes = 0,
            files = 0;
          for (const entry of entries.filter(
            (item) => item.isDirectory() && !item.isSymbolicLink(),
          )) {
            const inventory = await inventoryWorldFiles(join(source.savesRoot, entry.name));
            files += inventory.length;
            bytes += inventory.reduce((sum, file) => sum + file.size, 0);
          }
          totals.push({ source, bytes, files });
          totalBytes += bytes;
          totalFiles += files;
        }
        let doneBytes = 0,
          doneFiles = 0,
          count = 0,
          uploadedFiles = 0;
        for (const { source, bytes, files } of totals) {
          const result = await this.#saveWorldSnapshots(
            source.savesRoot,
            undefined,
            undefined,
            (message, detail) => {
              progress(message, {
                phase: detail?.phase ?? 'checking',
                totalBytes,
                totalFiles,
                completedBytes: doneBytes + (detail?.completedBytes ?? 0),
                completedFiles: doneFiles + (detail?.completedFiles ?? 0),
              });
            },
            source.scope,
          );
          if (!result.success) {
            return result;
          }
          doneBytes += bytes;
          doneFiles += files;
          count += result.count;
          uploadedFiles += result.files;
          await completed(source.scope, result);
          progress('Sincronizando el historial de Google Drive…', {
            phase: 'publishing',
            totalBytes,
            totalFiles,
            completedBytes: doneBytes,
            completedFiles: doneFiles,
          });
        }
        return { success: true, count, files: uploadedFiles };
      });
    this.#syncQueue = work;
    return work;
  }

  async #saveWorldSnapshots(
    savesRoot: string,

    signal: AbortSignal | undefined,

    selectedWorld: string | undefined,

    progress: (message: string, detail?: DriveTransferProgress) => void,

    scope: string,
  ): Promise<GoogleDriveWorldSyncOutcome> {
    const credentialResult = await this.#credentials(signal);

    if (!credentialResult.credentials) {
      return { success: false, count: 0, files: 0, reason: credentialResult.reason };
    }

    const accessToken = credentialResult.credentials.accessToken;

    const battlyFolderId = await this.#findOrCreateFolder(accessToken, signal);

    let entries;

    try {
      entries = await readdir(savesRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (selectedWorld) {
          throw new Error('El mundo ya no está disponible', { cause: error });
        }

        return { success: true, count: 0, files: 0 };
      }

      throw error;
    }

    const worlds = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        (!selectedWorld || entry.name === normalizeContentName(selectedWorld)),
    );

    if (selectedWorld && !worlds.length) {
      throw new Error('El mundo ya no está disponible');
    }

    let files = 0;
    let snapshots = 0;

    const blobFolder = await this.#findOrCreateNamedFolder(
      accessToken,

      battlyFolderId,

      '.battly-snapshot-data',

      signal,
    );

    const blobs = await this.#blobIndex(accessToken, blobFolder);

    const existing = await this.#snapshotFiles(accessToken, battlyFolderId);

    const planned = [];
    let totalFiles = 0;
    let completedFiles = 0;
    let totalBytes = 0;
    let completedBytes = 0;
    const transferringBytes = new Map<string, number>();
    for (const world of worlds) {
      signal?.throwIfAborted();
      progress(`Preparando ${world.name}…`, {
        phase: 'checking',
        completedFiles: 0,
        totalFiles: 0,
      });
      const root = join(savesRoot, world.name);
      const collected = await collectWorldFiles(root, (detail) =>
        progress(`Preparando ${world.name} / ${detail.path}…`, {
          phase: 'checking',
          completedFiles: 0,
          totalFiles: 0,
        }),
      );
      planned.push({ world, root, collected });
      totalFiles += collected.length;
      totalBytes += collected.reduce((sum, file) => sum + file.size, 0);
    }
    const report = (message: string, phase: DriveTransferProgress['phase'] = 'files'): void =>
      progress(message, {
        phase,
        completedFiles,
        totalFiles,
        totalBytes,
        completedBytes: Math.min(
          totalBytes,
          completedBytes + [...transferringBytes.values()].reduce((sum, bytes) => sum + bytes, 0),
        ),
      });
    for (const { world, root, collected } of planned) {
      const key = createHash('sha256').update(`${scope}\0${world.name}`).digest('hex');

      const fingerprint = createHash('sha256').update(JSON.stringify(collected)).digest('hex');

      const latest = existing

        .filter((item) => (item.appProperties as Record<string, string>)?.worldKey === key)

        .sort((a, b) =>
          String((b.appProperties as Record<string, string>).createdAt).localeCompare(
            String((a.appProperties as Record<string, string>).createdAt),
          ),
        )[0];

      if (
        (latest?.appProperties as Record<string, string> | undefined)?.fingerprint === fingerprint
      ) {
        completedFiles += collected.length;
        completedBytes += collected.reduce((sum, file) => sum + file.size, 0);
        report(world.name);
        continue;
      }

      const manifest: DriveSnapshot = {
        format: 'battly-world-snapshot',

        version: 1,

        worldName: world.name,

        scope,

        createdAt: new Date().toISOString(),

        files: [],
      };

      let cursor = 0;
      let failed = false;
      const inFlight = new Map<string, Promise<string>>();
      const upload = async (file: (typeof collected)[number]): Promise<string> => {
        const cached = blobs.get(file.sha256);
        if (cached) {
          return cached;
        }
        const pending = inFlight.get(file.sha256);
        if (pending) {
          return pending;
        }
        const task = (async () => {
          report(`Subiendo ${world.name} / ${file.path}…`);
          let id: string;
          const temporary = await mkdtemp(join(tmpdir(), 'battly-drive-'));

          try {
            const staged = join(temporary, 'content');

            await copyFile(join(root, file.path), staged);

            if ((await hashWorldFile(staged)) !== file.sha256) {
              throw new Error('World changed before upload');
            }

            id = await this.#uploadWorldFile(
              accessToken,
              blobFolder,
              file.sha256,
              staged,
              signal,
              (bytes) => {
                transferringBytes.set(file.path, bytes);
                report(`Subiendo ${world.name} / ${file.path}…`);
              },
            );
          } finally {
            await rm(temporary, { recursive: true, force: true });
          }

          if (!id || (await hashWorldFile(join(root, file.path))) !== file.sha256) {
            throw new Error('World changed during upload; backup not published');
          }

          await this.#request(
            new URL(`https://www.googleapis.com/drive/v3/files/${fileId(id)}`),

            accessToken,

            {
              method: 'PATCH',

              headers: { 'content-type': 'application/json' },

              body: JSON.stringify({ appProperties: { battlyBlobComplete: '1' } }),
            },

            signal,
          );

          blobs.set(file.sha256, id);

          files++;
          return id;
        })();
        inFlight.set(file.sha256, task);
        return task;
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(4, collected.length) }, async () => {
          try {
            while (!failed && cursor < collected.length) {
              signal?.throwIfAborted();
              const index = cursor++;
              const file = collected[index];
              const id = await upload(file);
              manifest.files[index] = { ...file, id };
              completedFiles++;
              transferringBytes.delete(file.path);
              completedBytes += file.size;
              report(`${completedFiles}/${totalFiles} · ${world.name} / ${file.path}`);
            }
          } catch (error) {
            failed = true;
            throw error;
          }
        }),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) {
        throw failure.reason;
      }

      validateSnapshot(manifest);

      if (
        JSON.stringify(
          await collectWorldFiles(root, (detail) =>
            report(`Comprobando ${world.name} / ${detail.path}…`, 'checking'),
          ),
        ) !== JSON.stringify(collected)
      ) {
        throw new Error('World changed; backup not published');
      }

      report(world.name, 'publishing');

      // A manifest is the commit record: incomplete uploads never appear as backups.

      await this.#publishSnapshot(
        accessToken,

        battlyFolderId,

        manifest,

        { worldKey: key, fingerprint },

        signal,
      );
      snapshots++;
    }

    // Unchanged worlds need neither a duplicate history entry nor another cloud write.
    if (!snapshots) {
      return { success: true, count: worlds.length, files };
    }
    const account = await this.state();

    const currentHistory = await this.#store.backupHistory();

    const history = historyEntries(currentHistory);

    history.unshift({
      id: `drive-${Date.now()}`,

      timestamp: new Date().toISOString(),

      status: 'completed',

      worlds: worlds.map((world) => world.name),

      totalFiles: files,

      autoBackup: !selectedWorld,

      driveAccount: account.email,
    });

    await this.#store.replaceBackupHistory(history.slice(0, 50));

    report('Sincronizando el historial de Google Drive…', 'publishing');

    await this.sync(signal);

    return { success: true, count: worlds.length, files };
  }

  async #credentials(
    signal?: AbortSignal,
  ): Promise<
    | { readonly credentials: GoogleDriveCredentials; readonly reason?: never }
    | { readonly credentials: null; readonly reason: 'no_tokens' | 'expired' }
  > {
    let credentials = await this.#store.googleDriveCredentials();

    if (!credentials) {
      return { credentials: null, reason: 'no_tokens' };
    }
    // A short-lived access token is not an offline authorization. Surface the
    // need to reconnect before a game closes, rather than claiming it is ready.
    if (!credentials.refreshToken) {
      return { credentials: null, reason: 'expired' };
    }

    credentials = await this.#refreshIfNeeded(credentials, signal);

    return credentials ? { credentials } : { credentials: null, reason: 'expired' };
  }

  async #refreshIfNeeded(
    credentials: GoogleDriveCredentials,

    signal?: AbortSignal,
  ): Promise<GoogleDriveCredentials | null> {
    if (credentials.expiresAt !== null && credentials.expiresAt > Date.now() + 60_000) {
      return credentials;
    }

    if (!credentials.refreshToken) {
      return credentials.expiresAt === null ? credentials : null;
    }

    if (this.#refreshing) {
      return this.#refreshing;
    }

    this.#refreshing = this.#refreshCredentials(credentials, signal).finally(() => {
      this.#refreshing = null;
    });

    return this.#refreshing;
  }

  async #refreshCredentials(
    credentials: GoogleDriveCredentials,

    signal?: AbortSignal,
  ): Promise<GoogleDriveCredentials | null> {
    const response = await this.#fetch(this.#refreshUrl, {
      method: 'POST',

      headers: { accept: 'application/json', 'content-type': 'application/json' },

      body: JSON.stringify({ refresh_token: credentials.refreshToken }),

      redirect: 'error',

      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Google Drive token refresh failed (${response.status})`);
    }

    const data = object(await responseJson(response), 'refresh response');

    const accessToken = own(data, 'access_token');

    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 16_384) {
      return null;
    }

    const expiresIn = Number(own(data, 'expires_in'));
    const expiryDate = Number(own(data, 'expiry_date'));
    const refreshToken = own(data, 'refresh_token');

    const next: GoogleDriveCredentials = {
      accessToken,

      refreshToken:
        typeof refreshToken === 'string' && refreshToken.length > 0 && refreshToken.length <= 16_384
          ? refreshToken
          : credentials.refreshToken,

      expiresAt:
        Number.isFinite(expiryDate) && expiryDate > Date.now()
          ? expiryDate
          : Number.isFinite(expiresIn) && expiresIn > 0
            ? Date.now() + expiresIn * 1000
            : Date.now() + 300000,
    };

    await this.#store.replaceGoogleDriveCredentials(next);
    if (next.accessToken !== credentials.accessToken) {
      for (const [old, current] of this.#renewedTokens) {
        if (current === credentials.accessToken) {
          this.#renewedTokens.set(old, next.accessToken);
        }
      }
      this.#renewedTokens.set(credentials.accessToken, next.accessToken);
      if (this.#renewedTokens.size > 16) {
        this.#renewedTokens.delete(this.#renewedTokens.keys().next().value!);
      }
    }

    return next;
  }

  async #findOrCreateFolder(accessToken: string, signal?: AbortSignal): Promise<string> {
    const existing = await this.#findFile(accessToken, 'Battly', 'root', folderMimeType, signal);

    if (existing) {
      return existing;
    }

    const response = await this.#request(
      new URL('https://www.googleapis.com/drive/v3/files?fields=id'),

      accessToken,

      {
        method: 'POST',

        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ name: 'Battly', mimeType: folderMimeType, parents: ['root'] }),
      },

      signal,
    );

    return fileId(own(object(await responseJson(response), 'folder response'), 'id'));
  }

  async #findOrCreateNamedFolder(
    accessToken: string,

    parent: string,

    name: string,

    signal?: AbortSignal,
  ): Promise<string> {
    const existing = await this.#findFile(accessToken, name, parent, folderMimeType, signal);

    if (existing) {
      return existing;
    }

    const response = await this.#request(
      new URL('https://www.googleapis.com/drive/v3/files?fields=id'),

      accessToken,

      {
        method: 'POST',

        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ name, mimeType: folderMimeType, parents: [parent] }),
      },

      signal,
    );

    return fileId(own(object(await responseJson(response), 'folder response'), 'id'));
  }

  async #uploadWorldFile(
    accessToken: string,

    parent: string,

    name: string,

    path: string,

    signal?: AbortSignal,
    onBytes: (bytes: number) => void = () => undefined,
  ): Promise<string> {
    const info = await lstat(path);

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Archivo del mundo no válido');
    }

    const uploadPath = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    const session = await this.#request(
      new URL(uploadPath),

      accessToken,

      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',

          'x-upload-content-type': 'application/octet-stream',

          'x-upload-content-length': String(info.size),
        },

        body: JSON.stringify({ name, parents: [parent] }),
      },

      signal,
    );

    const location = new URL(session.headers.get('location') ?? '');

    if (location.protocol !== 'https:' || location.hostname !== 'www.googleapis.com') {
      throw new Error('Invalid Drive upload URL');
    }

    const handle = await open(path, 'r');

    try {
      const chunkSize = 8 * 1024 * 1024;

      let position = 0;

      do {
        const buffer = Buffer.alloc(Math.min(chunkSize, info.size - position));

        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);

        if (bytesRead !== buffer.length) {
          throw new Error('El mundo cambió durante la copia; vuelve a intentarlo');
        }

        const end = position + bytesRead;

        const response = await this.#request(
          location,

          accessToken,

          {
            method: 'PUT',

            redirect: 'error',

            headers: {
              authorization: `Bearer ${accessToken}`,

              'content-type': 'application/octet-stream',

              'content-range': info.size
                ? `bytes ${position}-${end - 1}/${info.size}`
                : 'bytes */0',
            },

            body: new Uint8Array(buffer),

            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
              : AbortSignal.timeout(120000),
          },

          signal,

          true,
        );

        if (end < info.size ? response.status !== 308 : !response.ok) {
          throw new Error(`Google Drive upload failed (${response.status})`);
        }

        position = end;
        onBytes(position);

        if (response.ok) {
          return fileId(own(object(await responseJson(response), 'upload'), 'id'));
        }
      } while (position < info.size);

      throw new Error('Google Drive upload did not complete');
    } finally {
      await handle.close();
    }
  }

  async #findFile(
    accessToken: string,

    name: string,

    parent: string,

    mimeType?: string,

    signal?: AbortSignal,
  ): Promise<string | null> {
    const clauses = [
      `name='${escapeQueryValue(name)}'`,

      `'${escapeQueryValue(parent)}' in parents`,

      'trashed=false',
    ];

    if (mimeType) {
      clauses.push(`mimeType='${escapeQueryValue(mimeType)}'`);
    }

    const response = await this.#request(
      driveQueryUrl(clauses.join(' and ')),

      accessToken,

      { method: 'GET' },

      signal,
    );

    const files = own(object(await responseJson(response), 'file list'), 'files');

    if (!Array.isArray(files) || files.length > 10) {
      throw new TypeError('Invalid Drive file list');
    }

    if (!files.length) {
      return null;
    }

    return fileId(own(object(files[0], 'file'), 'id'));
  }

  async #uploadHistory(
    accessToken: string,

    folderId: string,

    existingId: string | null,

    history: JsonValue,

    signal?: AbortSignal,
  ): Promise<void> {
    const boundary = `battly_${Date.now().toString(36)}`;

    const metadata = existingId
      ? {}
      : { name: 'backup-history.json', parents: [folderId], mimeType: 'application/json' };

    const body = [
      `--${boundary}`,

      'Content-Type: application/json; charset=UTF-8',

      '',

      JSON.stringify(metadata),

      `--${boundary}`,

      'Content-Type: application/json',

      '',

      JSON.stringify(history, null, 2),

      `--${boundary}--`,

      '',
    ].join('\r\n');

    const path = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

    await this.#request(
      new URL(path),

      accessToken,

      {
        method: existingId ? 'PATCH' : 'POST',

        headers: { 'content-type': `multipart/related; boundary=${boundary}` },

        body,
      },

      signal,
    );
  }

  async #request(
    url: URL,

    accessToken: string,

    init: RequestInit,

    signal?: AbortSignal,

    resumable = false,
  ): Promise<Response> {
    accessToken = this.#renewedTokens.get(accessToken) || accessToken;
    let response = await this.#fetch(url, {
      ...init,

      headers: {
        ...init.headers,

        accept: 'application/json',

        authorization: `Bearer ${accessToken}`,
      },

      // Drive uses 308 as Resume Incomplete, not a redirect to follow.
      redirect: resumable ? 'manual' : 'error',

      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(init.method === 'PUT' ? 120_000 : 15_000)])
        : AbortSignal.timeout(init.method === 'PUT' ? 120_000 : 15_000),
    });

    if (response.status === 401) {
      const saved = await this.#store.googleDriveCredentials();

      const renewed =
        saved &&
        (saved.accessToken !== accessToken
          ? saved
          : await this.#refreshIfNeeded({ ...saved, expiresAt: 0 }, signal));

      if (renewed) {
        response = await this.#fetch(url, {
          ...init,

          headers: { ...init.headers, authorization: `Bearer ${renewed.accessToken}` },

          // Drive uses 308 as Resume Incomplete, not a redirect to follow.
          redirect: resumable ? 'manual' : 'error',

          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
            : AbortSignal.timeout(120000),
        });
      }
    }

    if (!response.ok && !(resumable && response.status === 308)) {
      throw new Error(`Google Drive request failed (${response.status})`);
    }

    return response;
  }

  async #blobIndex(token: string, parent: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();

    let next = '';

    do {
      const url = driveQueryUrl(`'${escapeQueryValue(parent)}' in parents and trashed=false`);

      url.searchParams.set('fields', 'nextPageToken,files(id,name,appProperties)');

      url.searchParams.set('pageSize', '1000');

      if (next) {
        url.searchParams.set('pageToken', next);
      }

      const data = object(
        await responseJson(await this.#request(url, token, { method: 'GET' })),

        'backup objects',
      );

      if (!Array.isArray(data.files)) {
        throw new Error('Invalid backup objects');
      }

      for (const entry of data.files) {
        const file = object(entry, 'backup object');

        if (
          typeof file.name === 'string' &&
          /^[a-f0-9]{64}$/.test(file.name) &&
          (file.appProperties as Record<string, string> | undefined)?.battlyBlobComplete === '1'
        ) {
          index.set(file.name, fileId(file.id));
        }
      }

      if (index.size > 500000) {
        throw new Error('Backup storage index is too large');
      }

      next = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    } while (next);

    return index;
  }

  async #snapshotFiles(token: string, root: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = [];

    let next = '';

    do {
      const url = driveQueryUrl(
        `'${escapeQueryValue(root)}' in parents and trashed=false and appProperties has { key='battlySnapshot' and value='1' }`,
      );

      url.searchParams.set('fields', 'nextPageToken,files(id,name,appProperties)');

      url.searchParams.set('pageSize', '100');

      if (next) {
        url.searchParams.set('pageToken', next);
      }

      const data = object(
        await responseJson(await this.#request(url, token, { method: 'GET' })),

        'snapshots',
      );

      if (!Array.isArray(data.files)) {
        throw new Error('Invalid snapshot list');
      }

      result.push(...data.files.map((item) => object(item, 'snapshot')));

      next = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';

      if (result.length > 10000) {
        throw new Error('Too many backups');
      }
    } while (next);

    return result;
  }

  async #publishSnapshot(
    token: string,

    parent: string,

    manifest: DriveSnapshot,

    extra: Record<string, string>,

    signal?: AbortSignal,
  ): Promise<void> {
    const boundary = `battly_${randomUUID()}`;

    const metadata = {
      name: `${manifest.createdAt.replaceAll(':', '-')}-${randomUUID()}.battly-backup.json`,

      parents: [parent],

      mimeType: 'application/json',

      appProperties: {
        battlySnapshot: '1',

        worldName: shortDriveProperty(manifest.worldName),

        scope: shortDriveProperty(manifest.scope),

        createdAt: manifest.createdAt,

        sizeBytes: String(manifest.files.reduce((total, file) => total + file.size, 0)),

        ...extra,
      },
    };

    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(manifest)}\r\n--${boundary}--\r\n`;

    await this.#request(
      new URL('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'),

      token,

      {
        method: 'POST',

        headers: { 'content-type': `multipart/related; boundary=${boundary}` },

        body,
      },

      signal,
    );
  }

  async restore(
    id: string,

    savesRoot: string,

    progress: (message: string, detail?: DriveTransferProgress) => void = () => undefined,
  ): Promise<string> {
    if (!(await this.listBackups()).some((item) => item.id === id && item.restorable)) {
      throw new Error('Unknown restorable backup');
    }

    const credentials = await this.#credentials();

    if (!credentials.credentials) {
      throw new Error('Connect Google Drive');
    }

    const token = credentials.credentials.accessToken;

    const download = (value: string, signal?: AbortSignal): Promise<Response> =>
      this.#request(
        new URL(`https://www.googleapis.com/drive/v3/files/${fileId(value)}?alt=media`),

        token,

        { method: 'GET' },
        signal,
      );

    const manifest = id.startsWith('drive:')
      ? await this.#legacyManifest(token, id)
      : await responseJson(await download(fileId(id.split(':')[1])));

    return restoreSnapshot(manifest, savesRoot, download, progress);
  }

  async #legacyManifest(token: string, id: string): Promise<DriveSnapshot> {
    const backup = (await this.listBackups()).find((item) => item.id === id)!;

    const manifest: DriveSnapshot = {
      format: 'battly-world-snapshot',

      version: 1,

      worldName: backup.worldName,

      scope: 'legacy',

      createdAt: backup.createdAt,

      files: [],
    };

    const visited = new Set<string>();

    const walk = async (parent: string, prefix: string, depth: number): Promise<void> => {
      if (depth > 32 || visited.has(parent)) {
        throw new Error('Invalid backup folder tree');
      }

      visited.add(parent);

      let next = '';

      do {
        const url = driveQueryUrl(`'${escapeQueryValue(parent)}' in parents and trashed=false`);

        url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,size,md5Checksum)');

        url.searchParams.set('pageSize', '100');

        if (next) {
          url.searchParams.set('pageToken', next);
        }

        const data = object(
          await responseJson(await this.#request(url, token, { method: 'GET' })),

          'legacy backup',
        );

        if (!Array.isArray(data.files)) {
          throw new Error('Invalid backup files');
        }

        for (const value of data.files) {
          const file = object(value, 'legacy file');

          const path = prefix + normalizeContentName(file.name);

          if (file.mimeType === folderMimeType) {
            await walk(fileId(file.id), path + '/', depth + 1);
          } else {
            manifest.files.push({
              path,

              id: fileId(file.id),

              size: Number(file.size),

              sha256: '',

              md5: String(file.md5Checksum),
            });

            if (manifest.files.length > 100000) {
              throw new Error('Backup has too many files');
            }
          }
        }

        next = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
      } while (next);
    };

    await walk(fileId(id.split(':')[1]), '', 0);

    return validateSnapshot(manifest);
  }
}
