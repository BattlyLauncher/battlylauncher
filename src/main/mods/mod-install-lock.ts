import { resolve } from 'node:path';
const roots = new Set<string>();
export function acquireModInstallLock(root: string): (() => void) | undefined {
  const key = process.platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
  if (roots.has(key)) {
    return;
  }
  roots.add(key);
  return () => {
    roots.delete(key);
  };
}
