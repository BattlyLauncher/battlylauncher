import { isAbsolute, resolve } from 'node:path';

import {
  normalizeVisualPreferences,
  type VisualPreferences,
} from '../../shared/preferences/visual-preferences';
import { readBoundedRegularFile } from '../files/atomic-file';

const maxLegacyStoreBytes = 16 * 1024 * 1024;

export async function readVisualPreferencesFile(
  storePathValue: string,
): Promise<VisualPreferences> {
  if (!isAbsolute(storePathValue)) {
    throw new TypeError('Visual preference store path must be absolute');
  }
  const content = await readBoundedRegularFile(resolve(storePathValue), maxLegacyStoreBytes);
  let value: unknown;
  try {
    value = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Visual preference store is not valid JSON');
  }
  return normalizeVisualPreferences(value);
}
