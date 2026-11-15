export interface LabyModVersion {
  readonly customManifestUrl: string;
  readonly tag: string;
  readonly version: string;
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;

export function normalizeLabyModVersion(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid LabyMod version');
  }
  const version = value.trim();
  if (!identifierPattern.test(version)) {
    throw new TypeError('Invalid LabyMod version');
  }
  return version;
}
