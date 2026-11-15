import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import type { InstanceContentEntry } from '../../shared/minecraft/instance-content';

export async function readPackMetadata(
  path: string,
  directory: boolean,
): Promise<Partial<InstanceContentEntry>> {
  try {
    if (!directory && (await lstat(path)).size > 512 * 1024 ** 2) {
      return {};
    }
    const zip = directory ? null : new AdmZip(path);
    async function read(name: string): Promise<Buffer | null> {
      if (zip) {
        const entry = zip.getEntry(name);
        return entry && entry.header.size <= 512 * 1024 ? zip.readFile(entry) : null;
      }
      const file = join(path, name);
      const info = await lstat(file).catch(() => null);
      return info?.isFile() && !info.isSymbolicLink() && info.size <= 512 * 1024
        ? readFile(file)
        : null;
    }
    const icon = await read('pack.png');
    const result: Partial<InstanceContentEntry> =
      icon?.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
        ? { iconDataUrl: `data:image/png;base64,${icon.toString('base64')}` }
        : {};
    return result;
  } catch {
    return {};
  }
}
