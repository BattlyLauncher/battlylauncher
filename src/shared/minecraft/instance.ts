export type InstanceJavaMode = 'automatic' | 'custom-path' | 'global';

export const instanceCopyParts = [
  'mods',
  'settings',
  'worlds',
  'resourcepacks',
  'shaderpacks',
  'screenshots',
  'servers',
] as const;

export interface InstanceCopyRequest {
  readonly name: string;
  readonly parts: readonly (typeof instanceCopyParts)[number][];
}

export interface InstanceLaunchProfile {
  readonly javaPath: string;
  readonly javaVersion: InstanceJavaMode;
  readonly jvmArgs: string;
  readonly ramMaxGb: number | null;
  readonly ramMinGb: number | null;
}

export interface InstanceDraft {
  readonly description: string;
  readonly loader: string | null;
  readonly loaderVersion: string | null;
  readonly name: string;
  readonly version: string;
  readonly iconDataUrl?: string | null;
  readonly launchProfile?: InstanceLaunchProfile;
}

export interface InstanceArtwork {
  readonly provider?: 'modrinth' | 'curseforge';
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly author: string;
  readonly downloads: number;
  readonly iconUrl: string | null;
  readonly coverUrl: string | null;
  readonly coverUrls?: readonly string[];
}

export interface InstanceSummary extends InstanceDraft {
  readonly artwork?: InstanceArtwork;
  readonly id: string;
}

export const instanceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const versionPartPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Instance metadata must be an object');
  }
  return value as Record<string, unknown>;
}

function readableText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new TypeError(`Invalid instance ${label}`);
  }
  const valid = [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || code >= 32;
  });
  if (!valid) {
    throw new TypeError(`Invalid instance ${label}`);
  }
  return value;
}

function versionPart(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !versionPartPattern.test(value)) {
    throw new TypeError(`Invalid instance ${label}`);
  }
  return value;
}

function optionalObject(value: unknown, label: string): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid instance ${label}`);
  }
  return value as Record<string, unknown>;
}

function optionalRam(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 64) {
    throw new TypeError(`Invalid instance ${label}`);
  }
  return Math.round(parsed * 2) / 2;
}

function normalizeLaunchProfile(value: unknown): InstanceLaunchProfile | null {
  const source = optionalObject(value, 'launch profile');
  if (!source) {
    return null;
  }
  const rawJavaVersion = own(source, 'javaVersion');
  const javaVersion: InstanceJavaMode =
    rawJavaVersion === 'automatic' || rawJavaVersion === 'custom-path' ? rawJavaVersion : 'global';
  const javaPath = readableText(own(source, 'javaPath') ?? '', 'Java path', 2048).trim();
  if (javaVersion === 'custom-path' && !/^(?:[a-zA-Z]:[\\/]|\/)/.test(javaPath)) {
    throw new TypeError('Invalid instance Java path');
  }
  const requestedMinimum = optionalRam(own(source, 'ramMinGb'), 'minimum RAM');
  const requestedMaximum = optionalRam(own(source, 'ramMaxGb'), 'maximum RAM');
  const ramMinGb =
    requestedMinimum !== null && requestedMaximum !== null
      ? Math.min(requestedMinimum, requestedMaximum)
      : requestedMinimum;
  const ramMaxGb =
    requestedMinimum !== null && requestedMaximum !== null
      ? Math.max(requestedMinimum, requestedMaximum)
      : requestedMaximum;
  return {
    ramMinGb,
    ramMaxGb,
    javaVersion,
    javaPath: javaVersion === 'custom-path' ? javaPath : '',
    jvmArgs: readableText(own(source, 'jvmArgs') ?? '', 'JVM arguments', 4096).trim(),
  };
}

function normalizeIconDataUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length > 1_500_000 ||
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new TypeError('Invalid instance icon');
  }
  return value;
}

export function normalizeInstanceDraft(value: unknown): InstanceDraft {
  const source = object(value);
  const name = readableText(own(source, 'name'), 'name', 128).trim();
  if (!name) {
    throw new TypeError('Invalid instance name');
  }
  const version = versionPart(own(source, 'version'), 'version');
  if (!version) {
    throw new TypeError('Invalid instance version');
  }
  const launchProfile = normalizeLaunchProfile(own(source, 'launchProfile'));
  const iconDataUrl = normalizeIconDataUrl(own(source, 'iconDataUrl'));
  return {
    name,
    description: readableText(own(source, 'description') ?? '', 'description', 1024),
    version,
    loader: versionPart(own(source, 'loader'), 'loader'),
    loaderVersion: versionPart(own(source, 'loaderVersion'), 'loader version'),
    ...(iconDataUrl ? { iconDataUrl } : {}),
    ...(launchProfile ? { launchProfile } : {}),
  };
}

export function normalizeInstanceSummary(id: unknown, value: unknown): InstanceSummary {
  if (typeof id !== 'string' || !instanceIdPattern.test(id)) {
    throw new TypeError('Invalid instance id');
  }
  return { id, ...normalizeInstanceDraft(value) };
}
