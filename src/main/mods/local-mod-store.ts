import { access, lstat, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  normalizeLocalModFilename,
  type LocalModCompatibilityFixResult,
  type LocalModCompatibilityReport,
  type LocalModSummary,
  type LocalModTarget,
} from '../../shared/mods/mod-contract';
import { matchesModRange } from '../../shared/mods/version-range';
import { createCompatibilityReport, inspectLocalMod } from './local-mod-compatibility';

function absoluteDirectory(value: string, label: string): string {
  if (!isAbsolute(value)) {
    throw new TypeError(`${label} must be absolute`);
  }
  return resolve(value);
}

function toggledFilename(filename: string): string {
  return filename.toLowerCase().endsWith('.disabledmod')
    ? `${filename.slice(0, -'.disabledmod'.length)}.jar`
    : `${filename.slice(0, -'.jar'.length)}.disabledmod`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function assertRegularMod(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError('Local mod must be a regular file');
  }
}

export class LocalModStore {
  readonly #archiveDirectory: string;
  readonly #modsDirectory: string;
  readonly #inspectionCache = new Map<
    string,
    { stamp: string; bytes: number; value: Awaited<ReturnType<typeof inspectLocalMod>> }
  >();

  constructor(modsDirectory: string, archiveDirectory: string) {
    this.#modsDirectory = absoluteDirectory(modsDirectory, 'Mods directory');
    this.#archiveDirectory = absoluteDirectory(archiveDirectory, 'Mods archive directory');
  }

  async list(): Promise<readonly LocalModSummary[]> {
    await mkdir(this.#modsDirectory, { recursive: true });
    const entries = await readdir(this.#modsDirectory, { withFileTypes: true });
    const files = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name.toLowerCase().endsWith('.jar') ||
            entry.name.toLowerCase().endsWith('.disabledmod')),
      )
      .slice(0, 1_000);
    return Promise.all(
      files
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const info = await stat(join(this.#modsDirectory, entry.name));
          return {
            filename: entry.name,
            enabled: entry.name.toLowerCase().endsWith('.jar'),
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
          };
        }),
    );
  }

  async toggle(rawFilename: unknown): Promise<readonly LocalModSummary[]> {
    await this.toggleOne(rawFilename);
    return this.list();
  }

  private async toggleOne(rawFilename: unknown): Promise<void> {
    const filename = normalizeLocalModFilename(rawFilename);
    const destination = toggledFilename(filename);
    const destinationPath = join(this.#modsDirectory, destination);
    if (await exists(destinationPath)) {
      throw new Error(`Local mod destination already exists: ${destination}`);
    }
    const sourcePath = join(this.#modsDirectory, filename);
    await assertRegularMod(sourcePath);
    await rename(sourcePath, destinationPath);
  }

  async revealPath(rawFilename: unknown): Promise<string> {
    const filename = normalizeLocalModFilename(rawFilename);
    const path = join(this.#modsDirectory, filename);
    await assertRegularMod(path);
    return path;
  }

  async archive(rawFilename: unknown): Promise<readonly LocalModSummary[]> {
    await this.archiveOne(rawFilename);
    return this.list();
  }

  private async archiveOne(rawFilename: unknown): Promise<void> {
    const filename = normalizeLocalModFilename(rawFilename);
    const sourcePath = join(this.#modsDirectory, filename);
    await assertRegularMod(sourcePath);
    await mkdir(this.#archiveDirectory, { recursive: true });
    let destination = join(this.#archiveDirectory, filename);
    if (await exists(destination)) {
      destination = join(this.#archiveDirectory, `${Date.now()}-${filename}`);
    }
    await rename(sourcePath, destination);
  }

  async batch(action: unknown, rawFilenames: unknown): Promise<readonly string[]> {
    if (
      !['enable', 'disable', 'archive'].includes(String(action)) ||
      typeof action !== 'string' ||
      !Array.isArray(rawFilenames) ||
      rawFilenames.length > 1000
    ) {
      throw new TypeError('Invalid local mods batch');
    }
    const filenames = [...new Set(rawFilenames.map(normalizeLocalModFilename))];
    const failed: string[] = [];
    for (const filename of filenames) {
      try {
        if (action === 'archive') {
          await this.archiveOne(filename);
        } else if (filename.toLowerCase().endsWith('.jar') !== (action === 'enable')) {
          await this.toggleOne(filename);
        }
      } catch {
        failed.push(filename);
      }
    }
    return failed;
  }

  async compatibilityReport(): Promise<LocalModCompatibilityReport> {
    const summaries = await this.list();
    const live = new Set(summaries.map((summary) => summary.filename));
    for (const name of this.#inspectionCache.keys()) {
      if (!live.has(name)) {
        this.#inspectionCache.delete(name);
      }
    }
    const mods: Awaited<ReturnType<typeof inspectLocalMod>>[] = [];
    let cacheBytes = [...this.#inspectionCache.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    for (const summary of summaries) {
      const path = join(this.#modsDirectory, summary.filename);
      const info = await stat(path);
      const stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      const cached = this.#inspectionCache.get(summary.filename);
      const value = cached?.stamp === stamp ? cached.value : await inspectLocalMod(path, summary);
      if (!cached || cached.stamp !== stamp) {
        if (cached) {
          cacheBytes -= cached.bytes;
          this.#inspectionCache.delete(summary.filename);
        }
        const bytes = JSON.stringify(value).length * 2;
        cacheBytes += bytes;
        while (cacheBytes > 24 * 1024 * 1024 && this.#inspectionCache.size) {
          const key = this.#inspectionCache.keys().next().value!;
          cacheBytes -= this.#inspectionCache.get(key)!.bytes;
          this.#inspectionCache.delete(key);
        }
        if (bytes <= 24 * 1024 * 1024) {
          this.#inspectionCache.set(summary.filename, { stamp, bytes, value });
        }
      }
      mods.push(value);
      if (mods.length % 8 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return createCompatibilityReport(mods);
  }

  async repair(
    raw: unknown,
    installDependency?: (id: string, target: LocalModTarget) => Promise<readonly string[]>,
  ): Promise<LocalModCompatibilityFixResult> {
    if (!raw || typeof raw !== 'object') {
      throw new TypeError('Selecciona Minecraft y loader');
    }
    const source = raw as Record<string, unknown>;
    if (
      typeof source.gameVersion !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(source.gameVersion) ||
      !['fabric', 'forge', 'neoforge', 'quilt'].includes(String(source.loader))
    ) {
      throw new TypeError('Selecciona Minecraft y loader válidos');
    }
    const target: LocalModTarget = {
      gameVersion: source.gameVersion,
      loader: source.loader as LocalModTarget['loader'],
      ...(typeof source.loaderVersion === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/.test(source.loaderVersion)
        ? { loaderVersion: source.loaderVersion }
        : {}),
      ...(typeof source.javaVersion === 'string' && /^\d+(?:\.\d+)*$/.test(source.javaVersion)
        ? { javaVersion: source.javaVersion }
        : {}),
    };
    const initial = createCompatibilityReport((await this.compatibilityReport()).mods, target);
    const disabled: string[] = [],
      enabled: string[] = [];
    const candidates = new Set(
      initial.issues
        .filter((issue) =>
          ['unreadable', 'game-version-mismatch', 'loader-mismatch', 'conflict'].includes(
            issue.kind,
          ),
        )
        .map((issue) => issue.filename),
    );
    // Duplicate copies require an explicit file choice in the compatibility report.
    for (const name of candidates) {
      const failed = await this.batch('disable', [name]);
      if (!failed.length) {
        disabled.push(name);
      }
    }
    // Reactivate only a dependency whose metadata matches both the chosen target and every required range.
    const current = createCompatibilityReport((await this.compatibilityReport()).mods, target);
    for (const issue of current.issues.filter((issue) => issue.kind === 'disabled-dependency')) {
      const mod = current.mods.find((mod) => mod.filename === issue.detected);
      if (!mod || enabled.includes(mod.filename) || !mod.readable || !mod.id || !mod.version) {
        continue;
      }
      const ownReport = createCompatibilityReport([{ ...mod, enabled: true }], target);
      if (
        ownReport.issues.some((issue) =>
          ['game-version-mismatch', 'loader-mismatch', 'unreadable', 'dependency-version'].includes(
            issue.kind,
          ),
        )
      ) {
        continue;
      }
      const required = current.mods
        .filter((mod) => mod.enabled)
        .flatMap((mod) => mod.requirements ?? [])
        .filter((req) => req.id === mod.id && req.kind === 'required');
      if (!required.every((req) => matchesModRange(mod.version, req.ranges) === true)) {
        continue;
      }
      const failed = await this.batch('enable', [mod.filename]);
      if (!failed.length) {
        enabled.push(mod.filename);
      }
    }
    const installed: string[] = [],
      attempted = new Set<string>();
    if (installDependency) {
      for (let pass = 0; pass < 3; pass++) {
        const report = createCompatibilityReport((await this.compatibilityReport()).mods, target);
        let changed = false;
        for (const issue of report.issues.filter((issue) => issue.kind === 'missing-dependency')) {
          const id = issue.expected?.split(' ')[0];
          if (!id || attempted.has(id)) {
            continue;
          }
          attempted.add(id);
          try {
            const files = await installDependency(id, target);
            installed.push(...files);
            changed ||= files.length > 0;
          } catch {
            /* Keep unresolved dependencies in the final report. */
          }
        }
        if (!changed) {
          break;
        }
      }
    }
    return {
      disabled,
      enabled,
      installed,
      report: createCompatibilityReport((await this.compatibilityReport()).mods, target),
    };
  }

  async disableIncompatible(): Promise<LocalModCompatibilityFixResult> {
    const report = await this.compatibilityReport();
    const candidates = new Set(
      report.issues
        .filter((entry) => entry.kind === 'unreadable')
        .map((entry) => entry.filename)
        .filter((filename) => filename.toLowerCase().endsWith('.jar')),
    );
    const disabled: string[] = [];
    for (const filename of candidates) {
      try {
        await this.toggle(filename);
        disabled.push(filename);
      } catch {
        // A collision keeps the original mod untouched and visible in the next report.
      }
    }
    return { disabled, report: await this.compatibilityReport() };
  }
}
