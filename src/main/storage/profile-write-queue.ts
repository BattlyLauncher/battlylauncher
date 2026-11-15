import { resolve } from 'node:path';

// Account and settings services share a document, so read/modify/write must
// share a queue as well. An atomic rename alone cannot prevent lost updates.
const writes = new Map<string, Promise<unknown>>();
export function enqueueProfileWrite<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const absolute = resolve(path);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  const pending = (writes.get(key) ?? Promise.resolve()).then(operation, operation);
  writes.set(key, pending);
  const cleanup = (): void => {
    if (writes.get(key) === pending) {
      writes.delete(key);
    }
  };
  void pending.then(cleanup, cleanup);
  return pending;
}
