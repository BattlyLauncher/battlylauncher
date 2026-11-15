export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly platform: string;
  readonly development: boolean;
  readonly architecture?: string;
  readonly online?: boolean;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }

  return value.trim();
}

export function normalizeAppInfo(value: unknown): AppInfo {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Application info must be an object');
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.development !== 'boolean') {
    throw new TypeError('development must be a boolean');
  }

  return {
    name: requireText(candidate.name, 'name'),
    version: requireText(candidate.version, 'version'),
    platform: requireText(candidate.platform, 'platform'),
    development: candidate.development,
    ...(typeof candidate.architecture === 'string' ? { architecture: candidate.architecture } : {}),
    ...(typeof candidate.online === 'boolean' ? { online: candidate.online } : {}),
  };
}
