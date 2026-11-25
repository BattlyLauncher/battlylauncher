import { createHash } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import type { InstalledPatchNotes } from '../../shared/updates';
import { readBoundedRegularFile } from '../files/atomic-file';
import { networkAvailable } from '../network/connectivity';
import { readBoundedResponseBytes } from '../network/read-bounded-response';
import { PATCH_CDN } from './patch-cdn-transport';

const maxManifestSize = 2_100_000;

/** The bootstrap has already verified the signed slot before loading this entry point. */
export async function readInstalledPatchNotes(
  root: string,
  baseVersion: string,
  build: number,
  fetcher = fetch,
): Promise<InstalledPatchNotes | undefined> {
  const slot = basename(root);
  if (basename(dirname(root)) !== 'builds' || !/^\d+-[a-f0-9]{64}$/.test(slot)) {
    return undefined;
  }
  const parse = (file: Buffer): InstalledPatchNotes | undefined => {
    const envelope = JSON.parse(file.toString('utf8')) as { payload?: unknown };
    if (typeof envelope.payload !== 'string') {
      return undefined;
    }
    const payload = Buffer.from(envelope.payload, 'base64');
    if (slot !== `${build}-${createHash('sha256').update(payload).digest('hex')}`) {
      return undefined;
    }
    const patch = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
    if (
      patch.build !== build ||
      (patch.channel !== 'stable' && patch.channel !== 'beta') ||
      typeof patch.notes !== 'string'
    ) {
      return undefined;
    }
    return {
      key: `${baseVersion}.${patch.channel}.${build}`,
      version:
        typeof patch.patchVersion === 'string' && /^[0-9A-Za-z.+-]{1,100}$/.test(patch.patchVersion)
          ? patch.patchVersion
          : `${baseVersion}-patch${build}`,
      notes: patch.notes.slice(0, 4000).trim(),
    };
  };
  try {
    const local = parse(await readBoundedRegularFile(join(root, 'manifest.json'), maxManifestSize));
    if (local) {
      return local;
    }
  } catch {
    // A missing or unreadable manifest can be recovered from the exact CDN slot.
  }
  if (networkAvailable()) {
    try {
      const response = await fetcher(`${PATCH_CDN}manifests/by-slot/${slot}.json`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2_500),
      });
      if (response.ok) {
        return parse(await readBoundedResponseBytes(response, maxManifestSize));
      }
      await response.body?.cancel();
    } catch {
      // Release notes are optional at startup.
    }
  }
  return undefined;
}
