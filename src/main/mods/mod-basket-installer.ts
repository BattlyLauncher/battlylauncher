import { strict as assert } from 'node:assert';
import { fabricLoaderMetadata } from './mod-loader-metadata';
import { resolveModBasket, BasketResolutionFailure } from './mod-basket-resolver';
import { acquireModInstallLock } from './mod-install-lock';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  ModBasketRequest,
  ModBasketResult,
  ModBasketIssue,
  ModBasketProgress,
} from '../../shared/mods/mod-basket';
import type { LocalModInspection } from '../../shared/mods/mod-contract';
import type { ModrinthClient, ModrinthVersion } from './modrinth-client';
import { VerifiedDownloader } from './verified-download';
import { inspectLocalMod, createCompatibilityReport } from './local-mod-compatibility';

class BasketFailure extends Error {
  constructor(readonly issue: ModBasketIssue) {
    super(issue.kind);
  }
}
function failure(kind: ModBasketIssue['kind'], project: string, detail = ''): never {
  throw new BasketFailure({ kind, project, detail });
}
async function digest(file: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) {
    const data: unknown = chunk;
    assert(Buffer.isBuffer(data));
    hash.update(data);
  }
  return hash.digest('hex');
}
async function inspect(file: string, loader?: string): Promise<LocalModInspection> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    return failure('metadata', basename(file));
  }
  return inspectLocalMod(
    file,
    {
      filename: basename(file),
      enabled: true,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    },
    loader,
  );
}
async function safeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw Error('Invalid mod destination');
  }
}

/** A single graph and a staged commit prevent root-by-root partial installations. */
export class ModBasketInstaller {
  constructor(
    private readonly client: ModrinthClient,
    private readonly root: string,
    private readonly loaderVersion?: string,
    private readonly loaderRoot?: string,
    private readonly platformMetadata?: readonly LocalModInspection[],
  ) {}
  private rootSources = new Map<string, string[]>();
  async resolve(
    request: ModBasketRequest,
    signal?: AbortSignal,
    validate?: (versions: readonly ModrinthVersion[]) => ModBasketIssue | undefined,
  ): Promise<readonly ModrinthVersion[]> {
    const result = await resolveModBasket(this.client, request, signal, validate);
    this.rootSources = result.roots;
    return result.versions;
  }
  async install(
    request: ModBasketRequest,
    signal?: AbortSignal,
    progress?: (value: ModBasketProgress) => void,
    beforeCommit?: () => Promise<void>,
  ): Promise<ModBasketResult> {
    signal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(600000)])
      : AbortSignal.timeout(600000);
    const directory = join(this.root, 'mods');
    const release = acquireModInstallLock(this.root);
    if (!release) {
      return { installed: [], issues: [{ kind: 'destination', project: '', detail: '' }] };
    }
    const learned = new Map<string, LocalModInspection>(),
      staged = new Map<string, string>();
    let staging = '';
    const remediation = new Map<string, readonly string[]>();
    try {
      progress?.({ phase: 'checking', current: 0, total: request.projectIds.length });
      staging = await mkdtemp(join(this.root, '.battly-mod-basket-'));
      const platform =
        this.platformMetadata ??
        (request.loader === 'fabric'
          ? [
              await fabricLoaderMetadata(
                this.loaderRoot ?? this.root,
                staging,
                this.loaderVersion,
                signal,
              ),
            ]
          : []);
      const effectiveLoaderVersion = platform[0]?.version ?? this.loaderVersion;
      for (let attempt = 0; attempt < 20; attempt++) {
        progress?.({ phase: 'checking', current: 0, total: request.projectIds.length });
        const versions = await this.resolve(request, signal, (candidates) => {
          const known = candidates.flatMap((v) => (learned.has(v.id) ? [learned.get(v.id)!] : []));
          const issue = createCompatibilityReport([...platform, ...known], {
            gameVersion: request.gameVersion,
            loader: request.loader as 'fabric' | 'forge' | 'neoforge' | 'quilt',
            loaderVersion: effectiveLoaderVersion ?? undefined,
          }).issues.find(
            (i) =>
              i.severity === 'error' &&
              [
                'dependency-version',
                'conflict',
                'game-version-mismatch',
                'loader-mismatch',
              ].includes(i.kind),
          );
          if (!issue) {
            return undefined;
          }
          const owner = candidates.find((v) => learned.get(v.id)?.filename === issue.filename);
          return {
            kind: 'dependency',
            project: owner?.projectId ?? issue.modName,
            detail: issue.expected ?? issue.detected ?? '',
          };
        });
        for (const v of versions) {
          for (const alias of [v.projectId, v.name, ...v.files.map((f) => f.filename)]) {
            remediation.set(alias, this.rootSources.get(v.projectId) ?? []);
          }
        }
        // Reject C0 control characters in downloaded filenames.
        const files = versions.map((version) => {
          const file =
            version.files.find((f) => f.primary && f.filename.endsWith('.jar')) ??
            version.files.find((f) => f.filename.endsWith('.jar'));
          if (
            !file ||
            file.filename !== basename(file.filename) ||
            // eslint-disable-next-line no-control-regex -- Los nombres descargados deben rechazar caracteres C0.
            /[<>:"/\\|?*\x00-\x1f]/.test(file.filename)
          ) {
            return failure('metadata', version.name);
          }
          return file;
        });
        if (new Set(files.map((file) => file.filename.toLowerCase())).size !== files.length) {
          failure('conflict', '', 'filename');
        }
        if (files.reduce((sum, file) => sum + file.size, 0) > 2 * 1024 * 1024 * 1024) {
          failure('metadata', '', 'size');
        }
        if (!staging) {
          staging = await mkdtemp(join(this.root, '.battly-mod-basket-'));
        }
        const downloader = new VerifiedDownloader({
          validateUrl: (url) => {
            if (
              url.protocol !== 'https:' ||
              url.hostname !== 'cdn.modrinth.com' ||
              url.username ||
              url.password
            ) {
              throw Error('Invalid mod download URL');
            }
          },
        });
        const downloaded: LocalModInspection[] = [];
        for (const [index, file] of files.entries()) {
          signal?.throwIfAborted();
          progress?.({
            phase: 'downloading',
            current: index,
            total: files.length,
            filename: file.filename,
          });
          if (staged.get(file.filename) !== versions[index].id) {
            await downloader.download(
              { url: file.url, expectedSize: file.size, expectedSha512: file.sha512 },
              join(staging, file.filename),
              signal,
            );
            staged.set(file.filename, versions[index].id);
          }
          const metadata = await inspect(join(staging, file.filename), request.loader);
          if (
            !metadata.readable ||
            !metadata.id ||
            metadata.loader === 'unknown' ||
            metadata.metadataWarnings?.length
          ) {
            failure('metadata', file.filename);
          }
          if (request.destinationServerId && metadata.environment === 'client') {
            failure('environment', metadata.name);
          }
          if (!request.destinationServerId && metadata.environment === 'server') {
            failure('environment', metadata.name);
          }
          learned.set(
            versions[index].id,
            request.destinationServerId ? { ...metadata, environment: '*' } : metadata,
          );
          remediation.set(metadata.name, this.rootSources.get(versions[index].projectId) ?? []);
          downloaded.push(
            request.destinationServerId ? { ...metadata, environment: '*' } : metadata,
          );
        }
        await safeDirectory(directory);
        const entries = await readdir(directory, { withFileTypes: true });
        if (entries.filter((e) => e.name.toLowerCase().endsWith('.jar')).length > 1000) {
          failure('metadata', '', 'inventory-limit');
        }
        const snapshots = new Map<string, string>();
        const existing: LocalModInspection[] = [];
        const replacements = new Set<string>();
        for (const entry of entries) {
          if (!entry.name.toLowerCase().endsWith('.jar')) {
            continue;
          }
          const file = join(directory, entry.name),
            metadata = await inspect(file, request.loader);
          snapshots.set(entry.name, await digest(file));
          const incoming = downloaded.find(
            (mod) => mod.filename.toLowerCase() === entry.name.toLowerCase(),
          );
          if (incoming && incoming.id !== metadata.id) {
            failure('conflict', entry.name, 'filename');
          }
          if (metadata.id && downloaded.some((mod) => mod.id === metadata.id)) {
            replacements.add(entry.name);
          } else {
            existing.push(
              request.destinationServerId
                ? {
                    ...metadata,
                    environment: metadata.environment === 'server' ? '*' : metadata.environment,
                  }
                : metadata,
            );
          }
        }
        const report = createCompatibilityReport([...platform, ...existing, ...downloaded], {
          gameVersion: request.gameVersion,
          loader: request.loader as 'fabric' | 'forge' | 'quilt' | 'neoforge',
          loaderVersion: this.loaderVersion,
        });
        const blocking = report.issues.find(
          (issue) =>
            issue.severity !== 'warning' ||
            issue.kind === 'unknown-metadata' ||
            (issue.kind === 'unverified' &&
              !/^(java|fabricloader|forge|neoforge|quilt_loader|fabric-loader) /.test(
                issue.expected ?? '',
              )),
        );
        if (
          blocking &&
          attempt < 19 &&
          ['dependency-version', 'conflict'].includes(blocking.kind) &&
          downloaded.some((m) => m.filename === blocking.filename)
        ) {
          continue;
        }
        if (blocking) {
          failure(
            blocking.kind === 'game-version-mismatch' || blocking.kind === 'loader-mismatch'
              ? 'version'
              : blocking.kind === 'missing-dependency' || blocking.kind === 'dependency-version'
                ? 'dependency'
                : 'conflict',
            blocking.modName,
            blocking.expected ?? blocking.detected ?? '',
          );
        }
        signal?.throwIfAborted();
        await beforeCommit?.();
        const current = (await readdir(directory)).filter((name) =>
          name.toLowerCase().endsWith('.jar'),
        );
        if (current.length !== snapshots.size) {
          failure('destination', '', 'changed');
        }
        for (const name of current) {
          if (snapshots.get(name) !== (await digest(join(directory, name)))) {
            failure('destination', name, 'changed');
          }
        }
        const backupRoot = join(this.root, '.replaced-mods');
        await safeDirectory(backupRoot);
        const backup = await mkdtemp(join(backupRoot, 'basket-'));
        const committed: string[] = [],
          replaced: string[] = [];
        try {
          for (const name of replacements) {
            await rename(join(directory, name), join(backup, name));
            replaced.push(name);
          }
          for (const [index, file] of files.entries()) {
            signal?.throwIfAborted();
            progress?.({
              phase: 'installing',
              current: index,
              total: files.length,
              filename: file.filename,
            });
            await rename(join(staging, file.filename), join(directory, file.filename));
            committed.push(file.filename);
          }
        } catch (error) {
          for (const name of committed.reverse()) {
            await rm(join(directory, name), { force: true });
          }
          for (const name of replaced.reverse()) {
            await rename(join(backup, name), join(directory, name));
          }
          throw error;
        }
        progress?.({ phase: 'installing', current: files.length, total: files.length });
        return { installed: files.map((file) => file.filename), issues: [] };
      }
      return {
        installed: [],
        issues: [{ kind: 'dependency', project: '', detail: 'limit', projectIds: [] }],
      };
    } catch (error) {
      if (error instanceof BasketResolutionFailure) {
        return { installed: [], issues: [error.issue] };
      }
      if (error instanceof BasketFailure) {
        return {
          installed: [],
          issues: [
            {
              ...error.issue,
              projectIds:
                remediation.get(error.issue.project) ??
                (request.projectIds.includes(error.issue.project) ? [error.issue.project] : []),
            },
          ],
        };
      }
      throw error;
    } finally {
      release();
      if (staging) {
        await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  }
}
