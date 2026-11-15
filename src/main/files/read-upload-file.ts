import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/** User-picked media stays plaintext and is never read beyond the upload budget. */
export async function readBoundedUploadFile(
  path: string,
  maximumBytes: number,
  errorMessage: string,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 16 * 1024 * 1024) {
    throw new TypeError('Invalid upload file size limit');
  }
  const selected = await lstat(path);
  if (!selected.isFile() || selected.isSymbolicLink() || selected.size > maximumBytes) {
    throw new TypeError(errorMessage);
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > maximumBytes ||
      info.dev !== selected.dev ||
      info.ino !== selected.ino
    ) {
      throw new TypeError(errorMessage);
    }
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let length = 0;
    while (length <= maximumBytes) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) {
        return buffer.subarray(0, length);
      }
      length += bytesRead;
    }
    throw new TypeError(errorMessage);
  } finally {
    await file.close();
  }
}
