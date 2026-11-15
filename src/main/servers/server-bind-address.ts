import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

/** Old Battly versions stored the public tunnel hostname as a local bind address. */
export async function repairLegacyServerBind(directory: string): Promise<boolean> {
  const file = join(directory, 'server.properties');
  let original: string;
  try {
    original = (await readBoundedRegularFile(file, 1024 * 1024)).toString('utf8');
  } catch (error) {
    // Minecraft crea este archivo al arrancar un servidor por primera vez.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  const repaired = original.replace(
    /^(\s*server-ip\s*[=:]\s*)([^\r\n]*)/gm,
    (line, prefix: string, address: string) =>
      /^(?:[a-z0-9-]+\.)+(?:battly\.(?:org|eu)|battlyservers\.net)\.?$/i.test(address.trim())
        ? prefix + '127.0.0.1'
        : line,
  );
  if (repaired === original) {
    return false;
  }
  try {
    await writeFile(join(directory, 'server.properties.before-battly-bind-fix'), original, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  await writeFileAtomically(file, repaired);
  return true;
}
