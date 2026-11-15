import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';

/** Publish only complete archives; reject links instead of silently losing world data. */
export async function backupInstanceWorld(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  const targetInfo = await lstat(destination);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
    throw new Error('Carpeta de copias inválida');
  }
  const files: { path: string; name: string; directory: boolean }[] = [];
  let bytes = 0;
  async function walk(relative = ''): Promise<void> {
    const path = join(source, relative);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error('El mundo contiene enlaces o archivos especiales');
    }
    if (relative) {
      files.push({ path, name: relative.replaceAll('\\', '/'), directory: info.isDirectory() });
    }
    bytes += info.isFile() ? info.size : 0;
    if (files.length > 100_000 || bytes > 16 * 1024 ** 3) {
      throw new Error('El mundo supera el límite de copia (16 GB o 100.000 archivos)');
    }
    if (info.isDirectory()) {
      for (const name of await readdir(path)) {
        await walk(join(relative, name));
      }
    }
  }
  await walk();
  const final = join(
    destination,
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.zip`,
  );
  const temporary = `${final}.partial`;
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  zip.on('error', (error: Error) => output.destroy(error));
  const done = pipeline(output, createWriteStream(temporary, { flags: 'wx' }));
  void done.catch(() => undefined);
  try {
    for (const file of files) {
      if (file.directory) {
        zip.addEmptyDirectory(file.name);
      } else {
        zip.addFile(file.path, file.name, { compressionLevel: 9 });
      }
    }
    zip.end();
    await done;
    await rename(temporary, final);
  } catch (error) {
    output.destroy();
    await done.catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
