import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';

/** Mojang Linux manifests use ../lib/... relative to the link, not the runtime root. */
export function runtimeLinkTarget(root: string, destination: string, value: string): string {
  if (
    !value ||
    value.length > 1024 ||
    /[\0\r\n\\]/.test(value) ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    throw new TypeError('Invalid runtime link target');
  }
  const target = resolve(dirname(destination), value);
  const relation = relative(root, target);
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new TypeError('Runtime link escapes its installation directory');
  }
  return value;
}
