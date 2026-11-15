import { BrowserWindow, session } from 'electron';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathExists } from '../files/atomic-file';
import { parseLegacyStorageDocument, type JsonValue } from '../../shared/storage/legacy-storage';

export interface LegacyBrowserData {
  localStorage: Record<string, string>;
  databases: Record<string, Record<string, JsonValue[]>>;
}

async function removeScratch(scratch: string): Promise<void> {
  try {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    // Chromium keeps its empty DIPS/session files open until process exit on Windows.
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw error;
    }
  }
}

// Runs only on our empty file:// document, never on the old application's code.
const readBrowserData = `async () => {
  const local = Object.create(null);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    local[key] = localStorage.getItem(key);
  }
  const databases = Object.create(null);
  for (const info of await indexedDB.databases()) {
    if (!info.name) continue;
    const db = await new Promise((yes, no) => {
      const request = indexedDB.open(info.name);
      request.onerror = () => no(new Error('Cannot open legacy database'));
      request.onblocked = () => no(new Error('Legacy database is locked'));
      request.onsuccess = () => yes(request.result);
    });
    try {
      const stores = Object.create(null);
      for (const name of db.objectStoreNames) {
        stores[name] = await new Promise((yes, no) => {
          const rows = [];
          const tx = db.transaction(name, 'readonly');
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              if (rows.length >= 100000) { tx.abort(); return; }
              rows.push(cursor.value);
              cursor.continue();
            }
          };
          tx.oncomplete = () => yes(rows);
          tx.onerror = tx.onabort = () => no(new Error('Cannot read legacy store'));
        });
      }
      databases[info.name] = stores;
    } finally { db.close(); }
  }
  return { localStorage: local, databases };
}`;

/** Chromium reads a disposable copy. The original 3.0.1 profile stays untouched. */
export async function readLegacyBrowserStorage(
  source: string,
  workRoot: string,
): Promise<LegacyBrowserData> {
  const empty: LegacyBrowserData = { localStorage: {}, databases: {} };
  const names = ['Local Storage', 'IndexedDB'];
  if (!(await Promise.all(names.map((name) => pathExists(join(source, name))))).some(Boolean)) {
    return empty;
  }
  await mkdir(workRoot, { recursive: true });
  const scratch = await mkdtemp(join(resolve(workRoot), 'browser-'));
  const fingerprints = new Map<string, { size: number; mtimeMs: number }>();
  let count = 0;
  let bytes = 0;
  const copy = async (from: string, to: string, depth = 0): Promise<void> => {
    const before = await lstat(from);
    if (before.isSymbolicLink() || depth > 12) {
      throw new Error('Unsafe legacy browser storage');
    }
    if (before.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 });
      for (const entry of await readdir(from)) {
        if (entry === 'LOCK') {
          continue;
        } // Chromium creates its own lock in the copy.
        await copy(join(from, entry), join(to, entry), depth + 1);
      }
    } else if (before.isFile()) {
      bytes += before.size;
      if (++count > 20000 || bytes > 512 * 1024 * 1024) {
        throw new Error('Legacy browser storage exceeds migration limits');
      }
      await copyFile(from, to);
      fingerprints.set(from, { size: before.size, mtimeMs: before.mtimeMs });
      const after = await lstat(from);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error('Close Battly 3.0.1 before migrating its data');
      }
    } else {
      throw new Error('Unsupported legacy browser storage entry');
    }
  };
  let window: BrowserWindow | undefined;
  let browserSession: Electron.Session | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    for (const name of names) {
      if (await pathExists(join(source, name))) {
        await copy(join(source, name), join(scratch, name));
      }
    }
    for (const [file, before] of fingerprints) {
      const after = await lstat(file);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new Error('Close Battly 3.0.1 before migrating its data');
      }
    }
    const page = join(scratch, 'reader.html');
    await writeFile(
      page,
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">',
      { mode: 0o600 },
    );
    browserSession = session.fromPath(scratch, { cache: false });
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    browserSession.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== pathToFileURL(page).href }),
    );
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: browserSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const read = async (): Promise<unknown> => {
      await window!.loadFile(page);
      return window!.webContents.executeJavaScript(`(${readBrowserData})()`);
    };
    const data = await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Legacy browser migration timed out; original data preserved')),
          30000,
        );
      }),
    ]);
    const checked = parseLegacyStorageDocument(data).values;
    if (Buffer.byteLength(JSON.stringify(checked)) > 32 * 1024 * 1024) {
      throw new Error('Legacy browser values exceed migration limits');
    }
    return checked as unknown as LegacyBrowserData;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    await browserSession?.clearStorageData();
    // This path is generated by mkdtemp inside workRoot, never supplied by the profile.
    // clearStorageData must succeed; failure to erase secrets is never ignored.
    await removeScratch(scratch);
  }
}
