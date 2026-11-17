import {
  normalizeDisplayOverrides,
  normalizeWorldsPreferences,
  defaultWorldsPreferences,
  type DisplayOverrides,
  type WorldsPreferences,
} from './game-preferences';
import {
  defaultVisualPreferences,
  normalizeVisualPreferences,
  type VisualPreferences,
} from '../preferences/visual-preferences';
import type { AutoRamRecommendation } from './auto-ram';

export interface RuntimeSettings {
  readonly javaPath: string;
  readonly ramMinGb: number;
  readonly ramMaxGb: number;
  readonly autoRamEnabled: boolean;
  readonly windowFullscreen: boolean;
  readonly displayOverrides: DisplayOverrides;
  readonly worlds: WorldsPreferences;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly hideLauncherOnGameStart: boolean;
  readonly minimizeWhilePreparing: boolean;
  readonly showMusicOnGameStart: boolean;
  readonly closeToBackground: boolean;
  readonly downloadConcurrency: number;
  readonly simpleMode: boolean;
  readonly clickSounds: boolean;
  readonly startupSoundEnabled: boolean;
  readonly ogIntroEnabled: boolean;
  readonly launchBoostEnabled: boolean;
  readonly backupSharedWorlds: boolean;
  readonly backupInstances: boolean;
  readonly backupIntervalMinutes: number;
}

export interface PrivacySettings {
  readonly telemetryEnabled: boolean;
  readonly analyticsLogsEnabled: boolean;
  readonly presenceShareStatus: boolean;
  readonly presenceShareServer: boolean;
  readonly discordShareStatus: boolean;
  readonly discordShareServer: boolean;
}

export interface SettingsSnapshot {
  readonly visual: VisualPreferences;
  readonly privacy: PrivacySettings;
  readonly autoSyncEnabled: boolean;
  readonly googleDriveConnected: boolean;
  readonly autoRamRecommendation: AutoRamRecommendation;
  readonly runtime: RuntimeSettings;
}

export interface SettingsDraft {
  readonly visual: VisualPreferences;
  readonly privacy: PrivacySettings;
  readonly autoSyncEnabled: boolean;
  readonly runtime: RuntimeSettings;
}

export const defaultPrivacySettings: PrivacySettings = Object.freeze({
  telemetryEnabled: true,
  analyticsLogsEnabled: true,
  presenceShareStatus: true,
  presenceShareServer: true,
  discordShareStatus: true,
  discordShareServer: true,
});

export const defaultRuntimeSettings: RuntimeSettings = Object.freeze({
  javaPath: '',
  ramMinGb: 0.5,
  ramMaxGb: 2,
  autoRamEnabled: false,
  windowFullscreen: false,
  displayOverrides: {},
  worlds: defaultWorldsPreferences,
  windowWidth: 1280,
  windowHeight: 720,
  hideLauncherOnGameStart: true,
  minimizeWhilePreparing: false,
  showMusicOnGameStart: false,
  closeToBackground: true,
  downloadConcurrency: 50,
  simpleMode: false,
  clickSounds: false,
  startupSoundEnabled: true,
  ogIntroEnabled: false,
  launchBoostEnabled: true,
  backupSharedWorlds: true,
  backupInstances: true,
  backupIntervalMinutes: 0,
});

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function normalizeRuntimeSettings(value: unknown): RuntimeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultRuntimeSettings;
  }
  const source = value as Record<string, unknown>;
  const javaPathValue = own(source, 'javaPath');
  const javaPath = typeof javaPathValue === 'string' ? javaPathValue.trim() : '';
  if (
    javaPath.length > 2_048 ||
    [...javaPath].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new TypeError('Invalid Java path');
  }
  const ramMinGb = boundedNumber(own(source, 'ramMinGb'), 0.5, 0.5, 64);
  const ramMaxGb = boundedNumber(own(source, 'ramMaxGb'), 2, 0.5, 64);
  return {
    javaPath,
    ramMinGb: Math.min(ramMinGb, ramMaxGb),
    ramMaxGb: Math.max(ramMinGb, ramMaxGb),
    autoRamEnabled: boolean(own(source, 'autoRamEnabled'), false),
    windowFullscreen: own(source, 'windowFullscreen') === true,
    displayOverrides: normalizeDisplayOverrides(own(source, 'displayOverrides')),
    worlds: normalizeWorldsPreferences(own(source, 'worlds')),
    windowWidth: Math.round(boundedNumber(own(source, 'windowWidth'), 1280, 320, 7680)),
    windowHeight: Math.round(boundedNumber(own(source, 'windowHeight'), 720, 240, 4320)),
    hideLauncherOnGameStart: boolean(own(source, 'hideLauncherOnGameStart'), true),
    minimizeWhilePreparing: boolean(own(source, 'minimizeWhilePreparing'), false),
    showMusicOnGameStart: boolean(own(source, 'showMusicOnGameStart'), false),
    closeToBackground: boolean(own(source, 'closeToBackground'), true),
    downloadConcurrency: Math.round(boundedNumber(own(source, 'downloadConcurrency'), 50, 1, 500)),
    simpleMode: boolean(own(source, 'simpleMode'), false),
    clickSounds: boolean(own(source, 'clickSounds'), false),
    startupSoundEnabled: boolean(own(source, 'startupSoundEnabled'), true),
    ogIntroEnabled: boolean(own(source, 'ogIntroEnabled'), false),
    launchBoostEnabled: boolean(own(source, 'launchBoostEnabled'), true),
    backupSharedWorlds: boolean(own(source, 'backupSharedWorlds'), true),
    backupInstances: boolean(own(source, 'backupInstances'), true),
    backupIntervalMinutes: Math.round(
      boundedNumber(own(source, 'backupIntervalMinutes'), 0, 0, 1440),
    ),
  };
}

export function normalizePrivacySettings(value: unknown): PrivacySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultPrivacySettings;
  }
  const source = value as Record<string, unknown>;
  const presenceShareStatus = boolean(
    own(source, 'presenceShareStatus'),
    defaultPrivacySettings.presenceShareStatus,
  );
  // Keep existing privacy choices when migrating the previously shared controls.
  const discordShareStatus = boolean(own(source, 'discordShareStatus'), presenceShareStatus);
  const presenceShareServer =
    presenceShareStatus &&
    boolean(own(source, 'presenceShareServer'), defaultPrivacySettings.presenceShareServer);
  return {
    telemetryEnabled: true,
    analyticsLogsEnabled: true,
    presenceShareStatus,
    presenceShareServer,
    discordShareStatus,
    discordShareServer:
      discordShareStatus && boolean(own(source, 'discordShareServer'), presenceShareServer),
  };
}

export function normalizeSettingsDraft(value: unknown): SettingsDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid settings draft');
  }
  const source = value as Record<string, unknown>;
  const visualValue = own(source, 'visual');
  const visual = normalizeVisualPreferences({
    'theme-color': own((visualValue as Record<string, unknown>) ?? {}, 'buttonColor'),
    'theme-color-hover': own((visualValue as Record<string, unknown>) ?? {}, 'buttonHoverColor'),
    'theme-color-bottom-bar': own((visualValue as Record<string, unknown>) ?? {}, 'footerColor'),
    'theme-opacity-bottom-bar': own(
      (visualValue as Record<string, unknown>) ?? {},
      'footerOpacity',
    ),
    'background-img': own((visualValue as Record<string, unknown>) ?? {}, 'backgroundUrl'),
    lang: own((visualValue as Record<string, unknown>) ?? {}, 'language'),
  });
  const privacy = normalizePrivacySettings(own(source, 'privacy'));
  const runtime = normalizeRuntimeSettings(own(source, 'runtime'));
  return {
    visual,
    privacy: {
      telemetryEnabled: privacy.telemetryEnabled,
      analyticsLogsEnabled: privacy.analyticsLogsEnabled,
      presenceShareStatus: privacy.presenceShareStatus,
      presenceShareServer: privacy.presenceShareServer,
      discordShareStatus: privacy.discordShareStatus,
      discordShareServer: privacy.discordShareServer,
    },
    autoSyncEnabled: boolean(own(source, 'autoSyncEnabled'), false),
    runtime,
  };
}

export const defaultSettingsSnapshot: SettingsSnapshot = Object.freeze({
  visual: defaultVisualPreferences,
  privacy: defaultPrivacySettings,
  autoSyncEnabled: false,
  googleDriveConnected: false,
  autoRamRecommendation: Object.freeze({
    totalGb: 1,
    freeGb: 0,
    minimumGb: 0.5,
    maximumGb: 0.5,
    targetPercent: 20,
  }),
  runtime: defaultRuntimeSettings,
});
