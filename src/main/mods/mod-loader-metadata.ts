import { readBoundedResponse, readBoundedResponseBytes } from '../network/read-bounded-response';
import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalModInspection } from '../../shared/mods/mod-contract';
import { inspectLocalMod } from './local-mod-compatibility';

/** Use the loader's real bundled libraries, rather than inventing MixinExtras providers. */
export async function fabricLoaderMetadata(
  root: string,
  staging: string,
  requestedVersion: string | undefined,
  signal?: AbortSignal,
): Promise<LocalModInspection> {
  let version = requestedVersion;
  if (!version || version === 'latest') {
    const response = await fetch('https://meta.fabricmc.net/v2/versions/loader', { signal });
    if (!response.ok) {
      throw new Error('No se pudo verificar el archivo');
    }
    const values = JSON.parse(
      await readBoundedResponse(response, 2 * 1024 * 1024, 'Fabric metadata is too large'),
    ) as { version: string; stable: boolean }[];
    version = values.find((v) => v.stable)?.version;
  }
  if (!version || !/^[\d]+(?:\.[\d]+)*(?:-[\w.-]+)?$/.test(version)) {
    throw new Error('No se pudo verificar el archivo');
  }
  const filename = `fabric-loader-${version}.jar`;
  let file = join(root, 'libraries', 'net', 'fabricmc', 'fabric-loader', version, filename);
  let info = await lstat(file).catch(() => undefined);
  if (!info) {
    const url = `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${version}/${filename}`;
    const [response, checksum] = await Promise.all([
      fetch(url, { signal }),
      fetch(`${url}.sha512`, { signal }),
    ]);
    if (!response.ok || !checksum.ok) {
      throw new Error('No se pudo verificar el archivo');
    }
    const bytes = await readBoundedResponseBytes(
      response,
      8 * 1024 * 1024,
      'No se pudo verificar el archivo',
    );
    const sha512 = (await readBoundedResponse(checksum, 4096, 'No se pudo verificar el archivo'))
      .trim()
      .split(/\s/)[0]
      .toLowerCase();
    if (
      bytes.length > 8 * 1024 * 1024 ||
      !/^[a-f0-9]{128}$/.test(sha512) ||
      createHash('sha512').update(bytes).digest('hex') !== sha512
    ) {
      throw new Error('No se pudo verificar el archivo');
    }
    file = join(staging, filename);
    await writeFile(file, bytes);
    info = await lstat(file);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) {
    throw new Error('No se pudo verificar el archivo');
  }
  // Ensure this is the selected loader, not an arbitrary same-named local file.
  const inspection = await inspectLocalMod(
    file,
    { filename, enabled: true, size: info.size, modifiedAt: info.mtime.toISOString() },
    'fabric',
  );
  if (
    !inspection.readable ||
    inspection.id !== 'fabricloader' ||
    inspection.version !== version ||
    inspection.metadataWarnings?.length
  ) {
    throw new Error('No se pudo verificar el archivo');
  }
  return inspection;
}
