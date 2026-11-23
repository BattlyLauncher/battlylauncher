import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';
import * as yazl from 'yazl';
import { bypackLimits, bypackPath, type BypackManifest } from '../../shared/minecraft/bypack';

export async function copyHashed(
  source: Readable,
  destination: string,
  size: number,
): Promise<{ sha512: string; sha1: string }> {
  const sha512 = createHash('sha512');
  const sha1 = createHash('sha1');
  let bytes = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      bytes += chunk.length;
      if (bytes > size) {
        callback(new Error('El archivo supera su tamaño declarado'));
        return;
      }
      sha512.update(chunk);
      sha1.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, verifier, createWriteStream(destination, { flags: 'wx' }));
  if (bytes !== size) {
    throw new Error('El archivo está incompleto o ha cambiado durante la exportación');
  }
  return { sha512: sha512.digest('hex'), sha1: sha1.digest('hex') };
}

export async function writeBypackZip(
  path: string,
  manifest: BypackManifest,
  filePath: (path: string) => string,
): Promise<void> {
  return writePackZip(
    path,
    'bypack.json',
    manifest,
    manifest.files.filter((file) => !file.remote).map((file) => file.path),
    filePath,
  );
}

export async function writePackZip(
  path: string,
  manifestName: string,
  manifest: object,
  embeddedPaths: readonly string[],
  filePath: (path: string) => string,
): Promise<void> {
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > bypackLimits.manifestBytes) {
    throw new Error('Manifiesto demasiado grande');
  }
  const zip = new yazl.ZipFile();
  const output = zip.outputStream as Readable;
  zip.on('error', (error: Error) => output.destroy(error));
  const done = pipeline(output, createWriteStream(path, { flags: 'wx' }));
  // Install the rejection handler before scheduling compression.
  void done.catch(() => undefined);
  zip.addBuffer(json, manifestName, { compressionLevel: 9 });
  for (const file of embeddedPaths) {
    zip.addFile(filePath(file), `overrides/${file}`, { compressionLevel: 9 });
  }
  zip.end();
  await done;
}

export async function openBypackZip(
  path: string,
): Promise<{ zip: yauzl.ZipFile; entries: ReadonlyMap<string, yauzl.Entry> }> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > bypackLimits.totalBytes) {
    throw new Error('Archivo .bypack inválido o demasiado grande');
  }
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (error, value) =>
        error || !value ? reject(error ?? new Error('ZIP inválido')) : resolve(value),
    );
  });
  try {
    if (zip.entryCount > bypackLimits.entries + 1) {
      throw new Error('Demasiadas entradas ZIP');
    }
    const entries = new Map<string, yauzl.Entry>();
    const names = new Set<string>();
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          const directory = entry.fileName.endsWith('/');
          const name = bypackPath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          const key = name.normalize('NFC').toLowerCase();
          const type = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (
            names.has(key) ||
            entry.isEncrypted() ||
            (type !== 0 && type !== (directory ? 0o040000 : 0o100000))
          ) {
            throw new Error('ZIP con enlaces, entradas duplicadas o archivos especiales');
          }
          names.add(key);
          if (name !== 'bypack.json' && !name.startsWith('overrides/')) {
            throw new Error('Entrada ZIP ajena al formato .bypack');
          }
          if (
            entry.uncompressedSize >
            (name === 'bypack.json' ? bypackLimits.manifestBytes : bypackLimits.fileBytes)
          ) {
            throw new Error('Archivo ZIP demasiado grande');
          }
          bytes += entry.uncompressedSize;
          if (bytes > bypackLimits.totalBytes + bypackLimits.manifestBytes) {
            throw new Error('ZIP descomprimido demasiado grande');
          }
          if (directory) {
            throw new Error('El .bypack debe declarar las carpetas en su manifiesto');
          }
          entries.set(name, entry);
          zip.readEntry();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('ZIP inválido', { cause: error }));
        }
      });
      zip.once('end', resolve);
      zip.readEntry();
    });
    return { zip, entries };
  } catch (error) {
    zip.close();
    throw error;
  }
}

export function zipEntryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error || !stream ? reject(error ?? new Error('Entrada ZIP inválida')) : resolve(stream),
    ),
  );
}

export async function zipManifest(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of await zipEntryStream(zip, entry)) {
    const bytes = chunk as Buffer;
    length += bytes.length;
    if (length > bypackLimits.manifestBytes) {
      throw new Error('Manifiesto demasiado grande');
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export { createReadStream };
