import { lstat, open } from 'node:fs/promises';
import { decodePrivateData, isEncryptedData } from '../storage/protected-data';

/** Read complete authenticated log records around a bounded head or tail window. */
export async function readPrivateFileWindow(
  path: string,
  maximumBytes: number,
  tail = false,
): Promise<{ content: Buffer; truncated: boolean }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 2 * 1024 * 1024) {
    throw new RangeError('Invalid log window size');
  }
  const expected = await lstat(path);
  if (!expected.isFile() || expected.isSymbolicLink()) {
    throw new TypeError('Expected a regular log file');
  }
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== expected.ino || info.dev !== expected.dev) {
      throw new TypeError('Log file changed while opening');
    }
    const prefix = Buffer.alloc(32);
    const header = await handle.read(prefix, 0, prefix.length, 0);
    const encrypted = isEncryptedData(prefix.subarray(0, header.bytesRead));
    // Encrypted records include base64 and an authentication tag per log event.
    const budget = encrypted ? maximumBytes * 3 + 4096 : maximumBytes;
    const size = Math.min(info.size, budget);
    const offset = tail ? Math.max(0, info.size - size) : 0;
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const chunk = await handle.read(bytes, read, size - read, offset + read);
      if (!chunk.bytesRead) {
        break;
      }
      read += chunk.bytesRead;
    }
    let window = bytes.subarray(0, read);
    if (encrypted) {
      const first = offset > 0 ? window.indexOf(10) + 1 : 0;
      const last = window.lastIndexOf(10);
      // A record being appended is retried on the next refresh, never partly decrypted.
      window = last >= first ? window.subarray(first, last + 1) : Buffer.alloc(0);
    }
    const decoded = window.length ? decodePrivateData(path, window) : window;
    const truncated = offset > 0 || read < info.size || decoded.length > maximumBytes;
    return {
      content: tail
        ? decoded.subarray(Math.max(0, decoded.length - maximumBytes))
        : decoded.subarray(0, maximumBytes),
      truncated,
    };
  } finally {
    await handle.close();
  }
}
