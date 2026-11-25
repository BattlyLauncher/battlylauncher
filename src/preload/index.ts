import { createIpcInvoker } from '../shared/ipc-errors';
import type { NoticeSettings as ImportedNoticeSettings } from '../shared/notifications';
import type { NoticeSnapshot as ImportedNoticeSnapshot } from '../shared/notifications';
import type { DriveTransferProgress as ImportedDriveTransferProgress } from '../shared/settings/drive-progress';
import type {
  ModBasketRequest,
  ModBasketResult,
  ModBasketProgress,
} from '../shared/mods/mod-basket';
import type { LocalModTarget } from '../shared/mods/mod-contract';
import type { JavaRuntimeProvider } from '../shared/settings/java-runtime-contract';
import type { CapeLibrarySnapshot, CapeActionResult } from '../shared/skins/skin-contract';
import type { UpdateAction, UpdateSettings, UpdateSnapshot } from '../shared/updates';
import type { ServerSoftwareAvailability } from '../shared/servers/server-contract';
import {
  normalizeServerInvitation,
  type ServerInvitation,
} from '../shared/servers/server-contract';
import type {
  WorldsEvent,
  WorldsPublicRoom,
  WorldsVoiceCommand,
  WorldsVoiceStatus,
} from '../shared/social/battly-worlds-contract';
import {
  normalizeWorldsAction,
  type WorldsAction,
  type WorldsSnapshot,
} from '../shared/social/battly-worlds-contract';
import type { DriveState } from '../shared/mybattly/mybattly-contract';
import type { BypackExportResult, BypackPreview } from '../shared/minecraft/bypack';
import type {
  InstanceContentAction,
  InstanceContentEntry,
  InstanceContentKind,
} from '../shared/minecraft/instance-content';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  normalizeMusicOverlayCommand,
  type MusicOverlaySnapshot,
  type MusicOverlayPreferences,
  type MusicOverlayCommand,
} from '../shared/music/music-overlay';

import type { AppInfo } from '../shared/app-info';
import { isBattlyProtocolAction, type BattlyProtocolAction } from '../shared/app-protocol';
import type { AccountCollection } from '../shared/accounts/account';
import type { AuthOutcome, AuthRequest } from '../shared/auth/auth-contract';
import type { VisualPreferences } from '../shared/preferences/visual-preferences';
import type { SettingsDraft, SettingsSnapshot } from '../shared/settings/settings-contract';
import type { JvmArgsConfig } from '../shared/settings/jvm-args-contract';
import type {
  BattlyDataRootSnapshot,
  DataRootProgress,
} from '../shared/settings/data-root-contract';
import {
  isManagedJavaInstallProgress,
  type ManagedJavaInstallProgress,
  type ManagedJavaMajor,
  type ManagedJavaSnapshot,
} from '../shared/settings/java-runtime-contract';
import type { DiagnosticSaveOutcome } from '../shared/diagnostics/diagnostics-contract';
import type {
  BattlyTheme,
  ThemeDraft,
  ThemeLibrarySnapshot,
  ThemeReviewResult,
  ThemeShareResult,
} from '../shared/themes/theme-contract';
import type {
  InstanceCopyRequest,
  InstanceDraft,
  InstanceSummary,
} from '../shared/minecraft/instance';
import type { BattlyCustomClient } from '../shared/minecraft/custom-client-contract';
import type { LabyModVersion } from '../shared/minecraft/labymod-contract';
import type { BattlyClientUpdateNotice } from '../shared/minecraft/battly-client-contract';
import {
  normalizePlayVersionLaunchRequest,
  type PlayVersionLaunchRequest,
  type PlayVersionSnapshot,
} from '../shared/minecraft/play-version-contract';
import type { DownloadCatalogSnapshot } from '../shared/minecraft/download-catalog-contract';
import type {
  LoaderBuildSnapshot,
  LoaderGameVersionSnapshot,
  MinecraftLoaderKind,
} from '../shared/minecraft/loader-build-contract';
import {
  isMinecraftLaunchEvent,
  type MinecraftInstanceLaunchRequest,
  type MinecraftLaunchEvent,
  type MinecraftLaunchOutcome,
} from '../shared/minecraft/launch-contract';
import type { HomeSnapshot } from '../shared/home/home-contract';
import type {
  LocalModCompatibilityFixResult,
  LocalModCompatibilityReport,
  LocalModSummary,
  ModInstallRequest,
  ModProjectDetail,
  ModProjectType,
  ModSearchRequest,
  ModSearchResult,
} from '../shared/mods/mod-contract';
import {
  isModpackInstallProgress,
  type ModpackInstallProgress,
} from '../shared/mods/modpack-install-contract';
import {
  normalizeMusicPlaybackState,
  type MusicCollaborationInvite,
  type MusicControlAction,
  type MusicFavoriteDraft,
  type MusicPlaybackState,
  type MusicPlaylist,
  type MusicPlaylistImport,
  type MusicPlaylistActivity,
  type MusicPlaylistCollaboration,
  type MusicPlaylistShare,
  type MusicPlaylistUpdateDraft,
  type MusicQuality,
  type MusicSnapshot,
  type MusicSong,
} from '../shared/music/music-contract';
import {
  normalizeRemoteLaunchRequest,
  type SocialAction,
  type SocialProfile,
  type SocialRealtimeState,
  type SocialSnapshot,
  type ProfileCustomization,
  type ProfileBackgroundSelection,
  type RemoteLaunchRequest,
} from '../shared/social/social-contract';
import type {
  MyBattlyResourcePack,
  MyBattlySnapshot,
  MyBattlyWorld,
  WorldBackupSummary,
} from '../shared/mybattly/mybattly-contract';
import type { InitialLanguage, OnboardingState } from '../shared/onboarding/onboarding-contract';
import type {
  ServerDraft,
  ServerContentEntry,
  ServerContentKind,
  ServerFileContent,
  ServerFileEntry,
  ServerInstallProgress,
  ServerInviteDraft,
  ServerPlayerListMutation,
  ServerPlayerListsSnapshot,
  ServerProperties,
  ServerRuntimeEvent,
  ServerRuntimeSnapshot,
  ServerSoftwareKind,
  ServerSharingSnapshot,
  ServerSummary,
} from '../shared/servers/server-contract';
import type { SkinActionResult, SkinLibrarySnapshot } from '../shared/skins/skin-contract';
import {
  isMinecraftCrashReport,
  isCrashRepairProgress,
  type MinecraftCrashRepairProgress,
  type MinecraftCrashRepairResult,
  type MinecraftCrashReport,
} from '../shared/minecraft/crash-report-contract';
import {
  desktopChannels,
  type BattlyDesktopApi,
  type LaunchLogDocument,
  type LaunchLogFile,
  type MrpackImportEvent,
} from '../shared/desktop-api';

function skinImageUrl(username: string): string {
  if (typeof username !== 'string' || username.length > 128 || username.includes('\0')) {
    throw new TypeError('Invalid skin username');
  }
  const base = new URL(process.env.BATTLY_SKIN_API_URL || 'https://api.battlylauncher.com/');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')) {
    throw new TypeError('Invalid skin API URL');
  }
  return new URL(`api/skin/${encodeURIComponent(username)}.png`, base).toString();
}

function faceImageUrl(username: string): string {
  if (typeof username !== 'string' || username.length > 128 || username.includes('\0')) {
    throw new TypeError('Invalid face username');
  }
  const base = new URL(process.env.BATTLY_SKIN_API_URL || 'https://api.battlylauncher.com/');
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1')) {
    throw new TypeError('Invalid skin API URL');
  }
  return new URL(`api/face/${encodeURIComponent(username)}`, base).toString();
}

const pendingBypacks: string[] = [];
const bypackListeners = new Set<(path: string) => void>();
ipcRenderer.on(desktopChannels.bypackOpenRequested, (_event, path: unknown) => {
  if (typeof path !== 'string' || path.length > 32768) {
    return;
  }
  if (!bypackListeners.size) {
    if (!pendingBypacks.includes(path) && pendingBypacks.length < 20) {
      pendingBypacks.push(path);
    }
  } else {
    bypackListeners.forEach((listener) => listener(path));
  }
});
const invokeDesktop = createIpcInvoker(ipcRenderer.invoke.bind(ipcRenderer));

const desktopApi: BattlyDesktopApi = Object.freeze({
  migratePrivatePreferences: (legacy: Readonly<Record<string, string>>) =>
    invokeDesktop('storage:renderer-migrate', legacy) as Promise<Record<string, string>>,
  setPrivatePreference: (key: string, value: string | null) =>
    invokeDesktop('storage:renderer-set', key, value) as Promise<void>,
  trackAnalyticsPanel: (panel: string) =>
    invokeDesktop(desktopChannels.analyticsPanel, panel) as Promise<void>,
  onWorldsEvent: (listener: (event: WorldsEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: WorldsEvent): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.worldsEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.worldsEvent, handler);
  },
  getWorldsPublicRooms: (page: number) =>
    invokeDesktop(desktopChannels.worldsPublicRooms, page) as Promise<WorldsPublicRoom[]>,
  worldsVoiceCommand: (command: WorldsVoiceCommand) =>
    invokeDesktop(desktopChannels.worldsVoiceCommand, command) as Promise<void>,
  worldsVoiceSignal: (to: string, signal: Record<string, unknown>) =>
    invokeDesktop(desktopChannels.worldsVoiceSignal, to, signal) as Promise<void>,
  worldsVoiceActivity: (speakers: readonly { userId: string; level: number }[]) =>
    invokeDesktop(desktopChannels.worldsVoiceActivity, speakers) as Promise<void>,
  worldsVoiceState: (status: WorldsVoiceStatus) =>
    invokeDesktop(desktopChannels.worldsVoiceState, status) as Promise<void>,
  worldsVoiceParty: (action: 'room' | 'join' | 'create', value?: string | string[]) =>
    invokeDesktop(desktopChannels.worldsVoiceParty, action, value) as Promise<void>,

  openWorldsGamePanel: () => invokeDesktop(desktopChannels.openWorldsGamePanel) as Promise<void>,
  openWorldsSource: () => invokeDesktop(desktopChannels.openWorldsSource) as Promise<void>,
  getWorldsSnapshot: () =>
    invokeDesktop(desktopChannels.getWorldsSnapshot) as Promise<WorldsSnapshot>,
  worldsAction: (action: WorldsAction) =>
    invokeDesktop(
      desktopChannels.worldsAction,
      normalizeWorldsAction(action),
    ) as Promise<WorldsSnapshot>,
  launcherReady: () => invokeDesktop(desktopChannels.launcherReady) as Promise<void>,
  getUpdates: () => invokeDesktop(desktopChannels.getUpdates) as Promise<UpdateSnapshot>,
  updateSettings: (value: UpdateSettings) =>
    invokeDesktop(desktopChannels.updateSettings, value) as Promise<UpdateSnapshot>,
  updateAction: (action: UpdateAction) =>
    invokeDesktop(desktopChannels.updateAction, action) as Promise<UpdateSnapshot>,
  onUpdateNotice: (listener: (action: 'open' | 'restart') => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: unknown): void => {
      if (action === 'open' || action === 'restart') {
        listener(action);
      }
    };
    ipcRenderer.on(desktopChannels.updateNotice, handler);
    return () => {
      ipcRenderer.removeListener(desktopChannels.updateNotice, handler);
    };
  },
  onStartupProgress: (listener: (change: { progress: number; status: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      const source = value as Record<string, unknown>;
      if (
        typeof source.progress === 'number' &&
        source.progress >= 0 &&
        source.progress <= 100 &&
        typeof source.status === 'string' &&
        source.status.length <= 200
      ) {
        listener({ progress: source.progress, status: source.status });
      }
    };
    ipcRenderer.on(desktopChannels.startupProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.startupProgress, handler);
  },
  onProtocolAction: (listener: (action: BattlyProtocolAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isBattlyProtocolAction(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.protocolAction, handler);
    return () => ipcRenderer.removeListener(desktopChannels.protocolAction, handler);
  },
  skinImageUrl,
  faceImageUrl,
  getAccounts: () => invokeDesktop(desktopChannels.getAccounts) as Promise<AccountCollection>,
  getAccountSkinUrl: (uuid: string) =>
    invokeDesktop(desktopChannels.getAccountSkinUrl, uuid) as Promise<string | null>,
  selectAccount: (uuid: string) =>
    invokeDesktop(desktopChannels.selectAccount, uuid) as Promise<AccountCollection>,
  removeAccount: (uuid: string) =>
    invokeDesktop(desktopChannels.removeAccount, uuid) as Promise<AccountCollection>,
  removeAllAccounts: () =>
    invokeDesktop(desktopChannels.removeAllAccounts) as Promise<AccountCollection>,
  startAuth: (request: AuthRequest) =>
    invokeDesktop(desktopChannels.startAuth, request) as Promise<AuthOutcome>,
  cancelAuth: () => invokeDesktop(desktopChannels.cancelAuth) as Promise<boolean>,
  getInstances: async () => {
    const result = (await invokeDesktop(desktopChannels.getInstances)) as
      readonly InstanceSummary[] | { code: 'BATTLY_PRIVATE_DATA_UNREADABLE' };
    if ('code' in result) {
      throw new Error(result.code);
    }
    return result;
  },
  createInstance: (draft: InstanceDraft) =>
    invokeDesktop(desktopChannels.createInstance, draft) as Promise<readonly InstanceSummary[]>,
  updateInstance: (id: string, draft: InstanceDraft) =>
    invokeDesktop(desktopChannels.updateInstance, id, draft) as Promise<readonly InstanceSummary[]>,
  archiveInstance: (id: string) =>
    invokeDesktop(desktopChannels.archiveInstance, id) as Promise<readonly InstanceSummary[]>,
  openInstanceFolder: (id: string) =>
    invokeDesktop(desktopChannels.openInstanceFolder, id) as Promise<void>,
  exportServerBypack: (id: string) =>
    invokeDesktop(desktopChannels.exportServerBypack, id) as Promise<BypackExportResult | null>,
  exportBypack: (id: string) =>
    invokeDesktop(desktopChannels.exportBypack, id) as Promise<BypackExportResult | null>,
  exportMrpack: (id: string) =>
    invokeDesktop(desktopChannels.exportMrpack, id) as Promise<BypackExportResult | null>,
  duplicateInstance: (id: string, request: InstanceCopyRequest) =>
    invokeDesktop(desktopChannels.duplicateInstance, id, request) as Promise<InstanceSummary>,
  revealBypack: (path: string) =>
    invokeDesktop(desktopChannels.revealBypack, path) as Promise<void>,
  getMinecraftVersionList: () =>
    invokeDesktop(desktopChannels.getMinecraftVersionList) as Promise<
      DownloadCatalogSnapshot['minecraft']
    >,
  getModDisableDependents: (filename: string, instanceId?: string) =>
    invokeDesktop(desktopChannels.getModDisableDependents, filename, instanceId) as Promise<
      readonly { filename: string; name: string }[]
    >,
  getModVersionCatalog: (projectId: string) =>
    invokeDesktop(desktopChannels.getModVersionCatalog, projectId) as Promise<
      readonly { id: string; gameVersions: readonly string[]; loaders: readonly string[] }[]
    >,
  importBypack: (source?: string | File) =>
    invokeDesktop(
      desktopChannels.importBypack,
      typeof source === 'string' || source === undefined ? source : webUtils.getPathForFile(source),
    ) as Promise<BypackPreview | null>,
  confirmBypack: (token: string) =>
    invokeDesktop(desktopChannels.confirmBypack, token) as Promise<InstanceSummary>,
  onBypackOpenRequested: (listener: (path: string) => void) => {
    bypackListeners.add(listener);
    const queued = pendingBypacks.splice(0);
    queueMicrotask(() => queued.forEach((path) => listener(path)));
    return () => {
      bypackListeners.delete(listener);
    };
  },
  onBypackProgress: (listener: (progress: ModpackInstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isModpackInstallProgress(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.bypackProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.bypackProgress, handler);
  },
  getInstanceContent: (id: string, kind: InstanceContentKind) =>
    invokeDesktop(desktopChannels.getInstanceContent, id, kind) as Promise<
      readonly InstanceContentEntry[]
    >,
  importInstanceContent: (id: string, kind: InstanceContentKind) =>
    invokeDesktop(desktopChannels.importInstanceContent, id, kind) as Promise<
      readonly InstanceContentEntry[]
    >,
  actInstanceContent: (
    id: string,
    kind: InstanceContentKind,
    name: string,
    action: InstanceContentAction,
  ) =>
    invokeDesktop(desktopChannels.actInstanceContent, id, kind, name, action) as Promise<
      readonly InstanceContentEntry[]
    >,
  openInstanceContentFolder: (
    id: string,
    kind: InstanceContentKind,
    archived?: boolean | 'backups',
  ) =>
    invokeDesktop(desktopChannels.openInstanceContentFolder, id, kind, archived) as Promise<void>,
  getCustomClients: () =>
    invokeDesktop(desktopChannels.getCustomClients) as Promise<readonly BattlyCustomClient[]>,
  getPlayVersions: () =>
    invokeDesktop(desktopChannels.getPlayVersions) as Promise<PlayVersionSnapshot>,
  getDownloadCatalog: () =>
    invokeDesktop(desktopChannels.getDownloadCatalog) as Promise<DownloadCatalogSnapshot>,
  getLoaderBuilds: (loader: MinecraftLoaderKind, minecraftVersion: string) =>
    invokeDesktop(
      desktopChannels.getLoaderBuilds,
      loader,
      minecraftVersion,
    ) as Promise<LoaderBuildSnapshot>,
  getLoaderGameVersions: (loader: MinecraftLoaderKind) =>
    invokeDesktop(
      desktopChannels.getLoaderGameVersions,
      loader,
    ) as Promise<LoaderGameVersionSnapshot>,
  installPlayClient: (id: string) =>
    invokeDesktop(desktopChannels.installPlayClient, id) as Promise<void>,
  getBattlyClientBuilds: () =>
    invokeDesktop(desktopChannels.getBattlyClientBuilds) as ReturnType<
      BattlyDesktopApi['getBattlyClientBuilds']
    >,
  installBattlyClient: (id: string) =>
    invokeDesktop(desktopChannels.installBattlyClient, id) as ReturnType<
      BattlyDesktopApi['installBattlyClient']
    >,
  getLabyModVersions: () =>
    invokeDesktop(desktopChannels.getLabyModVersions) as Promise<readonly LabyModVersion[]>,
  installLabyMod: (version: string) =>
    invokeDesktop(desktopChannels.installLabyMod, version) as Promise<{
      readonly customVersion: string;
      readonly minecraftVersion: string;
    }>,
  startPlayVersion: (request: PlayVersionLaunchRequest) =>
    invokeDesktop(desktopChannels.startPlayVersion, request) as Promise<MinecraftLaunchOutcome>,
  createPlayShortcut: (request: PlayVersionLaunchRequest, label: string) =>
    invokeDesktop(desktopChannels.createPlayShortcut, request, label) as Promise<string>,
  onDirectPlayRequested: (listener: (request: PlayVersionLaunchRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      try {
        listener(normalizePlayVersionLaunchRequest(value));
      } catch {
        // Reject malformed operating-system shortcut payloads.
      }
    };
    ipcRenderer.on(desktopChannels.directPlayRequested, handler);
    return () => ipcRenderer.removeListener(desktopChannels.directPlayRequested, handler);
  },
  installCustomClient: (id: string) =>
    invokeDesktop(desktopChannels.installCustomClient, id) as Promise<readonly InstanceSummary[]>,
  startInstance: (id: string, request?: MinecraftInstanceLaunchRequest) =>
    invokeDesktop(desktopChannels.startInstance, id, request) as Promise<MinecraftLaunchOutcome>,
  cancelLaunch: () => invokeDesktop(desktopChannels.cancelLaunch) as Promise<boolean>,
  openLaunchLogs: () => invokeDesktop(desktopChannels.openLaunchLogs) as Promise<void>,
  listLaunchLogs: () =>
    invokeDesktop(desktopChannels.listLaunchLogs) as Promise<readonly LaunchLogFile[]>,
  readLaunchLog: (id: string) =>
    invokeDesktop(desktopChannels.readLaunchLog, id) as Promise<LaunchLogDocument>,
  onLaunchEvent: (listener: (event: MinecraftLaunchEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isMinecraftLaunchEvent(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.launchEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.launchEvent, handler);
  },
  onLabyUpdateChoice: (listener: () => Promise<number>) => {
    const handler = (_event: Electron.IpcRendererEvent, id: unknown) => {
      if (typeof id !== 'string' || id.length !== 36) {
        return;
      }
      void listener()
        .then((choice) => {
          if ([0, 1, 2].includes(choice)) {
            ipcRenderer.send('labymod:update-choice', id, choice);
          }
        })
        .catch(() => {});
    };
    ipcRenderer.on('labymod:update-prompt', handler);
    return () => ipcRenderer.removeListener('labymod:update-prompt', handler);
  },
  onBattlyClientUpdateChoice: (listener: (notice: BattlyClientUpdateNotice) => Promise<number>) => {
    const handler = (_event: Electron.IpcRendererEvent, id: unknown, value: unknown) => {
      if (typeof id !== 'string' || id.length !== 36 || !value || typeof value !== 'object') {
        return;
      }
      const notice = value as BattlyClientUpdateNotice;
      if (
        typeof notice.minecraftVersion !== 'string' ||
        notice.minecraftVersion.length > 32 ||
        typeof notice.installedVersion !== 'string' ||
        notice.installedVersion.length > 64 ||
        typeof notice.clientVersion !== 'string' ||
        notice.clientVersion.length > 64 ||
        !Number.isSafeInteger(notice.installedBuild) ||
        !Number.isSafeInteger(notice.build) ||
        typeof notice.canUpdateNow !== 'boolean'
      ) {
        return;
      }
      void listener(notice)
        .then((choice) => {
          if ([0, 1, 2].includes(choice)) {
            ipcRenderer.send(desktopChannels.battlyClientUpdateChoice, id, choice);
          }
        })
        .catch(() => ipcRenderer.send(desktopChannels.battlyClientUpdateChoice, id, 1));
    };
    ipcRenderer.on(desktopChannels.battlyClientUpdatePrompt, handler);
    return () => ipcRenderer.removeListener(desktopChannels.battlyClientUpdatePrompt, handler);
  },
  onCrashReport: (listener: (report: MinecraftCrashReport) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isMinecraftCrashReport(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.crashReportEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.crashReportEvent, handler);
  },
  onCrashRepairProgress: (listener: (progress: MinecraftCrashRepairProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isCrashRepairProgress(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.crashRepairProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.crashRepairProgress, handler);
  },
  applyCrashRepair: (reportId: string, repairId: string) =>
    invokeDesktop(
      desktopChannels.applyCrashRepair,
      reportId,
      repairId,
    ) as Promise<MinecraftCrashRepairResult>,
  rollbackCrashRepair: (repairId: string) =>
    invokeDesktop(
      desktopChannels.rollbackCrashRepair,
      repairId,
    ) as Promise<MinecraftCrashRepairResult>,
  onHomeUpdated: (listener: (snapshot: HomeSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: HomeSnapshot): void =>
      listener(snapshot);
    ipcRenderer.on(desktopChannels.homeUpdated, handler);
    return () => {
      ipcRenderer.removeListener(desktopChannels.homeUpdated, handler);
    };
  },
  getHome: (translateNews?: boolean) =>
    invokeDesktop(desktopChannels.getHome, translateNews) as Promise<HomeSnapshot>,
  getNewsState: () =>
    invokeDesktop(desktopChannels.getNewsState) as Promise<{ readonly seen: boolean }>,
  completeNews: () =>
    invokeDesktop(desktopChannels.completeNews) as Promise<{ readonly seen: true }>,
  getMyBattly: () => invokeDesktop(desktopChannels.getMyBattly) as Promise<MyBattlySnapshot>,
  archiveWorld: (name: string) =>
    invokeDesktop(desktopChannels.archiveWorld, name) as Promise<readonly MyBattlyWorld[]>,
  toggleResourcePack: (name: string) =>
    invokeDesktop(desktopChannels.toggleResourcePack, name) as Promise<
      readonly MyBattlyResourcePack[]
    >,
  archiveResourcePack: (name: string) =>
    invokeDesktop(desktopChannels.archiveResourcePack, name) as Promise<
      readonly MyBattlyResourcePack[]
    >,
  getWorldBackups: () =>
    invokeDesktop(desktopChannels.getWorldBackups) as Promise<readonly WorldBackupSummary[]>,
  restoreWorldBackup: (id: string) =>
    invokeDesktop(desktopChannels.restoreWorldBackup, id) as Promise<string>,
  getBackupWorlds: () =>
    invokeDesktop(desktopChannels.getBackupWorlds) as Promise<
      readonly { name: string; instanceId: string | null; label: string }[]
    >,
  createWorldBackup: (worldName: string, instanceId?: string) =>
    invokeDesktop(desktopChannels.createWorldBackup, worldName, instanceId) as Promise<
      readonly WorldBackupSummary[]
    >,
  archiveWorldBackup: (id: string) =>
    invokeDesktop(desktopChannels.archiveWorldBackup, id) as Promise<readonly WorldBackupSummary[]>,
  getOnboarding: () => invokeDesktop(desktopChannels.getOnboarding) as Promise<OnboardingState>,
  selectInitialLanguage: (language: InitialLanguage) =>
    invokeDesktop(desktopChannels.selectInitialLanguage, language) as Promise<OnboardingState>,
  completeWelcome: () => invokeDesktop(desktopChannels.completeWelcome) as Promise<OnboardingState>,
  getServers: () => invokeDesktop(desktopChannels.getServers) as Promise<readonly ServerSummary[]>,
  getServerSoftwareAvailability: (version: string) =>
    invokeDesktop(
      desktopChannels.getServerSoftwareAvailability,
      version,
    ) as Promise<ServerSoftwareAvailability>,
  createServer: (draft: ServerDraft, software?: ServerSoftwareKind) =>
    invokeDesktop(desktopChannels.createServer, draft, software) as Promise<
      readonly ServerSummary[]
    >,
  updateServerProperties: (id: string, properties: ServerProperties) =>
    invokeDesktop(desktopChannels.updateServerProperties, id, properties) as Promise<
      readonly ServerSummary[]
    >,
  archiveServer: (id: string) =>
    invokeDesktop(desktopChannels.archiveServer, id) as Promise<readonly ServerSummary[]>,
  getServerRuntime: (id: string) =>
    invokeDesktop(desktopChannels.getServerRuntime, id) as Promise<ServerRuntimeSnapshot>,
  startServerRuntime: (id: string) =>
    invokeDesktop(desktopChannels.startServerRuntime, id) as Promise<ServerRuntimeSnapshot>,
  stopServerRuntime: (id: string) =>
    invokeDesktop(desktopChannels.stopServerRuntime, id) as Promise<ServerRuntimeSnapshot>,
  restartServerRuntime: (id: string) =>
    invokeDesktop(desktopChannels.restartServerRuntime, id) as Promise<ServerRuntimeSnapshot>,
  sendServerCommand: (id: string, command: string) =>
    invokeDesktop(desktopChannels.sendServerCommand, id, command) as Promise<void>,
  onServerRuntimeEvent: (listener: (event: ServerRuntimeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: ServerRuntimeEvent): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.serverRuntimeEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.serverRuntimeEvent, handler);
  },
  installServer: (
    id: string,
    software?: ServerSoftwareKind,
    acceptCompatiblePaper?: boolean,
    build?: string,
  ) =>
    invokeDesktop(
      desktopChannels.installServer,
      id,
      software,
      acceptCompatiblePaper,
      build,
    ) as Promise<void>,
  importServerModpack: (id: string) =>
    invokeDesktop(desktopChannels.importServerModpack, id) as Promise<string | null>,
  onServerInstallProgress: (listener: (progress: ServerInstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: ServerInstallProgress): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.serverInstallProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.serverInstallProgress, handler);
  },
  getServerPlayerLists: (id: string) =>
    invokeDesktop(desktopChannels.getServerPlayerLists, id) as Promise<ServerPlayerListsSnapshot>,
  mutateServerPlayerList: (id: string, mutation: ServerPlayerListMutation) =>
    invokeDesktop(
      desktopChannels.mutateServerPlayerList,
      id,
      mutation,
    ) as Promise<ServerPlayerListsSnapshot>,
  listServerFiles: (id: string, path: string) =>
    invokeDesktop(desktopChannels.listServerFiles, id, path) as Promise<readonly ServerFileEntry[]>,
  readServerFile: (id: string, path: string) =>
    invokeDesktop(desktopChannels.readServerFile, id, path) as Promise<ServerFileContent>,
  writeServerFile: (id: string, path: string, content: string) =>
    invokeDesktop(desktopChannels.writeServerFile, id, path, content) as Promise<ServerFileContent>,
  exportServerFile: (id: string, path: string) =>
    invokeDesktop(desktopChannels.exportServerFile, id, path) as Promise<boolean>,
  revealServerFile: (id: string, path: string) =>
    invokeDesktop(desktopChannels.revealServerFile, id, path) as Promise<void>,
  archiveServerFile: (id: string, path: string) =>
    invokeDesktop(desktopChannels.archiveServerFile, id, path) as Promise<void>,
  importServerWorld: (id: string) =>
    invokeDesktop(desktopChannels.importServerWorld, id) as Promise<boolean>,
  getServerContent: (id: string, kind: ServerContentKind) =>
    invokeDesktop(desktopChannels.getServerContent, id, kind) as Promise<
      readonly ServerContentEntry[]
    >,
  importServerContent: (id: string, kind: ServerContentKind) =>
    invokeDesktop(desktopChannels.importServerContent, id, kind) as Promise<
      readonly ServerContentEntry[] | null
    >,
  toggleServerContent: (id: string, kind: ServerContentKind, name: string) =>
    invokeDesktop(desktopChannels.toggleServerContent, id, kind, name) as Promise<
      readonly ServerContentEntry[]
    >,
  archiveServerContent: (id: string, kind: ServerContentKind, name: string) =>
    invokeDesktop(desktopChannels.archiveServerContent, id, kind, name) as Promise<
      readonly ServerContentEntry[]
    >,
  openServerContentFolder: (id: string, kind: ServerContentKind) =>
    invokeDesktop(desktopChannels.openServerContentFolder, id, kind) as Promise<void>,
  getServerSharing: (id: string) =>
    invokeDesktop(desktopChannels.getServerSharing, id) as Promise<ServerSharingSnapshot>,
  startServerTunnel: (id: string) =>
    invokeDesktop(desktopChannels.startServerTunnel, id) as Promise<ServerSharingSnapshot>,
  stopServerTunnel: (id: string) =>
    invokeDesktop(desktopChannels.stopServerTunnel, id) as Promise<ServerSharingSnapshot>,
  inviteServerFriend: (id: string, draft: ServerInviteDraft) =>
    invokeDesktop(desktopChannels.inviteServerFriend, id, draft) as Promise<ServerSharingSnapshot>,
  revokeServerPermission: (id: string, username: string) =>
    invokeDesktop(
      desktopChannels.revokeServerPermission,
      id,
      username,
    ) as Promise<ServerSharingSnapshot>,
  getCapes: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.getCapes, accountUuid) as Promise<CapeLibrarySnapshot>,
  uploadCape: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.uploadCape, accountUuid) as Promise<CapeActionResult | null>,
  setCape: (id: string, accountUuid?: string) =>
    invokeDesktop(desktopChannels.setCape, id, accountUuid) as Promise<CapeActionResult>,
  deleteCape: (id: string, accountUuid?: string) =>
    invokeDesktop(desktopChannels.deleteCape, id, accountUuid) as Promise<CapeActionResult>,
  removeCape: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.removeCape, undefined, accountUuid) as Promise<CapeActionResult>,
  getSkins: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.getSkins, accountUuid) as Promise<SkinLibrarySnapshot>,
  uploadSkin: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.uploadSkin, accountUuid) as Promise<SkinActionResult | null>,
  setSkin: (id: string, accountUuid?: string) =>
    invokeDesktop(desktopChannels.setSkin, id, accountUuid) as Promise<SkinActionResult>,
  deleteSkin: (id: string, accountUuid?: string) =>
    invokeDesktop(desktopChannels.deleteSkin, id, accountUuid) as Promise<SkinActionResult>,
  searchMods: (request: ModSearchRequest) =>
    invokeDesktop(desktopChannels.searchMods, request) as Promise<ModSearchResult>,
  getModProjectDetails: (request: ModInstallRequest) =>
    invokeDesktop(desktopChannels.getModProjectDetails, request) as Promise<ModProjectDetail>,
  installModBasket: (request: ModBasketRequest) =>
    invokeDesktop(desktopChannels.installModBasket, request) as Promise<ModBasketResult>,
  onModBasketProgress: (listener: (progress: ModBasketProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ModBasketProgress): void =>
      listener(progress);
    ipcRenderer.on(desktopChannels.modBasketProgress, handler);
    return () => {
      ipcRenderer.removeListener(desktopChannels.modBasketProgress, handler);
    };
  },
  installMod: (request: ModInstallRequest) =>
    invokeDesktop(desktopChannels.installMod, request) as Promise<{
      readonly installed: readonly string[];
    }>,
  getLocalMods: () =>
    invokeDesktop(desktopChannels.getLocalMods) as Promise<readonly LocalModSummary[]>,
  batchLocalMods: (action: 'enable' | 'disable' | 'archive', filenames: readonly string[]) =>
    invokeDesktop(desktopChannels.batchLocalMods, action, filenames) as Promise<readonly string[]>,
  toggleLocalMod: (filename: string) =>
    invokeDesktop(desktopChannels.toggleLocalMod, filename) as Promise<readonly LocalModSummary[]>,
  openModrinthProject: (id: string, projectType: ModProjectType) =>
    invokeDesktop(desktopChannels.openModrinthProject, id, projectType) as Promise<void>,
  revealLocalMod: (filename: string) =>
    invokeDesktop(desktopChannels.revealLocalMod, filename) as Promise<void>,
  openLocalMod: (filename: string) =>
    invokeDesktop(desktopChannels.openLocalMod, filename) as Promise<void>,
  archiveLocalMod: (filename: string) =>
    invokeDesktop(desktopChannels.archiveLocalMod, filename) as Promise<readonly LocalModSummary[]>,
  openModsFolder: () => invokeDesktop(desktopChannels.openModsFolder) as Promise<boolean>,
  analyzeLocalMods: () =>
    invokeDesktop(desktopChannels.analyzeLocalMods) as Promise<LocalModCompatibilityReport>,
  disableIncompatibleMods: (target?: LocalModTarget) =>
    invokeDesktop(
      desktopChannels.disableIncompatibleMods,
      target,
    ) as Promise<LocalModCompatibilityFixResult>,
  importMrpack: () =>
    invokeDesktop(desktopChannels.importMrpack) as Promise<InstanceSummary | null>,
  importDroppedMrpack: (file: File) => {
    const path = webUtils.getPathForFile(file);
    if (!path) {
      return Promise.reject(new TypeError('El archivo arrastrado no tiene una ruta local'));
    }
    return invokeDesktop(
      desktopChannels.importDroppedMrpack,
      path,
    ) as Promise<InstanceSummary | null>;
  },
  onMrpackImportEvent: (listener: (event: MrpackImportEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: MrpackImportEvent): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.mrpackImportEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.mrpackImportEvent, handler);
  },
  onModpackInstallProgress: (listener: (progress: ModpackInstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isModpackInstallProgress(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.modpackInstallProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.modpackInstallProgress, handler);
  },
  getMusic: () => invokeDesktop(desktopChannels.getMusic) as Promise<MusicSnapshot>,
  recordMusicPlay: (id: string) =>
    invokeDesktop(desktopChannels.recordMusicPlay, id) as Promise<void>,
  resolveMusicSource: (
    id: string,
    quality?: MusicQuality,
    sourceUrl?: string | null,
    refresh?: boolean,
  ) =>
    invokeDesktop(
      desktopChannels.resolveMusicSource,
      id,
      quality,
      sourceUrl,
      refresh,
    ) as Promise<string>,
  searchMusic: (query: string) =>
    invokeDesktop(desktopChannels.searchMusic, query) as Promise<readonly MusicSong[]>,
  resolveMusicMetadata: (ids: readonly string[]) =>
    invokeDesktop(desktopChannels.resolveMusicMetadata, ids) as Promise<readonly MusicSong[]>,
  rememberMusicDuration: (id: string, durationSeconds: number) =>
    invokeDesktop(desktopChannels.rememberMusicDuration, id, durationSeconds) as Promise<void>,
  getYouTubeMusicPlaylist: (url: string) =>
    invokeDesktop(desktopChannels.getYouTubeMusicPlaylist, url) as Promise<MusicPlaylistImport>,
  getSpotifyMusicPlaylist: (url: string) =>
    invokeDesktop(desktopChannels.getSpotifyMusicPlaylist, url) as Promise<MusicPlaylistImport>,
  onSpotifyMusicProgress: (listener: (progress: number) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: number): void =>
      listener(progress);
    ipcRenderer.on(desktopChannels.spotifyMusicProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.spotifyMusicProgress, handler);
  },
  getMusicFavorites: () =>
    invokeDesktop(desktopChannels.getMusicFavorites) as Promise<readonly MusicSong[]>,
  setMusicFavorite: (favorite: MusicFavoriteDraft, enabled: boolean) =>
    invokeDesktop(desktopChannels.setMusicFavorite, favorite, enabled) as Promise<
      readonly MusicSong[]
    >,
  createMusicPlaylist: (draft: {
    readonly name: string;
    readonly description: string;
    readonly songs: readonly string[];
  }) => invokeDesktop(desktopChannels.createMusicPlaylist, draft) as Promise<MusicPlaylist>,
  updateMusicPlaylist: (id: string, draft: MusicPlaylistUpdateDraft) =>
    invokeDesktop(desktopChannels.updateMusicPlaylist, id, draft) as Promise<MusicPlaylist>,
  updateMusicPlaylistSongs: (id: string, songs: readonly string[]) =>
    invokeDesktop(desktopChannels.updateMusicPlaylistSongs, id, songs) as Promise<MusicPlaylist>,
  deleteMusicPlaylist: (id: string) =>
    invokeDesktop(desktopChannels.deleteMusicPlaylist, id) as Promise<void>,
  shareMusicPlaylist: (id: string) =>
    invokeDesktop(desktopChannels.shareMusicPlaylist, id) as Promise<MusicPlaylistShare>,
  importSharedMusicPlaylist: (token: string) =>
    invokeDesktop(desktopChannels.importSharedMusicPlaylist, token) as Promise<MusicPlaylist>,
  getMusicInvites: () =>
    invokeDesktop(desktopChannels.getMusicInvites) as Promise<readonly MusicCollaborationInvite[]>,
  respondMusicInvite: (inviteId: string, action: 'accept' | 'reject') =>
    invokeDesktop(desktopChannels.respondMusicInvite, inviteId, action) as Promise<void>,
  getMusicPlaylistCollaboration: (id: string) =>
    invokeDesktop(
      desktopChannels.getMusicPlaylistCollaboration,
      id,
    ) as Promise<MusicPlaylistCollaboration>,
  inviteMusicPlaylistCollaborator: (id: string, username: string) =>
    invokeDesktop(desktopChannels.inviteMusicPlaylistCollaborator, id, username) as Promise<void>,
  cancelMusicPlaylistInvite: (id: string, inviteId: string) =>
    invokeDesktop(desktopChannels.cancelMusicPlaylistInvite, id, inviteId) as Promise<void>,
  removeMusicPlaylistCollaborator: (id: string, collaboratorId: string) =>
    invokeDesktop(
      desktopChannels.removeMusicPlaylistCollaborator,
      id,
      collaboratorId,
    ) as Promise<void>,
  getMusicPlaylistActivity: (id: string) =>
    invokeDesktop(desktopChannels.getMusicPlaylistActivity, id) as Promise<
      readonly MusicPlaylistActivity[]
    >,
  setMusicPlaybackState: (state: MusicPlaybackState) =>
    invokeDesktop(desktopChannels.musicPlaybackState, state) as Promise<void>,
  getMusicOverlay: () =>
    invokeDesktop(desktopChannels.musicOverlayGet) as Promise<MusicOverlaySnapshot>,
  configureMusicOverlay: (value: MusicOverlayPreferences) =>
    invokeDesktop(desktopChannels.musicOverlayConfigure, value) as Promise<void>,
  musicOverlayCommand: (value: MusicOverlayCommand) =>
    invokeDesktop(desktopChannels.musicOverlayCommand, value) as Promise<void>,
  onMusicOverlayChanged: (listener: (value: MusicOverlaySnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: MusicOverlaySnapshot): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.musicOverlayChanged, handler);
    return () => ipcRenderer.removeListener(desktopChannels.musicOverlayChanged, handler);
  },
  onMusicOverlayControl: (listener: (value: MusicOverlayCommand) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      try {
        listener(normalizeMusicOverlayCommand(value));
      } catch {
        /* Ignore malformed controls. */
      }
    };
    ipcRenderer.on(desktopChannels.musicOverlayControl, handler);
    return () => ipcRenderer.removeListener(desktopChannels.musicOverlayControl, handler);
  },
  getMusicPlaybackState: () =>
    invokeDesktop(desktopChannels.getMusicPlaybackState) as Promise<MusicPlaybackState>,
  sendMusicControl: (action: MusicControlAction) =>
    invokeDesktop(desktopChannels.sendMusicControl, action) as Promise<void>,
  onMusicControl: (listener: (action: MusicControlAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: unknown): void => {
      if (action === 'next' || action === 'play-pause' || action === 'previous') {
        listener(action);
      }
    };
    ipcRenderer.on(desktopChannels.musicControl, handler);
    return () => ipcRenderer.removeListener(desktopChannels.musicControl, handler);
  },
  onMusicPlaybackChanged: (listener: (state: MusicPlaybackState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      try {
        listener(normalizeMusicPlaybackState(state));
      } catch {
        // Ignore malformed events at the isolated bridge boundary.
      }
    };
    ipcRenderer.on(desktopChannels.musicPlaybackChanged, handler);
    return () => ipcRenderer.removeListener(desktopChannels.musicPlaybackChanged, handler);
  },
  getSocial: () => invokeDesktop(desktopChannels.getSocial) as Promise<SocialSnapshot>,
  searchSocialUsers: (query: string) =>
    invokeDesktop(desktopChannels.searchSocialUsers, query) as Promise<readonly string[]>,
  socialAction: (action: SocialAction, username: string) =>
    invokeDesktop(desktopChannels.socialAction, action, username) as Promise<SocialSnapshot>,
  getSocialProfile: (userId: string) =>
    invokeDesktop(desktopChannels.getSocialProfile, userId) as Promise<SocialProfile>,
  getOwnSocialProfile: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.getOwnSocialProfile, accountUuid) as Promise<SocialProfile>,
  getChatConversations: () => Promise.resolve([]),
  getChatMessages: () => Promise.resolve([]),
  sendChatMessage: () => Promise.reject(new Error('Chat is unavailable')),
  getSocialServers: () => Promise.resolve([]),
  startSocialRealtime: () => invokeDesktop(desktopChannels.startSocialRealtime) as Promise<void>,
  stopSocialRealtime: () => invokeDesktop(desktopChannels.stopSocialRealtime) as Promise<void>,
  onSocialChanged: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on(desktopChannels.socialChanged, handler);
    return () => ipcRenderer.removeListener(desktopChannels.socialChanged, handler);
  },
  getNotifications: () =>
    invokeDesktop(desktopChannels.notices) as ReturnType<BattlyDesktopApi['getNotifications']>,
  readNotification: (id: string | null) =>
    invokeDesktop(desktopChannels.noticeRead, id) as ReturnType<
      BattlyDesktopApi['readNotification']
    >,
  clearNotifications: () =>
    invokeDesktop(desktopChannels.noticeClear) as ReturnType<
      BattlyDesktopApi['clearNotifications']
    >,
  setNotificationSettings: (value: Partial<ImportedNoticeSettings>) =>
    invokeDesktop(desktopChannels.noticeSettings, value) as ReturnType<
      BattlyDesktopApi['setNotificationSettings']
    >,
  openNotificationLink: (id: string, url: string) =>
    invokeDesktop(desktopChannels.noticeLink, id, url) as ReturnType<
      BattlyDesktopApi['openNotificationLink']
    >,
  onNotifications: (listener: (state: ImportedNoticeSnapshot, openId?: string) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: ImportedNoticeSnapshot,
      openId?: string,
    ) => listener(state, openId);
    ipcRenderer.on(desktopChannels.noticeChanged, handler);
    return () => ipcRenderer.removeListener(desktopChannels.noticeChanged, handler);
  },
  onServerInvitation: (listener: (invitation: ServerInvitation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      try {
        listener(normalizeServerInvitation(value));
      } catch {
        /* Ignore malformed messages. */
      }
    };
    ipcRenderer.on(desktopChannels.serverInvitation, handler);
    return () => ipcRenderer.removeListener(desktopChannels.serverInvitation, handler);
  },
  onSocialRealtimeState: (listener: (state: SocialRealtimeState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      if (
        state === 'connected' ||
        state === 'connecting' ||
        state === 'disconnected' ||
        state === 'error' ||
        state === 'reconnecting'
      ) {
        listener(state);
      }
    };
    ipcRenderer.on(desktopChannels.socialRealtimeState, handler);
    return () => ipcRenderer.removeListener(desktopChannels.socialRealtimeState, handler);
  },
  onSupportConsentRequest: (listener: (request: { id: string; expiresAt: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (!value || typeof value !== 'object') {
        return;
      }
      const request = value as { id?: unknown; expiresAt?: unknown };
      if (
        typeof request.id === 'string' &&
        /^[a-f0-9-]{36}$/.test(request.id) &&
        typeof request.expiresAt === 'number' &&
        Number.isFinite(request.expiresAt)
      ) {
        listener({ id: request.id, expiresAt: request.expiresAt });
      }
    };
    ipcRenderer.on(desktopChannels.supportConsentRequest, handler);
    return () => ipcRenderer.removeListener(desktopChannels.supportConsentRequest, handler);
  },
  respondSupportConsent: (id: string, accepted: boolean) =>
    invokeDesktop(desktopChannels.supportConsentResponse, id, accepted) as Promise<void>,
  onRemoteLaunchRequested: (listener: (request: RemoteLaunchRequest) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      try {
        listener(normalizeRemoteLaunchRequest(value));
      } catch {
        // Ignore malformed remote requests at the preload boundary.
      }
    };
    ipcRenderer.on(desktopChannels.remoteLaunchRequested, handler);
    return () => ipcRenderer.removeListener(desktopChannels.remoteLaunchRequested, handler);
  },
  getAppInfo: () => invokeDesktop(desktopChannels.getAppInfo) as Promise<AppInfo>,
  updateDiscordPanel: (panel: string) =>
    invokeDesktop(desktopChannels.discordPanel, panel) as Promise<void>,
  getVisualPreferences: () =>
    invokeDesktop(desktopChannels.getVisualPreferences) as Promise<VisualPreferences>,
  onVisualPreferencesChanged: (listener: (visual: VisualPreferences) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, visual: VisualPreferences): void =>
      listener(visual);
    ipcRenderer.on(desktopChannels.visualPreferencesChanged, handler);
    return () => ipcRenderer.removeListener(desktopChannels.visualPreferencesChanged, handler);
  },
  getSettings: () => invokeDesktop(desktopChannels.getSettings) as Promise<SettingsSnapshot>,
  worldsDiagnostics: (action: 'status' | 'test' | 'report' | 'reset-overlay') =>
    invokeDesktop(desktopChannels.worldsDiagnostics, action) as Promise<string>,
  previewMinecraftWindow: (size: {
    windowWidth: number;
    windowHeight: number;
    persist?: boolean;
  }) =>
    invokeDesktop(desktopChannels.previewMinecraftWindow, size) as Promise<{
      width: number;
      height: number;
    } | null>,
  saveSettings: (draft: SettingsDraft) =>
    invokeDesktop(desktopChannels.saveSettings, draft) as Promise<SettingsSnapshot>,
  getJvmArgs: () => invokeDesktop(desktopChannels.getJvmArgs) as Promise<JvmArgsConfig>,
  saveJvmArgs: (config: JvmArgsConfig) =>
    invokeDesktop(desktopChannels.saveJvmArgs, config) as Promise<JvmArgsConfig>,
  getManagedJava: () =>
    invokeDesktop(desktopChannels.getManagedJava) as Promise<ManagedJavaSnapshot>,
  installManagedJava: (major: ManagedJavaMajor, provider?: JavaRuntimeProvider) =>
    invokeDesktop(
      desktopChannels.installManagedJava,
      major,
      provider,
    ) as Promise<ManagedJavaSnapshot>,
  selectManagedJava: (major: ManagedJavaMajor) =>
    invokeDesktop(desktopChannels.selectManagedJava, major) as Promise<ManagedJavaSnapshot>,
  clearManagedJava: () =>
    invokeDesktop(desktopChannels.clearManagedJava) as Promise<ManagedJavaSnapshot>,
  onManagedJavaProgress: (listener: (progress: ManagedJavaInstallProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isManagedJavaInstallProgress(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(desktopChannels.managedJavaProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.managedJavaProgress, handler);
  },
  selectJavaExecutable: () =>
    invokeDesktop(desktopChannels.selectJavaExecutable) as Promise<string | null>,
  onDataRootProgress: (listener: (progress: DataRootProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DataRootProgress): void =>
      listener(progress);
    ipcRenderer.on(desktopChannels.dataRootProgress, handler);
    return () => {
      ipcRenderer.removeListener(desktopChannels.dataRootProgress, handler);
    };
  },
  getBattlyDataRoot: () =>
    invokeDesktop(desktopChannels.getBattlyDataRoot) as Promise<BattlyDataRootSnapshot>,
  migrateBattlyDataRoot: () =>
    invokeDesktop(desktopChannels.migrateBattlyDataRoot) as Promise<BattlyDataRootSnapshot | null>,
  getDriveState: () => invokeDesktop(desktopChannels.getDriveState) as Promise<DriveState>,
  disconnectDrive: () => invokeDesktop(desktopChannels.disconnectDrive) as Promise<void>,
  openLocalBackups: () => invokeDesktop(desktopChannels.openLocalBackups) as Promise<void>,
  openDriveFolder: () => invokeDesktop(desktopChannels.openDriveFolder) as Promise<void>,
  onDriveProgress: (
    listener: (
      message: string,
      automaticState?: 'progress' | 'complete' | 'error',
      detail?: ImportedDriveTransferProgress,
    ) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (typeof value === 'string') {
        listener(value);
      } else if (value && typeof value === 'object') {
        const event = value as { message?: unknown; automaticState?: unknown; detail?: unknown };
        if (typeof event.message !== 'string') {
          return;
        }
        const state =
          event.automaticState === 'progress' ||
          event.automaticState === 'complete' ||
          event.automaticState === 'error'
            ? event.automaticState
            : undefined;
        const detail = event.detail as ImportedDriveTransferProgress | undefined;
        const validBytes =
          detail &&
          ((detail.completedBytes === undefined && detail.totalBytes === undefined) ||
            (Number.isSafeInteger(detail.completedBytes) &&
              Number.isSafeInteger(detail.totalBytes) &&
              detail.completedBytes! >= 0 &&
              detail.totalBytes! >= detail.completedBytes!));
        const valid =
          detail &&
          validBytes &&
          ['checking', 'files', 'publishing'].includes(detail.phase) &&
          Number.isSafeInteger(detail.completedFiles) &&
          Number.isSafeInteger(detail.totalFiles) &&
          detail.completedFiles >= 0 &&
          detail.totalFiles >= detail.completedFiles;
        listener(event.message, state, valid ? detail : undefined);
      }
    };
    ipcRenderer.on(desktopChannels.driveProgress, handler);
    return () => ipcRenderer.removeListener(desktopChannels.driveProgress, handler);
  },
  syncGoogleDrive: () =>
    invokeDesktop(desktopChannels.syncGoogleDrive) as Promise<{
      readonly success: boolean;
      readonly count: number;
      readonly reason?: string;
    }>,
  onGoogleDriveAuthorization: (listener: (credentials: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, credentials: unknown): void =>
      listener(credentials);
    ipcRenderer.on(desktopChannels.googleDriveAuthorization, handler);
    return () => ipcRenderer.removeListener(desktopChannels.googleDriveAuthorization, handler);
  },
  saveGoogleDriveCredentials: (value: unknown) =>
    invokeDesktop(desktopChannels.saveGoogleDriveCredentials, value) as Promise<boolean>,
  authorizeGoogleDrive: () =>
    invokeDesktop(desktopChannels.authorizeGoogleDrive) as Promise<boolean>,
  copyGoogleDriveAuthorization: () =>
    invokeDesktop(desktopChannels.copyGoogleDriveAuthorization) as Promise<boolean>,
  cancelGoogleDriveAuthorization: () =>
    invokeDesktop(desktopChannels.cancelGoogleDriveAuthorization) as Promise<void>,
  writeClipboardText: (value: string) =>
    invokeDesktop(desktopChannels.writeClipboardText, value) as Promise<boolean>,
  updateSocialProfile: (customization: ProfileCustomization, accountUuid?: string) =>
    invokeDesktop(desktopChannels.updateSocialProfile, customization, accountUuid) as Promise<void>,
  selectSocialProfileBackground: (accountUuid?: string) =>
    invokeDesktop(
      desktopChannels.selectSocialProfileBackground,
      accountUuid,
    ) as Promise<ProfileBackgroundSelection | null>,
  removeSocialProfileBackground: (accountUuid?: string) =>
    invokeDesktop(desktopChannels.removeSocialProfileBackground, accountUuid) as Promise<void>,
  prepareErrorReport: () => invokeDesktop(desktopChannels.prepareErrorReport) as Promise<string>,
  submitErrorReport: (comment: string) =>
    invokeDesktop(desktopChannels.submitErrorReport, comment) as Promise<void>,
  saveDiagnosticReport: () =>
    invokeDesktop(desktopChannels.saveDiagnosticReport) as Promise<DiagnosticSaveOutcome>,
  getThemes: () => invokeDesktop(desktopChannels.getThemes) as Promise<ThemeLibrarySnapshot>,
  getThemeMarketplace: (query: string, sort?: 'newest' | 'trending') =>
    invokeDesktop(desktopChannels.getThemeMarketplace, query, sort) as Promise<
      readonly BattlyTheme[]
    >,
  saveTheme: (draft: ThemeDraft) =>
    invokeDesktop(desktopChannels.saveTheme, draft) as Promise<ThemeLibrarySnapshot>,
  applyTheme: (id: string) =>
    invokeDesktop(desktopChannels.applyTheme, id) as Promise<ThemeLibrarySnapshot>,
  archiveTheme: (id: string) =>
    invokeDesktop(desktopChannels.archiveTheme, id) as Promise<ThemeLibrarySnapshot>,
  installMarketplaceTheme: (id: string) =>
    invokeDesktop(desktopChannels.installMarketplaceTheme, id) as Promise<ThemeLibrarySnapshot>,
  shareTheme: (id: string) =>
    invokeDesktop(desktopChannels.shareTheme, id) as Promise<ThemeShareResult>,
  requestThemeReview: (id: string) =>
    invokeDesktop(desktopChannels.requestThemeReview, id) as Promise<ThemeLibrarySnapshot>,
  getThemeReviewStatus: (id: string) =>
    invokeDesktop(desktopChannels.getThemeReviewStatus, id) as Promise<ThemeReviewResult>,
  unpublishTheme: (id: string) =>
    invokeDesktop(desktopChannels.unpublishTheme, id) as Promise<ThemeLibrarySnapshot>,
  openThemePage: (id: string) =>
    invokeDesktop(desktopChannels.openThemePage, id) as Promise<boolean>,
  importTheme: (value: { readonly code: string; readonly customName?: string }) =>
    invokeDesktop(desktopChannels.importTheme, value) as Promise<ThemeLibrarySnapshot>,
  getThemeSounds: () =>
    invokeDesktop(desktopChannels.getThemeSounds) as ReturnType<BattlyDesktopApi['getThemeSounds']>,
  selectThemeSound: () =>
    invokeDesktop(desktopChannels.selectThemeSound) as ReturnType<
      BattlyDesktopApi['selectThemeSound']
    >,
  onThemeApplied: (listener: (snapshot: ThemeLibrarySnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ThemeLibrarySnapshot): void =>
      listener(snapshot);
    ipcRenderer.on(desktopChannels.themeApplied, handler);
    return () => ipcRenderer.removeListener(desktopChannels.themeApplied, handler);
  },
  selectThemeBackground: () =>
    invokeDesktop(desktopChannels.selectThemeBackground) as Promise<string | null>,
  minimizeWindow: () => invokeDesktop(desktopChannels.minimizeWindow) as Promise<void>,
  toggleMaximizeWindow: () => invokeDesktop(desktopChannels.toggleMaximizeWindow) as Promise<void>,
  closeWindow: () => invokeDesktop(desktopChannels.closeWindow) as Promise<void>,
  openBattlyFolder: () => invokeDesktop(desktopChannels.openBattlyFolder) as Promise<boolean>,
  openDiscord: () => invokeDesktop(desktopChannels.openDiscord) as Promise<boolean>,
  openPasswordHelp: () => invokeDesktop(desktopChannels.openPasswordHelp) as Promise<boolean>,
  openBattlyRegister: () => invokeDesktop(desktopChannels.openBattlyRegister) as Promise<boolean>,
});

contextBridge.exposeInMainWorld('battly', desktopApi);
