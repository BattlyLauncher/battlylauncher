import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { resolve, relative, isAbsolute, basename, dirname, join } from 'node:path';

const prefix = 'BATTLY-PRIVATE-1:';
const aad = Buffer.from(prefix);
let key: Buffer | undefined;
let accepts: (path: string) => boolean = () => false;
const metadataRoots = new Map<string, ReadonlySet<string>>();
export function registerPrivateMetadataRoot(root: string, names: readonly string[]): void {
  metadataRoots.set(resolve(root), new Set(names));
}

/** Installed once, after the OS key store is unlocked and before services read user data. */
export function configureProtectedData(secret: Buffer, predicate: (path: string) => boolean): void {
  if (secret.length !== 32) {
    throw new Error('Invalid private storage key');
  }
  key = Buffer.from(secret);
  accepts = predicate;
}

export function isProtectedDataPath(path: string): boolean {
  const temporary = /^\.(.+)\.[a-zA-Z0-9_-]{1,120}\.(?:pending|displaced)$/.exec(basename(path));
  if (temporary) {
    path = join(dirname(path), temporary[1]);
  }
  if (accepts(resolve(path))) {
    return true;
  }
  if (!key) {
    return false;
  }
  for (const [root, names] of metadataRoots) {
    const part = relative(root, resolve(path)).replaceAll('\\', '/');
    if (
      !part.startsWith('..') &&
      !isAbsolute(part) &&
      part.split('/').length === 2 &&
      names.has(part.split('/')[1])
    ) {
      return true;
    }
  }
  return false;
}
export function isEncryptedData(bytes: Buffer): boolean {
  return bytes.subarray(0, prefix.length).toString() === prefix;
}

export function encodePrivateData(path: string, content: string | Uint8Array): Buffer {
  const bytes = Buffer.from(content);
  if (!isProtectedDataPath(path)) {
    return bytes;
  }
  if (!key) {
    throw new Error('Private storage is locked');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.from(
    prefix + Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64') + '\n',
  );
}

/** Multiple independently authenticated records support append-only logs without rewriting them. */
export function decodePrivateData(path: string, bytes: Buffer): Buffer {
  if (!isEncryptedData(bytes)) {
    return bytes;
  }
  if (!isProtectedDataPath(path) || !key) {
    throw new Error('Private storage is locked');
  }
  try {
    const records = bytes.toString('ascii').trimEnd().split('\n');
    return Buffer.concat(
      records.map((line) => {
        if (!line.startsWith(prefix)) {
          throw new Error('Invalid encrypted record');
        }
        const encoded = line.slice(prefix.length);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
          throw new Error('Invalid encrypted record');
        }
        const payload = Buffer.from(encoded, 'base64');
        if (payload.toString('base64') !== encoded) {
          throw new Error('Invalid encrypted record');
        }
        if (payload.length < 28) {
          throw new Error('Invalid encrypted record');
        }
        const cipher = createDecipheriv('aes-256-gcm', key!, payload.subarray(0, 12));
        cipher.setAAD(aad);
        cipher.setAuthTag(payload.subarray(12, 28));
        return Buffer.concat([cipher.update(payload.subarray(28)), cipher.final()]);
      }),
    );
  } catch {
    throw new Error('Private data cannot be decrypted. The original file has been preserved.');
  }
}

export function privateDataPolicy(
  root: string,
  extraFiles: readonly string[] = [],
  extraLogRoots: readonly string[] = [],
): (path: string) => boolean {
  const extras = new Set(extraFiles.map((path) => resolve(path).toLowerCase()));
  const inside = (parent: string, file: string): string | null => {
    const part = relative(resolve(parent), resolve(file));
    return !part.startsWith('..') && !isAbsolute(part) ? part.replaceAll('\\', '/') : null;
  };
  return (path) => {
    if (
      extras.has(resolve(path).toLowerCase()) ||
      extras.has(
        resolve(path)
          .toLowerCase()
          .replace(/\.previous$/, ''),
      )
    ) {
      return true;
    }
    if (
      extraLogRoots.some((parent) => inside(parent, path) !== null) &&
      /\.jsonl(?:\.previous)?$/i.test(path)
    ) {
      return true;
    }
    const name = inside(root, path);
    if (!name) {
      return false;
    }
    // External runtimes, game data, media streams and portable exports keep their native formats.
    return (
      /^[^/]+\.json$/i.test(name) ||
      /^(cache|mesa-profiles|migration-backups|instance-artwork-cache)\/.*\.json$/i.test(name) ||
      /^logs\/.*\.jsonl(?:\.previous)?$/i.test(name) ||
      /^battlyworlds\/(overlay\.json|invitations\/.*\.json)$/i.test(name)
    );
  };
}
