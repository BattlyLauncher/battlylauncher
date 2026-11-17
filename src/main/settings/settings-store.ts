import { randomUUID } from 'node:crypto';
import { isSupportedLanguage } from '../../shared/languages';
import { freemem, totalmem } from 'node:os';

import type { JsonValue } from '../../shared/storage/legacy-storage';
import { recommendAutoRam } from '../../shared/settings/auto-ram';
import {
  normalizePrivacySettings,
  normalizeRuntimeSettings,
  normalizeSettingsDraft,
  type SettingsDraft,
  type SettingsSnapshot,
} from '../../shared/settings/settings-contract';
import { normalizeVisualPreferences } from '../../shared/preferences/visual-preferences';
import type { InitialLanguage, OnboardingState } from '../../shared/onboarding/onboarding-contract';
import type { ManagedJavaMajor } from '../../shared/settings/java-runtime-contract';
import {
  normalizeJvmArgsConfig,
  type JvmArgsConfig,
} from '../../shared/settings/jvm-args-contract';
import { normalizeThemeSound, type BattlyTheme } from '../../shared/themes/theme-contract';
import { writeFileAtomically } from '../files/atomic-file';
import { readProfileValuesFile } from '../storage/profile-values-file';
import { enqueueProfileWrite } from '../storage/profile-write-queue';

export interface GoogleDriveCredentials {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
}

function own(source: Readonly<Record<string, JsonValue>>, key: string): JsonValue | undefined {
  return Object.getOwnPropertyDescriptor(source, key)?.value as JsonValue | undefined;
}

function jsonObject(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function managedJavaMap(value: JsonValue | undefined): Record<string, JsonValue> {
  if (typeof value === 'string') {
    try {
      return jsonObject(JSON.parse(value) as JsonValue);
    } catch {
      return {};
    }
  }
  return jsonObject(value);
}

function databaseValue(
  values: Readonly<Record<string, JsonValue>>,
  storeName: string,
): Record<string, JsonValue> {
  const stores = jsonObject(own(values, 'dbStores'));
  const store = jsonObject(own(stores, storeName));
  for (const entryValue of Object.values(store)) {
    const entry = jsonObject(entryValue);
    const value = jsonObject(own(entry, 'value'));
    if (Object.keys(value).length) {
      return value;
    }
  }
  return {};
}

function truthyLegacy(value: JsonValue | undefined): boolean {
  return value === true || value === 1 || value === 'true' || value === '1';
}

function googleTokenObject(value: JsonValue | undefined): Record<string, JsonValue> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, JsonValue>;
      }
    } catch {
      return {};
    }
  }
  return jsonObject(value);
}

function tokenText(source: Record<string, JsonValue>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = Object.getOwnPropertyDescriptor(source, key)?.value as JsonValue | undefined;
    if (typeof value === 'string' && value && value.length <= 16_384) {
      return value;
    }
  }
  return null;
}

function tokenNumber(source: Record<string, JsonValue>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = Object.getOwnPropertyDescriptor(source, key)?.value as JsonValue | undefined;
    const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(number) && number >= 0) {
      return number;
    }
  }
  return null;
}

function hasGoogleDriveConnection(values: Readonly<Record<string, JsonValue>>): boolean {
  const tokens = googleTokenObject(own(values, 'googleTokens'));
  return (
    tokenText(tokens, 'access_token', 'accessToken') !== null &&
    tokenText(tokens, 'refresh_token', 'refreshToken') !== null
  );
}

export class SettingsStore {
  readonly #path: string;
  readonly #systemMemory: () => { readonly freeBytes: number; readonly totalBytes: number };
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(
    path: string,
    systemMemory: () => { readonly freeBytes: number; readonly totalBytes: number } = () => ({
      freeBytes: freemem(),
      totalBytes: totalmem(),
    }),
  ) {
    this.#path = path;
    this.#systemMemory = systemMemory;
  }

  async snapshot(): Promise<SettingsSnapshot> {
    const values = await readProfileValuesFile(this.#path);
    const ram = databaseValue(values, 'ram');
    const screenEntry = databaseValue(values, 'screen');
    const screen = jsonObject(own(screenEntry, 'screen'));
    const launcherEntry = databaseValue(values, 'launcher');
    const launcher = jsonObject(own(launcherEntry, 'launcher'));
    const memory = this.#systemMemory();
    const autoRamRecommendation = recommendAutoRam(memory.totalBytes, memory.freeBytes);
    const runtime = normalizeRuntimeSettings({
      javaPath: own(values, 'java-path') ?? '',
      ramMinGb: own(ram, 'ramMin') ?? 0.5,
      ramMaxGb: own(ram, 'ramMax') ?? 2,
      autoRamEnabled: truthyLegacy(own(values, 'b-auto-ram-enabled')),
      windowFullscreen: own(screen, 'fullscreen'),
      displayOverrides: own(values, 'minecraft-display-overrides'),
      worlds: own(values, 'worlds-preferences'),
      windowWidth: own(screen, 'width') ?? 1280,
      windowHeight: own(screen, 'height') ?? 720,
      hideLauncherOnGameStart: own(launcher, 'close') !== 'open-launcher',
      minimizeWhilePreparing: own(launcher, 'minimizeWhilePreparing') === true,
      showMusicOnGameStart: own(launcher, 'closeMusic') === 'open-music',
      closeToBackground: own(launcher, 'closeApp') !== 'close',
      downloadConcurrency: own(launcher, 'downloadFileMultiple') ?? 50,
      simpleMode: own(launcher, 'simpleMode') === true,
      clickSounds: own(values, 'sound-click') === 'true',
      startupSoundEnabled: own(values, 'startup-sound-enabled') !== false,
      ogIntroEnabled: own(values, 'og-intro-enabled') === true,
      launchBoostEnabled: own(values, 'launchboost') !== false,
      backupSharedWorlds: own(values, 'backup-shared-worlds'),
      backupInstances: own(values, 'backup-instances'),
      backupIntervalMinutes: own(values, 'backup-interval-minutes'),
    });
    return {
      visual: normalizeVisualPreferences(values),
      privacy: normalizePrivacySettings(own(values, 'privacy-security-settings')),
      autoSyncEnabled: own(values, 'autoSyncEnabled') === true && hasGoogleDriveConnection(values),
      googleDriveConnected: hasGoogleDriveConnection(values),
      autoRamRecommendation,
      runtime: runtime.autoRamEnabled
        ? {
            ...runtime,
            ramMinGb: autoRamRecommendation.minimumGb,
            ramMaxGb: autoRamRecommendation.maximumGb,
          }
        : runtime,
    };
  }

  async save(value: SettingsDraft): Promise<SettingsSnapshot> {
    const normalized = normalizeSettingsDraft(value);
    const memory = this.#systemMemory();
    const recommendation = recommendAutoRam(memory.totalBytes, memory.freeBytes);
    const draft: SettingsDraft = normalized.runtime.autoRamEnabled
      ? {
          ...normalized,
          runtime: {
            ...normalized.runtime,
            ramMinGb: recommendation.minimumGb,
            ramMaxGb: recommendation.maximumGb,
          },
        }
      : normalized;
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      const previousPrivacy = jsonObject(own(values, 'privacy-security-settings'));
      const privacyWithoutPin = { ...previousPrivacy };
      delete privacyWithoutPin.pinHash;
      delete privacyWithoutPin.pinSalt;
      delete privacyWithoutPin.unlockedUntil;
      delete privacyWithoutPin.pinEnabled;
      delete privacyWithoutPin.pinSessionUnlockUntil;
      delete privacyWithoutPin.protectFileDelete;
      delete privacyWithoutPin.protectRemoteCommands;
      delete privacyWithoutPin.protectGlobalLogout;
      const stores = jsonObject(own(values, 'dbStores'));
      const storeEntry = (storeName: string, value: Record<string, JsonValue>): JsonValue => {
        const store = jsonObject(own(stores, storeName));
        const entryKey = Object.keys(store)[0] ?? 'key';
        const previousEntry = jsonObject(own(store, entryKey));
        return { ...store, [entryKey]: { ...previousEntry, key: 1234, value } };
      };
      const next: Record<string, JsonValue> = {
        ...values,
        'theme-color': draft.visual.buttonColor,
        'theme-color-hover': draft.visual.buttonHoverColor,
        'theme-color-bottom-bar': draft.visual.footerColor,
        'theme-opacity-bottom-bar': draft.visual.footerOpacity,
        'background-img': draft.visual.backgroundUrl,
        lang: draft.visual.language,
        autoSyncEnabled: draft.autoSyncEnabled && hasGoogleDriveConnection(values),
        'privacy-security-settings': {
          ...privacyWithoutPin,
          ...draft.privacy,
        },
        'java-path': draft.runtime.javaPath,
        'b-auto-ram-enabled': String(draft.runtime.autoRamEnabled),
        'sound-click': String(draft.runtime.clickSounds),
        'startup-sound-enabled': draft.runtime.startupSoundEnabled,
        'og-intro-enabled': draft.runtime.ogIntroEnabled,
        launchboost: draft.runtime.launchBoostEnabled,
        'backup-shared-worlds': draft.runtime.backupSharedWorlds,
        'backup-instances': draft.runtime.backupInstances,
        'backup-interval-minutes': draft.runtime.backupIntervalMinutes,
        'minecraft-display-overrides': JSON.parse(
          JSON.stringify(draft.runtime.displayOverrides),
        ) as JsonValue,
        'worlds-preferences': { ...draft.runtime.worlds },
        dbStores: {
          ...stores,
          ram: storeEntry('ram', {
            uuid: '1234',
            ramMin: String(draft.runtime.ramMinGb),
            ramMax: String(draft.runtime.ramMaxGb),
          }),
          screen: storeEntry('screen', {
            uuid: '1234',
            screen: {
              fullscreen: draft.runtime.windowFullscreen,
              width: String(draft.runtime.windowWidth),
              height: String(draft.runtime.windowHeight),
            },
          }),
          launcher: storeEntry('launcher', {
            uuid: '1234',
            launcher: {
              close: draft.runtime.hideLauncherOnGameStart ? 'close-launcher' : 'open-launcher',
              minimizeWhilePreparing: draft.runtime.minimizeWhilePreparing,
              closeMusic: draft.runtime.showMusicOnGameStart ? 'open-music' : 'close-music',
              closeApp: draft.runtime.closeToBackground ? 'background' : 'close',
              downloadFileMultiple: draft.runtime.downloadConcurrency,
              simpleMode: draft.runtime.simpleMode,
            },
          }),
        },
      };
      await writeFileAtomically(this.#path, `${JSON.stringify(next, null, 2)}\n`, randomUUID());
    });
    return this.snapshot();
  }

  async jvmArgs(): Promise<JvmArgsConfig> {
    const values = await readProfileValuesFile(this.#path);
    const raw = own(values, 'jvm-args-by-version');
    try {
      return normalizeJvmArgsConfig({ byVersion: jsonObject(raw) });
    } catch {
      return { byVersion: {} };
    }
  }

  async saveJvmArgs(value: JvmArgsConfig): Promise<JvmArgsConfig> {
    const normalized = normalizeJvmArgsConfig(value);
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, 'jvm-args-by-version': normalized.byVersion }, null, 2)}\n`,
        randomUUID(),
      );
    });
    return normalized;
  }

  async disconnectDrive(): Promise<void> {
    await this.#mergeValues({ googleTokens: null, autoSyncEnabled: false });
  }

  async googleDriveCredentials(): Promise<GoogleDriveCredentials | null> {
    const values = await readProfileValuesFile(this.#path);
    const tokens = googleTokenObject(own(values, 'googleTokens'));
    const accessToken = tokenText(tokens, 'access_token', 'accessToken');
    if (!accessToken) {
      return null;
    }
    return {
      accessToken,
      refreshToken: tokenText(tokens, 'refresh_token', 'refreshToken'),
      expiresAt: tokenNumber(tokens, 'expiry_date', 'expires_at', 'expiresAt'),
    };
  }

  async recordManagedJavaRuntime(major: ManagedJavaMajor, path: string): Promise<void> {
    await this.#writeManagedJava(major, path, false);
  }

  async selectManagedJavaRuntime(major: ManagedJavaMajor, path: string): Promise<void> {
    await this.#writeManagedJava(major, path, true);
  }

  async clearManagedJavaRuntimeSelection(): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, 'java-path': '', 'java-selected-major': '' }, null, 2)}\n`,
        randomUUID(),
      );
    });
  }

  async activeThemeId(): Promise<string | null> {
    const values = await readProfileValuesFile(this.#path);
    const value = own(values, 'activeThemeCloud_v1');
    return typeof value === 'string' && value ? value : null;
  }

  async startupSoundPreference(): Promise<{ readonly sound: string; readonly volume: number }> {
    const values = await readProfileValuesFile(this.#path);
    const rawSound = own(values, 'sonido-inicio');
    const normalizedSound = rawSound === 'battle' ? 'start5' : rawSound;
    const sound = normalizeThemeSound(normalizedSound);
    const rawVolume = Number(own(values, 'sonido-inicio-volumen'));
    return {
      sound,
      volume:
        own(values, 'startup-sound-enabled') !== false
          ? Number.isFinite(rawVolume)
            ? Math.max(0, Math.min(1, rawVolume))
            : 0.8
          : 0,
    };
  }

  async startupLoadingColorPreference(): Promise<string> {
    const values = await readProfileValuesFile(this.#path);
    const value =
      own(values, 'background-loading-screen-color') ?? own(values, 'loading-color') ?? '#3e8ed0';
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : '#3e8ed0';
  }

  async applyTheme(theme: BattlyTheme): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify(
          {
            ...values,
            activeThemeCloud_v1: theme.id,
            'theme-color': theme.visual.buttonColor,
            'theme-color-hover': theme.visual.buttonHoverColor,
            'theme-color-bottom-bar': theme.visual.footerColor,
            'theme-opacity-bottom-bar': theme.visual.footerOpacity,
            'background-img': theme.visual.backgroundUrl,
            'background-loading-screen-color': theme.loadingColor,
            'sonido-inicio': theme.startupSound,
            'sonido-inicio-volumen': theme.startupVolume,
          },
          null,
          2,
        )}\n`,
        randomUUID(),
      );
    });
  }

  async clearActiveTheme(): Promise<void> {
    await this.#mergeValues({
      activeThemeCloud_v1: null,
      'sonido-inicio': 'start',
      'sonido-inicio-volumen': 0.8,
    });
  }

  async #writeManagedJava(major: ManagedJavaMajor, path: string, selected: boolean): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      const installed = managedJavaMap(own(values, 'java-installed'));
      installed[String(major)] = { path, source: 'mojang' };
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify(
          {
            ...values,
            'java-installed': JSON.stringify(installed),
            ...(selected ? { 'java-path': path, 'java-selected-major': String(major) } : {}),
          },
          null,
          2,
        )}\n`,
        randomUUID(),
      );
    });
  }

  async backupHistory(): Promise<JsonValue> {
    const values = await readProfileValuesFile(this.#path);
    return own(values, 'backupHistory') ?? [];
  }

  async backupCount(): Promise<number> {
    const history = await this.backupHistory();
    return Array.isArray(history) ? history.length : 0;
  }

  async latestBackupAt(): Promise<string | null> {
    const history = await this.backupHistory();
    if (!Array.isArray(history)) {
      return null;
    }
    const timestamps = history.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const value = own(entry, 'createdAt') ?? own(entry, 'timestamp');
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        return [];
      }
      return [value];
    });
    return timestamps.sort((left, right) => right.localeCompare(left))[0] ?? null;
  }

  async onboardingState(): Promise<OnboardingState> {
    const values = await readProfileValuesFile(this.#path);
    const language = own(values, 'lang');
    return {
      language: isSupportedLanguage(language) ? language : null,
      welcomeCompleted: own(values, 'welcome_shown') === true,
    };
  }

  async selectInitialLanguage(language: InitialLanguage): Promise<OnboardingState> {
    await this.#mergeValues({ lang: language });
    return this.onboardingState();
  }

  async completeWelcome(): Promise<OnboardingState> {
    await this.#mergeValues({ welcome_shown: true });
    return this.onboardingState();
  }

  async newsSeen(): Promise<boolean> {
    const values = await readProfileValuesFile(this.#path);
    const value = own(values, 'news_shown_v3.1');
    return value === true || value === 'true';
  }

  async markNewsSeen(): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, 'news_shown_v3.1': true }, null, 2)}\n`,
        randomUUID(),
      );
    });
  }

  async replaceGoogleDriveCredentials(credentials: GoogleDriveCredentials): Promise<void> {
    if (!credentials.refreshToken) {
      throw new Error('Google no ha autorizado el acceso a Drive');
    }
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      const original = own(values, 'googleTokens');
      const nextTokens: Record<string, JsonValue> = {
        access_token: credentials.accessToken,
        ...(credentials.refreshToken ? { refresh_token: credentials.refreshToken } : {}),
        ...(credentials.expiresAt !== null ? { expiry_date: credentials.expiresAt } : {}),
      };
      const serializedTokens: JsonValue =
        typeof original === 'string' ? JSON.stringify(nextTokens) : nextTokens;
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, googleTokens: serializedTokens }, null, 2)}\n`,
        randomUUID(),
      );
    });
  }

  async replaceBackupHistory(history: JsonValue): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, backupHistory: history }, null, 2)}\n`,
        randomUUID(),
      );
    });
  }

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.#writeQueue.then(() => enqueueProfileWrite(this.#path, operation));
    this.#writeQueue = pending.catch(() => undefined);
    return pending;
  }

  async #mergeValues(patch: Readonly<Record<string, JsonValue>>): Promise<void> {
    await this.#enqueue(async () => {
      const values = await readProfileValuesFile(this.#path);
      await writeFileAtomically(
        this.#path,
        `${JSON.stringify({ ...values, ...patch }, null, 2)}\n`,
        randomUUID(),
      );
    });
  }
}
