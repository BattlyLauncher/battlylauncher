import { join, isAbsolute, resolve } from 'node:path';
import { mkdir, lstat } from 'node:fs/promises';
import {
  knownLegacyRootKeys,
  parseLegacyStorageDocument,
  type JsonValue,
} from '../../shared/storage/legacy-storage';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { RendererPreferences } from './renderer-preferences';
import type { LegacyBrowserData } from './legacy-browser-storage';

type Values = Record<string, JsonValue>;
const marker = 'legacy-3.0.1-migration-v1';
const limit = 64 * 1024 * 1024;
function object(value: JsonValue | undefined): Values {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function read(path: string): Promise<Values> {
  if (!(await pathExists(path))) {
    return {};
  }
  return {
    ...parseLegacyStorageDocument(
      JSON.parse((await readBoundedRegularFile(path, limit)).toString('utf8')),
    ).values,
  };
}
function parseText(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

/** Convert 3.0.1 representations without discarding unrecognized data. Target wins. */
export function plan301Migration(
  source: Values,
  browser: LegacyBrowserData,
  target: Values,
): Values {
  const imported: Values = {};
  const profileKeys = new Set<string>([
    ...knownLegacyRootKeys,
    'battly_favorite_friends',
    'battly-policies-version',
  ]);
  for (const [key, value] of Object.entries(browser.localStorage)) {
    // Old caches/logs and obsolete secrets remain in the encrypted archive, not in
    // the frequently-read profile or the renderer preference endpoint.
    if (profileKeys.has(key)) {
      imported[key] = parseText(value);
    }
  }
  Object.assign(imported, source);
  const stores = { ...object(imported.dbStores) };
  for (const [name, rows] of Object.entries(browser.databases.database ?? {})) {
    const records: Values = Object.create(null) as Values;
    for (const row of rows) {
      const record = object(row);
      if (
        (typeof record.key === 'string' || typeof record.key === 'number') &&
        Object.hasOwn(record, 'value')
      ) {
        records[String(record.key)] = record;
      }
    }
    stores[name] = { ...records, ...object(stores[name]) };
  }
  // 3.0.1 also kept a JSON copy of launcher options; prefer IndexedDB if present.
  for (const name of ['launcher', 'ram', 'screen', 'java-args']) {
    if (!Object.keys(object(stores[name])).length && Object.keys(object(imported[name])).length) {
      stores[name] = { '1509442': { key: 1509442, value: imported[name]! } };
    }
  }
  imported.dbStores = stores;
  if (!Array.isArray(imported.accounts) || !imported.accounts.length) {
    const accounts = Object.values(object(stores.accounts))
      .map((row) => object(row).value)
      .filter(
        (row): row is Values =>
          !!row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          typeof row.uuid === 'string' &&
          typeof row.name === 'string',
      );
    if (accounts.length) {
      imported.accounts = accounts;
    }
  }
  if (!Object.hasOwn(imported, 'selected-account')) {
    const selected = object(Object.values(object(stores['accounts-selected']))[0]).value;
    const selectedId = object(selected).selected ?? object(selected)['account-selected'];
    if (typeof selectedId === 'string') {
      imported['selected-account'] = selectedId;
    }
  }
  if (!Object.hasOwn(imported, 'lang') && typeof imported.language === 'string') {
    imported.lang = imported.language;
  }
  if (
    (Array.isArray(imported.accounts) && imported.accounts.length) ||
    imported.baseTutorialCompleted === true
  ) {
    imported.welcome_shown = true;
  }
  return {
    // A root option and its legacy store may refer to the same in-memory object.
    // Serialize the planned JSON before validating, as it will be stored on disk.
    ...parseLegacyStorageDocument(
      JSON.parse(
        JSON.stringify({
          ...imported,
          ...target,
          dbStores: { ...stores, ...object(target.dbStores) },
        }),
      ),
    ).values,
  };
}

export function legacyRendererPreferences(values: Values): Record<string, string> {
  const prefs: Record<string, string> = {};
  // Never expose old social/API tokens to the renderer preference API.
  for (const key of [
    'battly_favorite_friends',
    'modsTutorialCompleted',
    'friendsTutorialCompleted',
    'mybattlyTutorialCompleted',
  ]) {
    if (Object.hasOwn(values, key)) {
      prefs[key] = typeof values[key] === 'string' ? values[key] : JSON.stringify(values[key]);
    }
  }
  const oldVolume = values.musicVolume ?? values.volume;
  const volume = Number(oldVolume) * (values.musicVolume === undefined ? 100 : 1);
  if (oldVolume !== undefined && Number.isFinite(volume)) {
    // 3.0.1 persisted the slider's 0..100 value, not Audio.volume's fraction.
    prefs['battly.music.audio-settings.v1'] = JSON.stringify({
      volume: Math.min(100, Math.max(0, volume)),
    });
  }
  return prefs;
}

export interface Legacy301Options {
  sourcePath: string;
  targetPath: string;
  userData: string;
  legacyContentRoot: string;
  readBrowser: () => Promise<LegacyBrowserData>;
}

export async function migrate301Profile(options: Legacy301Options): Promise<void> {
  const target = await read(options.targetPath);
  if (target[marker] === true) {
    return;
  }
  const source =
    resolve(options.sourcePath) === resolve(options.targetPath)
      ? target
      : await read(options.sourcePath);
  const browser = await options.readBrowser();
  const values = plan301Migration(source, browser, target);
  const backup = join(options.userData, 'migration-backups', 'legacy-3.0.1-v1.json');
  await mkdir(join(options.userData, 'migration-backups'), { recursive: true });
  if (!(await pathExists(backup))) {
    await writeFileAtomically(
      backup,
      JSON.stringify({
        source,
        target,
        browser,
        targetExisted: await pathExists(options.targetPath),
      }),
    );
    // Read back and authenticate before changing the active profile.
    await read(backup);
  }
  // Game data stays in its original tree, including worlds, instances and installed Java.
  const rootConfig = join(options.userData, 'data-root.json');
  let contentRoot = options.legacyContentRoot;
  if (typeof values.dataDirectory === 'string' && isAbsolute(values.dataDirectory)) {
    contentRoot = join(values.dataDirectory, '.battly');
  }
  if (await pathExists(rootConfig)) {
    const config = await read(rootConfig);
    if (typeof config.path === 'string' && isAbsolute(config.path)) {
      contentRoot = config.path;
    }
  } else if (await pathExists(contentRoot)) {
    const info = await lstat(contentRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Invalid legacy game directory');
    }
    await writeFileAtomically(rootConfig, JSON.stringify({ path: resolve(contentRoot) }));
  }
  if (!Object.hasOwn(values, 'googleTokens')) {
    for (const file of [
      join(contentRoot, 'battly', 'launcher', 'tokens.json'),
      join(contentRoot, 'localStorage', 'googleTokens.json'),
    ]) {
      if (await pathExists(file)) {
        values.googleTokens = await read(file);
        break;
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(values)) > 16 * 1024 * 1024) {
    throw new Error('Migrated profile exceeds supported size; original data preserved');
  }
  await writeFileAtomically(options.targetPath, JSON.stringify(values));
  const preferences = new RendererPreferences(join(options.userData, 'renderer-preferences.json'));
  await preferences.migrate(legacyRendererPreferences(values));
  await writeFileAtomically(options.targetPath, JSON.stringify({ ...values, [marker]: true }));
}
