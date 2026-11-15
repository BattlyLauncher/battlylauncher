import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { isNetworkFailure, networkAvailable } from './connectivity';

/** Read-only snapshots are account-scoped. Never cache tokens or successful writes.
 * Authentication denials and validation failures must never be hidden by a cache. */
export class OfflineSnapshotCache<T> {
  constructor(
    private readonly directory: string | undefined,
    private readonly validate: (value: unknown) => T,
  ) {}

  async load(
    identity: string,
    remote: () => Promise<T>,
    fallback: () => T,
  ): Promise<{ data: T; cached: boolean }> {
    const key = createHash('sha256').update(identity).digest('hex');
    const path = this.directory ? join(this.directory, `${key}.json`) : null;
    const cached = async (): Promise<{ data: T; cached: boolean }> => {
      if (path) {
        try {
          return {
            data: this.validate(
              JSON.parse((await readBoundedRegularFile(path, 2 * 1024 * 1024)).toString('utf8')),
            ),
            cached: true,
          };
        } catch {
          /* Missing or invalid caches use an explicit empty offline state. */
        }
      }
      return { data: fallback(), cached: true };
    };
    if (!networkAvailable()) {
      return cached();
    }
    try {
      const data = this.validate(await remote());
      if (path) {
        await writeFileAtomically(path, JSON.stringify(data)).catch(() => undefined);
      }
      return { data, cached: false };
    } catch (error) {
      if (!isNetworkFailure(error)) {
        throw error;
      }
      return cached();
    }
  }
}
