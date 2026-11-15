import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

async function validJar(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 4 || info.size > 16 * 1024 * 1024) {
      return false;
    }
    const handle = await open(path, 'r');
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
      return bytesRead === 4 && signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function readResponse(response: Response, maximum: number): Promise<Buffer> {
  if (!response.ok || !response.body) {
    throw new Error(`Injector download failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return Buffer.concat(chunks, length);
      }
      length += value.byteLength;
      if (length > maximum) {
        throw new Error('Injector response exceeds its size limit');
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function downloadInjector(
  resourceUrl: string,
  destination: string,
  cachedTarget: string,
  fetcher: typeof fetch,
): Promise<'cached' | 'downloaded'> {
  const manifestUrl = new URL(resourceUrl);
  if (manifestUrl.protocol !== 'https:' || manifestUrl.username || manifestUrl.password) {
    throw new Error('Invalid injector manifest URL');
  }
  const signal = AbortSignal.timeout(15_000);
  const manifest: unknown = JSON.parse(
    (
      await readResponse(await fetcher(manifestUrl, { signal, redirect: 'error' }), 4 * 1024 * 1024)
    ).toString('utf8'),
  );
  if (!Array.isArray(manifest)) {
    throw new Error('Invalid injector manifest');
  }
  const entry = (manifest as unknown[]).find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === 'object' &&
      Reflect.get(item, 'path') === 'authlib-injector.jar',
  );
  if (
    !entry ||
    typeof entry.url !== 'string' ||
    typeof entry.hash !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(entry.hash) ||
    typeof entry.size !== 'number' ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 4 ||
    entry.size > 16 * 1024 * 1024
  ) {
    throw new Error('No verified authlib-injector.jar in /files');
  }
  const url = new URL(entry.url);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Invalid injector download URL');
  }
  if (await validJar(cachedTarget)) {
    const bytes = await readFile(cachedTarget);
    if (
      bytes.length === entry.size &&
      createHash('sha1').update(bytes).digest('hex') === entry.hash.toLowerCase()
    ) {
      return 'cached';
    }
  }
  const bytes = await readResponse(await fetcher(url, { signal, redirect: 'error' }), entry.size);
  if (
    bytes.length !== entry.size ||
    createHash('sha1').update(bytes).digest('hex') !== entry.hash.toLowerCase()
  ) {
    throw new Error('Injector download integrity mismatch');
  }
  await writeFile(destination, bytes, { flag: 'wx' });
  if (!(await validJar(destination))) {
    throw new Error('Invalid injector archive');
  }
  return 'downloaded';
}

async function digest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function trustedCachedInjector(
  target: string,
  source: string,
  resourceUrl: string | null | undefined,
  receipt: string | null,
): Promise<boolean> {
  if (await validJar(target)) {
    const cachedHash = await digest(target);
    if ((await validJar(source)) && cachedHash === (await digest(source))) {
      return true;
    }
    if (receipt) {
      try {
        const saved = JSON.parse(await readFile(receipt, 'utf8')) as Record<string, unknown>;
        if (
          saved.compatibilityRevision === 2 &&
          saved.path === target &&
          saved.resourceUrl === resourceUrl &&
          saved.sha256 === cachedHash
        ) {
          return true;
        }
      } catch {
        /* Re-establish provenance from /files or the bundled agent. */
      }
    }
  }
  return false;
}

async function saveReceipt(
  target: string,
  resourceUrl: string | null | undefined,
  receipt: string | null,
): Promise<void> {
  if (!receipt) {
    return;
  }
  await mkdir(dirname(receipt), { recursive: true });
  const temporary = `${receipt}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        compatibilityRevision: 2,
        path: target,
        resourceUrl,
        sha256: await digest(target),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    await rename(temporary, receipt);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function refreshAuthlibInjector(
  root: string,
  source: string,
  resourceUrl: string | null | undefined,
  fetcher: typeof fetch,
  trustedReceiptRoot: string | undefined,
): Promise<string> {
  const target = join(root, 'authlib-injector.jar');
  // Imported instances cannot supply their own proof that an agent is trusted.
  const receipt = trustedReceiptRoot
    ? join(resolve(trustedReceiptRoot), `${createHash('sha256').update(target).digest('hex')}.json`)
    : null;
  await mkdir(dirname(target), { recursive: true });
  const staging = join(root, `.authlib-injector-${randomUUID()}.jar`);
  try {
    let downloadError: unknown;
    let result: 'cached' | 'downloaded' | undefined;
    if (resourceUrl) {
      try {
        result = await downloadInjector(resourceUrl, staging, target, fetcher);
      } catch (error) {
        downloadError = error;
        await rm(staging, { force: true });
      }
    }
    if (result === 'cached') {
      await saveReceipt(target, resourceUrl, receipt);
      return target;
    }
    if (result !== 'downloaded') {
      if (await trustedCachedInjector(target, source, resourceUrl, receipt)) {
        return target;
      }
      if (!(await validJar(source))) {
        throw new Error(
          'No se pudo obtener authlib-injector.jar desde /files y no hay una copia local válida',
          { cause: downloadError },
        );
      }
      await copyFile(source, staging);
    }
    if (!(await validJar(staging))) {
      throw new Error('No se pudo copiar authlib-injector.jar');
    }
    // Replace in one operation, leaving the previous file intact if replacement fails.
    await rename(staging, target);
    await saveReceipt(target, resourceUrl, receipt);
  } finally {
    await rm(staging, { force: true });
  }
  return target;
}

interface InjectorRefresh {
  source: string;
  resourceUrl: string | null | undefined;
  receiptRoot: string | undefined;
  fetcher: typeof fetch;
  promise: Promise<string>;
}

const refreshes = new Map<string, InjectorRefresh>();

export async function ensureAuthlibInjector(
  contentRoot: string,
  bundledJar: string,
  resourceUrl?: string | null,
  fetcher: typeof fetch = fetch,
  trustedReceiptRoot?: string,
): Promise<string> {
  if (!isAbsolute(contentRoot) || !isAbsolute(bundledJar)) {
    throw new TypeError('Authlib injector paths must be absolute');
  }
  const root = resolve(contentRoot),
    source = resolve(bundledJar);
  const receiptRoot = trustedReceiptRoot ? resolve(trustedReceiptRoot) : undefined;
  const active = refreshes.get(root);
  if (active) {
    if (
      active.source === source &&
      active.resourceUrl === resourceUrl &&
      active.receiptRoot === receiptRoot &&
      active.fetcher === fetcher
    ) {
      return active.promise;
    }
    await active.promise.catch(() => undefined);
    return ensureAuthlibInjector(root, source, resourceUrl, fetcher, receiptRoot);
  }
  const promise = refreshAuthlibInjector(root, source, resourceUrl, fetcher, receiptRoot);
  refreshes.set(root, { source, resourceUrl, receiptRoot, fetcher, promise });
  try {
    return await promise;
  } finally {
    if (refreshes.get(root)?.promise === promise) {
      refreshes.delete(root);
    }
  }
}
