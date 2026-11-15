import { parseLegacyStorageDocument, type JsonValue } from '../../shared/storage/legacy-storage';
import { readBoundedRegularFile } from '../files/atomic-file';

const maximumProfileBytes = 16 * 1024 * 1024;

export async function readProfileValuesFile(
  path: string,
): Promise<Readonly<Record<string, JsonValue>>> {
  const content = await readBoundedRegularFile(path, maximumProfileBytes);
  let value: unknown;
  try {
    value = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Profile store is not valid JSON');
  }
  return parseLegacyStorageDocument(value).values;
}
