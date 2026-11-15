import {
  defaultVisualPreferences,
  normalizeVisualPreferences,
  type VisualPreferences,
} from '../preferences/visual-preferences';

export type ThemeReviewStatus = 'draft' | 'requested' | 'pending' | 'approved' | 'rejected';

export interface BattlyTheme {
  readonly id: string;
  readonly name: string;
  readonly visual: VisualPreferences;
  readonly loadingColor: string;
  readonly startupSound: string;
  readonly startupVolume: number;
  readonly isDefault: boolean;
  readonly isPublic: boolean;
  readonly contentRestricted?: boolean;
  readonly reviewStatus: ThemeReviewStatus;
  readonly ownerName: string | null;
  readonly downloads: number;
  readonly likes: number;
  readonly comments: number;
}

export interface ThemeDraft {
  readonly id?: string;
  readonly name: string;
  readonly buttonColor: string;
  readonly buttonHoverColor: string;
  readonly footerColor: string;
  readonly footerOpacity: number;
  readonly loadingColor: string;
  readonly backgroundUrl: string | null;
  readonly startupSound: string;
  readonly startupVolume: number;
}

export interface ThemeLibrarySnapshot {
  readonly activeThemeId: string | null;
  readonly themes: readonly BattlyTheme[];
}

export interface ThemeSoundLibrary {
  readonly premium: boolean;
  readonly sounds: readonly { readonly id: string; readonly name: string; readonly url: string }[];
}

export function normalizeThemeSound(value: unknown): string {
  const sound = text(value, 2048, 'start');
  if (/^start[0-6]?$/.test(sound)) {
    return sound;
  }
  if (
    /^https:\/\/cdn\.battlylauncher\.com\/public\/sounds\/[A-Za-z0-9_./-]+\.(mp3|wav|ogg|m4a|aac)$/i.test(
      sound,
    ) &&
    !sound.includes('..')
  ) {
    return sound;
  }
  return 'start';
}

export interface ThemeShareResult {
  readonly shareUrl: string;
  readonly expiresAt: string | null;
}

export interface ThemeReviewResult {
  readonly reason: string | null;
  readonly status: ThemeReviewStatus;
}

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const hexPattern = /^#[0-9a-f]{6}$/i;

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, maximum: number, fallback = ''): string {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum
    ? [...value]
        .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
        .join('')
        .trim()
    : fallback;
}

function count(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && hexPattern.test(value) ? value.toLowerCase() : fallback;
}

function darken(value: string, amount = 0.1): string {
  const numeric = Number.parseInt(value.slice(1), 16);
  const channels = [numeric >> 16, (numeric >> 8) & 0xff, numeric & 0xff].map(
    (channel) => channel / 255,
  );
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === channels[0]) {
      hue = ((channels[1] - channels[2]) / delta) % 6;
    } else if (maximum === channels[1]) {
      hue = (channels[2] - channels[0]) / delta + 2;
    } else {
      hue = (channels[0] - channels[1]) / delta + 4;
    }
    hue = (((hue * 60) % 360) + 360) % 360;
  }
  const lightness = (maximum + minimum) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const nextLightness = Math.max(0, lightness - amount);
  const chroma = (1 - Math.abs(2 * nextLightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs((segment % 2) - 1));
  const rgb =
    segment < 1
      ? [chroma, secondary, 0]
      : segment < 2
        ? [secondary, chroma, 0]
        : segment < 3
          ? [0, chroma, secondary]
          : segment < 4
            ? [0, secondary, chroma]
            : segment < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = nextLightness - chroma / 2;
  return `#${rgb
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function reviewStatus(value: unknown): ThemeReviewStatus {
  return value === 'requested' ||
    value === 'pending' ||
    value === 'approved' ||
    value === 'rejected'
    ? value
    : 'draft';
}

export function normalizeTheme(value: unknown): BattlyTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const id = text(own(source, 'id') ?? own(source, '_id'), 128);
  const name = text(own(source, 'name'), 40);
  if (!idPattern.test(id) || !name) {
    return null;
  }
  const buttonColor = color(own(source, 'btnColor') ?? own(source, 'buttonColor'), '#3e8ed0');
  const owner = own(source, 'owner');
  const ownerName =
    owner && typeof owner === 'object' && !Array.isArray(owner)
      ? text(own(owner as Record<string, unknown>, 'username'), 40) || null
      : text(own(source, 'ownerName'), 40) || null;
  const visual = normalizeVisualPreferences({
    'theme-color': buttonColor,
    'theme-color-hover':
      own(source, 'btnHoverColor') ?? own(source, 'buttonHoverColor') ?? darken(buttonColor),
    'theme-color-bottom-bar': own(source, 'footerColor'),
    'theme-opacity-bottom-bar': own(source, 'footerOpacity'),
    'background-img': own(source, 'background') ?? own(source, 'backgroundUrl'),
    lang: 'es',
  });
  return {
    id,
    name,
    visual,
    loadingColor: color(own(source, 'loadingColor'), '#000000'),
    startupSound: normalizeThemeSound(own(source, 'startupSound')),
    startupVolume:
      own(source, 'startupVolume') != null && Number.isFinite(Number(own(source, 'startupVolume')))
        ? Math.max(0, Math.min(1, Number(own(source, 'startupVolume'))))
        : 0.8,
    isDefault: own(source, 'isDefault') === true || id === 'battly-default-theme',
    isPublic: own(source, 'isPublic') === true,
    contentRestricted:
      own(source, 'nsfw') === true ||
      own(source, 'adult') === true ||
      ['adult', 'explicit', '18+'].includes(String(own(source, 'contentRating')).toLowerCase()),
    reviewStatus: reviewStatus(own(source, 'reviewStatus')),
    ownerName,
    downloads: count(own(source, 'downloads')),
    likes: count(own(source, 'likesCount') ?? own(source, 'likes')),
    comments: count(own(source, 'commentsCount') ?? own(source, 'comments')),
  };
}

export function normalizeThemeList(value: unknown): readonly BattlyTheme[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(normalizeTheme).filter((theme): theme is BattlyTheme => theme !== null);
}

export function normalizeThemeDraft(value: unknown): ThemeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tema inválido');
  }
  const source = value as Record<string, unknown>;
  const name = text(own(source, 'name'), 40);
  if (!name) {
    throw new Error('El tema necesita un nombre');
  }
  const id = text(own(source, 'id'), 128);
  if (id && !idPattern.test(id)) {
    throw new Error('ID de tema inválido');
  }
  const visual = normalizeVisualPreferences({
    'theme-color': own(source, 'buttonColor'),
    'theme-color-hover': own(source, 'buttonHoverColor'),
    'theme-color-bottom-bar': own(source, 'footerColor'),
    'theme-opacity-bottom-bar': own(source, 'footerOpacity'),
    'background-img': own(source, 'backgroundUrl'),
    lang: 'es',
  });
  return {
    ...(id ? { id } : {}),
    name,
    buttonColor: visual.buttonColor,
    buttonHoverColor: visual.buttonHoverColor,
    footerColor: visual.footerColor,
    footerOpacity: visual.footerOpacity,
    loadingColor: color(own(source, 'loadingColor'), '#000000'),
    backgroundUrl: visual.backgroundUrl,
    startupSound: normalizeThemeSound(own(source, 'startupSound')),
    startupVolume:
      own(source, 'startupVolume') != null && Number.isFinite(Number(own(source, 'startupVolume')))
        ? Math.max(0, Math.min(1, Number(own(source, 'startupVolume'))))
        : 0.8,
  };
}

export const defaultThemeDraft: ThemeDraft = Object.freeze({
  name: 'Mi tema',
  buttonColor: defaultVisualPreferences.buttonColor,
  buttonHoverColor: defaultVisualPreferences.buttonHoverColor,
  footerColor: defaultVisualPreferences.footerColor,
  footerOpacity: defaultVisualPreferences.footerOpacity,
  loadingColor: '#000000',
  backgroundUrl: null,
  startupSound: 'start',
  startupVolume: 0.8,
});

export function normalizeThemeId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    throw new Error('ID de tema inválido');
  }
  return value;
}

export function normalizeThemeImport(value: unknown): { code: string; customName: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Importación inválida');
  }
  const source = value as Record<string, unknown>;
  const raw = text(own(source, 'code'), 2048);
  const match = raw.match(/\/theme\/import\/([^/?#]+)/i);
  const code = decodeURIComponent(match?.[1] ?? raw).replace(/\/$/, '');
  if (!idPattern.test(code)) {
    throw new Error('Código de tema inválido');
  }
  const customName = text(own(source, 'customName'), 40) || null;
  return { code, customName };
}
