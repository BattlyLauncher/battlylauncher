import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import AdmZip from 'adm-zip';

const batModId = 'BatMod';
const brokenBatModSha1 = 'cf97d81e8a32f2879753b76c751c61bff37f15ed';
const originalClassHash = '3f87951b95067d03ea03c790b740f452cbfff03a85ea23877c11bc9f18b1a710';
const repairedClassHash = 'd20c7d91190cc0a9540a0d9322fae1c72e3e36a87d2627e76c6ac3ccd9000577';
const batModMinecraftClass =
  'AKnHvCEvff0plRZMvivJHI1Y16hUOHf1ple94i52Q2QOBbkkTa9CdhlfxOJQmuqBGcGc4Btt3nXUKX1ypstf7VYEhFEpOcflQPhB.class';
const brokenStartupCall = Buffer.from('2ab40241c0013ab603e204b905a70200', 'hex');
const oldRepairContext = Buffer.concat([
  Buffer.alloc(brokenStartupCall.length),
  Buffer.from('b8042c', 'hex'),
]);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

export function patchBrokenBatModStartupClass(source: Buffer): Buffer {
  let original = source;
  if (sha256(original) !== originalClassHash) {
    const offset = source.indexOf(oldRepairContext);
    if (offset < 0 || source.indexOf(oldRepairContext, offset + 1) >= 0) {
      throw new Error('Unexpected BatMod startup bytecode');
    }
    original = Buffer.from(source);
    brokenStartupCall.copy(original, offset);
    if (sha256(original) !== originalClassHash) {
      throw new Error('Unexpected BatMod startup bytecode');
    }
  }
  const repaired = readFileSync(join(__dirname, 'compatibility', 'batmod-startup.class'));
  if (sha256(repaired) !== repairedClassHash) {
    throw new Error('Invalid BatMod compatibility resource');
  }
  return repaired;
}

export type CustomClientCompatibilityResult =
  | { readonly status: 'not-applicable' }
  | { readonly status: 'already-repaired'; readonly backupPath: string }
  | { readonly status: 'repaired'; readonly backupPath: string };

export async function repairKnownCustomClient(
  root: string,
  customId: string,
): Promise<CustomClientCompatibilityResult> {
  if (customId !== batModId) {
    return { status: 'not-applicable' };
  }
  const jarPath = join(root, 'versions', customId, `${customId}.jar`);
  const backupPath = join(dirname(jarPath), `${customId}.battly-original.jar`);
  const archiveBytes = await readFile(jarPath),
    archive = new AdmZip(archiveBytes);
  const classEntry = archive.getEntry(batModMinecraftClass);
  if (!classEntry) {
    return { status: 'not-applicable' };
  }
  const classBytes = classEntry.getData();
  if (sha256(classBytes) === repairedClassHash) {
    return { status: 'already-repaired', backupPath };
  }
  // Accept only the original known release or our exact old startup-only patch.
  const originalArchive =
    createHash('sha1').update(archiveBytes).digest('hex') === brokenBatModSha1;
  if (!originalArchive && !classBytes.includes(oldRepairContext)) {
    return { status: 'not-applicable' };
  }
  const repaired = patchBrokenBatModStartupClass(classBytes);
  archive.updateFile(batModMinecraftClass, repaired);
  await copyFile(jarPath, backupPath, constants.COPYFILE_EXCL).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    },
  );
  const temporaryPath = `${jarPath}.battly-repairing`;
  await writeFile(temporaryPath, archive.toBuffer());
  await rename(temporaryPath, jarPath);
  return { status: 'repaired', backupPath };
}
