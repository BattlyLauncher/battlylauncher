export interface VisualPreferences {
  readonly backgroundUrl: string | null;
  readonly buttonColor: string;
  readonly buttonHoverColor: string;
  readonly footerColor: string;
  readonly footerOpacity: number;
  readonly language: string;
}

export const defaultVisualPreferences: VisualPreferences = Object.freeze({
  buttonColor: '#3e8ed0',
  buttonHoverColor: '#2b74b0',
  footerColor: '#0f1623',
  footerOpacity: 0.86,
  backgroundUrl: null,
  language: 'es',
});

const allowedBackgroundHosts = new Set([
  'api.battlylauncher.com',
  'cdn.battlylauncher.com',
  'i.imgur.com',
]);
const hexColorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const languagePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/;

function readOwnValue(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? (descriptor.value as unknown)
    : undefined;
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && hexColorPattern.test(value) ? value.toLowerCase() : fallback;
}

function normalizeOpacity(value: unknown): number {
  const parsed =
    typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : defaultVisualPreferences.footerOpacity;
}

function normalizeBackgroundUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !allowedBackgroundHosts.has(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeVisualPreferences(value: unknown): VisualPreferences {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return defaultVisualPreferences;
  }
  const source = value as Record<string, unknown>;
  const languageValue = readOwnValue(source, 'lang');

  return {
    buttonColor: normalizeColor(
      readOwnValue(source, 'theme-color'),
      defaultVisualPreferences.buttonColor,
    ),
    buttonHoverColor: normalizeColor(
      readOwnValue(source, 'theme-color-hover'),
      defaultVisualPreferences.buttonHoverColor,
    ),
    footerColor: normalizeColor(
      readOwnValue(source, 'theme-color-bottom-bar'),
      defaultVisualPreferences.footerColor,
    ),
    footerOpacity: normalizeOpacity(readOwnValue(source, 'theme-opacity-bottom-bar')),
    backgroundUrl: normalizeBackgroundUrl(readOwnValue(source, 'background-img')),
    language:
      typeof languageValue === 'string' && languagePattern.test(languageValue)
        ? languageValue
        : defaultVisualPreferences.language,
  };
}
