import { musicOverlayEnabled } from '../shared/music/music-features';
import type { WorldsSnapshot as ImportedWorldsSnapshot } from '../shared/social/battly-worlds-contract';
import { MusicOverlayDesktop } from './music/music-overlay-desktop';
import { launcherMaintenance } from './config/launcher-maintenance';
import { MaintenanceWindow } from './config/maintenance-window';
import { normalizeMusicOverlayCommand } from '../shared/music/music-overlay';
import type { UsageDay as ImportedUsageDay } from '../shared/mybattly/mybattly-contract';
import { formatPlayVersion } from '../shared/minecraft/play-version-presentation';
import { ModBasketInstaller } from './mods/mod-basket-installer';
import { normalizeModBasketRequest } from '../shared/mods/mod-basket';
import { ClientBridge, type ClientOwner } from './client/client-bridge';
import { BattlyClientService } from './minecraft/battly-client-service';
import { BattlyClientUpdates } from './minecraft/battly-client-updates';
import type {
  BattlyClientBuild,
  BattlyClientUpdateNotice,
} from '../shared/minecraft/battly-client-contract';
import { BattlyClientAdapter } from './client/client-adapter';
import { IsolatedCoreAdapter } from './minecraft/isolated-core-adapter';
import {
  LaunchMemoryPreflight,
  LaunchMemoryCancelledError,
  readWindowsMemorySnapshot,
} from './minecraft/launch-memory-preflight';
import { launchMemoryDialog } from './minecraft/launch-memory-dialog';
import { writeVerifiedClipboardText } from './clipboard/write-clipboard-text';
import { remoteOperations, remoteOperation } from '../shared/social/remote-operations';
import { RemoteFiles } from './social/remote-files';
import { remoteOperationContext } from './social/remote-operation-context';
import { withWorldsLanConnection, worldsLanAgentPath } from './minecraft/worlds-lan-launch';
import { MinecraftClientReadyObserver } from './minecraft/client-ready-observer';
import { DesktopUsageClient } from './mybattly/usage-history';
let desktopUsageHistory: DesktopUsageClient | undefined;
function usageHistory(): DesktopUsageClient {
  return (desktopUsageHistory ??= new DesktopUsageClient((token, body) =>
    resolveSocialService().usageHeartbeat(token, body),
  ));
}
async function sampleDesktopUsage(): Promise<void> {
  const accounts = await resolveAccountStore().store.list();
  const selected = accounts.accounts.find(
    (account) => account.uuid === accounts.selectedAccountUuid,
  );
  const token =
    selected?.type === 'battly'
      ? await selectedBattlyIdentity(true, selected.uuid)
          .then((identity) => identity.token)
          .catch(() => '')
      : '';
  await usageHistory().sample(
    token,
    [...analyticsGames.values()].some(
      (game) => game.running > 0 && game.account === accounts.selectedAccountUuid,
    ),
    !!mainWindow?.isFocused(),
  );
}
import {
  canSkipStartupSplash,
  revealStartupMainWindow,
  startupPremium,
  StartupSplashPresentation,
} from './startup-presentation';
import { DiscordPresence } from './discord/discord-presence';
import { NativeDiscordRpc } from './discord/native-rpc';
import { TaskbarProgress } from './taskbar-progress';
import { bridgeGoogleDriveAuthorization } from './settings/google-drive-auth-bridge';
import { overlayAvatar } from './social/overlay-avatars';
import { discordLaunchScheme } from '../shared/discord-contract';
import { overlayRelease } from './social/overlay-release';
import {
  driveProgressPercent,
  type DriveTransferProgress,
} from '../shared/settings/drive-progress';
import { NotificationService } from './notifications/notification-service';
import { nativeControls } from './notifications/native-controls';
import { io as notificationSocket } from 'socket.io-client';
let publicNotificationSocket: ReturnType<typeof notificationSocket> | undefined;
let notificationChannel = () => 'stable';
async function notificationContext(): Promise<Record<string, unknown>> {
  const settings = await resolveSettingsStore().snapshot();
  const build = patchRuntime()?.snapshot().build || 1;
  return {
    version: app.getVersion(),
    build,
    patchVersion: build > 1 ? `${app.getVersion()}-patch${build}` : 'base',
    language: settings.visual.language,
    os:
      process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
    architecture: systemArch(),
    channel: notificationChannel(),
  };
}
function startPublicNotifications(): void {
  if (publicNotificationSocket || process.env.BATTLY_DISABLE_SOCIAL_REALTIME === '1') {
    return;
  }
  const socket = notificationSocket(
    process.env.BATTLY_SOCIAL_SOCKET_URL || 'https://api.battlylauncher.com/',
    {
      auth: { client: 'battly-launcher-notifications' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 30000,
      timeout: 10000,
      transports: ['websocket', 'polling'],
    },
  );
  publicNotificationSocket = socket;
  const receive = (value: unknown) => {
    void notifications()
      .publish(value)
      .catch(() => console.warn('[notifications] Invalid announcement ignored'));
  };
  socket.on('notificacion', receive);
  socket.on('notifications:sync', (value: unknown) => {
    if (Array.isArray(value) && value.length <= 100) {
      value.forEach(receive);
    }
  });
  socket.on('connect', () => {
    void notificationContext()
      .then((context) => socket.emit('notifications:sync', context))
      .catch(() => socket.emit('notifications:sync', {}));
  });
}
async function confirmExternalLink(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
    throw new TypeError('Unsupported external link');
  }
  await shell.openExternal(parsed.href);
}

async function openNoticeLink(id: unknown, url: unknown): Promise<void> {
  const allowed = await notifications().link(id, url);
  await shell.openExternal(allowed);
}
let notificationService: NotificationService | undefined;
const nativeNotices = new Set<Notification>();
function notifications(): NotificationService {
  return (notificationService ??= new NotificationService(
    join(app.getPath('userData'), 'notifications.json'),
    (state, openId) => {
      if (openId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(desktopChannels.noticeChanged, state, openId);
      }
    },
    (notice, clicked) => {
      if (!Notification.isSupported()) {
        return;
      }
      const controls = nativeControls(notice, process.platform);
      const native = new Notification({
        title: `Battly · ${notice.category === 'announcement' ? notice.title : translateNative(notice.title)}`,
        body: notice.category === 'announcement' ? notice.body : translateNative(notice.body),
        silent: false,
        icon: packagedApplication
          ? join(process.resourcesPath, 'icon.png')
          : join(app.getAppPath(), 'src/renderer/assets/icon.png'),
        actions: controls.map((control) =>
          control.type === 'selection'
            ? { type: control.type, text: control.text, items: control.items }
            : { type: control.type, text: control.text },
        ),
      });
      native.on('action', (details) => {
        const control = controls[details.actionIndex];
        const link = control?.options[control.type === 'selection' ? details.selectionIndex : 0];
        clicked();
        if (link) {
          void openNoticeLink(notice.id, link.url).catch(() =>
            console.warn('[notifications] Notification link unavailable'),
          );
        }
      });
      nativeNotices.add(native);
      if (nativeNotices.size > 100) {
        const oldest = nativeNotices.values().next().value;
        oldest?.close();
        if (oldest) {
          nativeNotices.delete(oldest);
        }
      }
      native.once('close', () => nativeNotices.delete(native));
      native.on('click', clicked);
      native.on('failed', () => {
        nativeNotices.delete(native);
        console.warn('[notifications] Native notification unavailable');
      });
      native.show();
    },
  ));
}
import { cachedPlayCatalog } from './minecraft/play-catalog-cache';
import { AccessMonitor } from './accounts/access-monitor';
import { BanWindow } from './accounts/ban-window';
let accessMonitor: AccessMonitor | undefined;
const banWindow = new BanWindow();
const maintenanceWindow = new MaintenanceWindow();
import { packagedApplication } from './runtime-mode';
import { localizedDialogs, nativeTranslator } from './i18n/native-language';
import { matchesCrashDependencyVersion } from './minecraft/crash-dependency-version';
import { systemArchitecture } from './settings/system-architecture';
import {
  requires64BitMinecraft,
  minecraft32BitNotice,
  is32BitArchitecture,
} from '../shared/minecraft/platform-compatibility';
import { chmod, readdir } from 'node:fs/promises';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from './files/atomic-file';
import { readBoundedUploadFile } from './files/read-upload-file';
import { readBoundedResponse } from './network/read-bounded-response';
import {
  initializePrivateStorage,
  migratePrivateMetadata,
} from './storage/private-storage-bootstrap';
import { RendererPreferences } from './storage/renderer-preferences';
import { migrate301Profile } from './storage/legacy-301-migration';
import { readLegacyBrowserStorage } from './storage/legacy-browser-storage';
import { migrate301Servers } from './storage/legacy-servers-migration';
let rendererPreferences: RendererPreferences | undefined;
let migratingLegacyData = true;
import { MesaRecoveryAdapter } from './minecraft/mesa-recovery-adapter';
import { createLinuxShortcut } from './files/linux-shortcut';
import { previewMinecraftWindow } from './settings/window-size-preview';
import { MesaRuntimeService } from './minecraft/mesa-runtime-service';
import { sanitizeDiagnosticValue } from './diagnostics/redaction';
import { UpdateService, patchRuntime } from './updates/update-service';
import { createUpdateNotifier } from './updates/update-notice';
import { focusStartupUpdate, showStartupUpdates } from './updates/startup-update-window';
import type { UpdateAction } from '../shared/updates';
import { defaultPrivacySettings } from '../shared/settings/settings-contract';
import {
  LauncherAnalytics,
  analyticsFailedResultCategory,
  analyticsErrorCategory,
} from './diagnostics/launcher-analytics';
import {
  arch as systemArch,
  release as systemRelease,
  totalmem as systemMemory,
  cpus as systemCpus,
} from 'node:os';
import { ErrorReportService } from './diagnostics/error-report-service';
import { createServerBypackService } from './servers/server-bypack-service';
import { WorldsDesktop } from './social/worlds-desktop';
import { normalizeVoiceCommand } from '../shared/social/battly-worlds-contract';
import { BattlyWorldsService } from './social/battly-worlds-service';
import { TerracottaRuntime } from './social/terracotta-runtime';
import { SupportConsentRequests } from './social/support-consent';
import { normalizeWorldsAction } from '../shared/social/battly-worlds-contract';
import { InstanceArtworkCache } from './minecraft/instance-artwork-cache';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyFile, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn as spawnChild } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  net,
  protocol,
  Menu,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import {
  configureConnectivity,
  connectivityFetch,
  networkAvailable,
  isNetworkFailure,
} from './network/connectivity';
import { prepareOfflineLaunch } from './minecraft/offline-launch';
import { OfflineFilesMissing } from './minecraft/offline-files';

function minecraftFailureMessage(error: unknown, fallback: string): string {
  if (
    error instanceof OfflineFilesMissing ||
    (!networkAvailable() &&
      error instanceof Error &&
      /BATTLY_OFFLINE|Validated remote JSON cache is unavailable/.test(error.message))
  ) {
    return translateNative(
      'Esta versión está incompleta. Conéctate a internet para terminar de instalarla antes de jugar sin conexión.',
    );
  }
  return fallback;
}
function emptyOfflineCatalog(error: unknown): { data: never[]; source: 'cache' } {
  if (networkAvailable() && !isNetworkFailure(error)) {
    throw error;
  }
  return { data: [], source: 'cache' };
}

configureConnectivity(() => net.isOnline());
globalThis.fetch = connectivityFetch(globalThis.fetch);

const dialog = localizedDialogs(
  async () => (await resolveSettingsStore().snapshot()).visual.language,
);
let translateNative = (source: string): string => source;

import { normalizeAppInfo } from '../shared/app-info';
import type { BattlyProtocolAction } from '../shared/app-protocol';
import { normalizeAuthRequest } from '../shared/auth/auth-contract';
import { desktopChannels } from '../shared/desktop-api';
import { minecraftCorePackageFromLauncherConfig } from '../shared/minecraft/core-package';
import {
  validateHotVersions,
  validateMinecraftVersionManifest,
} from '../shared/minecraft/download-catalog-contract';
import { normalizeLoaderBuildRequest } from '../shared/minecraft/loader-build-contract';
import { normalizeInstanceDraft, type InstanceSummary } from '../shared/minecraft/instance';
import {
  normalizeCustomClientId,
  validateBattlyCustomClients,
  type BattlyCustomClient,
} from '../shared/minecraft/custom-client-contract';
import {
  normalizeInstanceLaunchRequest,
  type MinecraftLaunchEvent,
} from '../shared/minecraft/launch-contract';
import { validateBattlyNews } from '../shared/home/home-contract';
import {
  normalizeLocalModFilename,
  normalizeModInstallRequest,
  normalizeModSearchRequest,
} from '../shared/mods/mod-contract';
import type {
  ModpackInstallProgress,
  ModpackInstallProgressSink,
} from '../shared/mods/modpack-install-contract';
import {
  defaultVisualPreferences,
  type VisualPreferences,
} from '../shared/preferences/visual-preferences';
import { normalizeSettingsDraft } from '../shared/settings/settings-contract';
import {
  normalizeManagedJavaMajor,
  normalizeJavaRuntimeProvider,
} from '../shared/settings/java-runtime-contract';
import { normalizeJvmArgsConfig } from '../shared/settings/jvm-args-contract';
import { readVisualPreferencesFile } from './preferences/visual-preferences-file';
import { createSecureWebPreferences, isTrustedRendererUrl } from './security';
import { AccountStore } from './accounts/account-store';
import { AuthCancelledError, AuthCoordinator } from './auth/auth-coordinator';
import {
  BattlyCredentialsSession,
  BattlyPasswordProvider,
  BattlyTwoFactorProvider,
  BattlyTwoFactorRequiredError,
} from './auth/battly-password-provider';
import { BattlyGoogleProvider } from './auth/battly-google-provider';
import { MicrosoftProvider } from './auth/microsoft-provider';
import { createBattlyConfigClient } from './config/battly-config';
import { battlyResourceUrls } from './config/battly-config';
import { RemoteJsonClient } from './config/remote-json-client';
import { HomeService } from './home/home-service';
import { MinecraftNewsService } from './home/minecraft-news-service';
import { MinecraftNewsTranslator } from './home/minecraft-news-translator';
import { NewsStateService } from './news/news-state-service';
import { ContentLibraryService } from './mybattly/content-library-service';
import { normalizeBackupId, normalizeContentName } from '../shared/mybattly/mybattly-contract';
import { WorldBackupService } from './mybattly/world-backup-service';
import { MinecraftCoreInstaller } from './minecraft/minecraft-core-installer';
import { MinecraftCoreRuntime } from './minecraft/minecraft-core-runtime';
import { prepareLaunchJava, installLaunchJava } from './minecraft/prepare-launch-java';
import { ensureAuthlibInjector } from './minecraft/authlib-injector-service';
import { CustomClientInstaller } from './minecraft/custom-client-installer';
import { LabyModService } from './minecraft/labymod-service';
import { normalizeLabyModVersion } from '../shared/minecraft/labymod-contract';
import { InstanceStore } from './minecraft/instance-store';
import { buildInstanceLaunchOptions } from './minecraft/instance-launch-profile';
import {
  normalizeMinecraftLaunchOptions,
  withDirectConnectArguments,
} from './minecraft/launch-options';
import {
  InstanceSafeModeService,
  type InstanceSafeModeContext,
} from './minecraft/instance-safe-mode-service';
import { LauncherService } from './minecraft/launcher-service';
import { LaunchLogService } from './minecraft/launch-log-service';
import {
  minecraftServerFromLog,
  minecraftLanPortFromLog,
  minecraftDisconnectedFromLog,
} from './minecraft/launch-events';
import {
  CrashAnalysisService,
  CrashRepairFileRequiredError,
} from './minecraft/crash-analysis-service';
import {
  normalizeCrashRepairRequest,
  normalizeCrashRepairRollback,
} from '../shared/minecraft/crash-report-contract';
import type { MinecraftLaunchExit, MinecraftLaunchOptions } from './minecraft/launcher-adapter';

import { MinecraftLauncherCoreAdapter } from './minecraft/minecraft-launcher-core-adapter';
import { LoaderBuildService } from './minecraft/loader-build-service';
import {
  customClientProfileDirectory,
  PlayVersionService,
  validateLauncherVersionCatalog,
} from './minecraft/play-version-service';
import {
  normalizePlayVersionLaunchRequest,
  type LauncherVersionEntry,
  type PlayVersionLaunchRequest,
} from '../shared/minecraft/play-version-contract';
import { LocalModStore } from './mods/local-mod-store';
import { ModInstaller } from './mods/mod-installer';
import { ModrinthClient } from './mods/modrinth-client';
import { RecommendedMods } from './mods/recommended-mods';
import { ModrinthModpackInstaller } from './mods/modrinth-modpack-installer';
import { MrpackInstaller } from './mods/mrpack-installer';
import { CurseForgeModpackInstaller } from './mods/curseforge-modpack-installer';
import { readProfileValuesFile } from './storage/profile-values-file';
import {
  emptyMusicPlaybackState,
  normalizeMusicControlAction,
  normalizeMusicFavorite,
  normalizeMusicIdentifier,
  normalizeMusicMetadataIdentifiers,
  normalizeMusicVideoIdentifier,
  normalizeMusicPlaybackState,
  normalizeMusicQuality,
  normalizeMusicSearchQuery,
  normalizeMusicUsername,
  normalizePlaylistDraft,
  normalizePlaylistSongs,
  normalizePlaylistUpdateDraft,
  type MusicPlaybackState,
} from '../shared/music/music-contract';
import { MusicService } from './music/music-service';
import { SpotifyImportService } from './music/spotify-import-service';
import { InstanceContentService } from './minecraft/instance-content-service';
import { ContentArtwork } from './minecraft/content-artwork';
import { BypackSources } from './minecraft/bypack-sources';
import { AccountPremiumService } from './accounts/account-premium-service';
import { BypackService } from './minecraft/bypack-service';
import { registerBypackAssociation } from './files/bypack-association';
import { normalizeInstanceContentKind } from '../shared/minecraft/instance-content';
import { YtDlpResolver } from './music/yt-dlp-resolver';
import { MusicAudioCache } from './music/music-audio-cache';
import { cachedAudioResponse } from './music/cached-audio-response';
import { musicTrayTemplate, musicTrayTooltip } from './music/music-tray';
import { createTrayIcon } from './music/tray-icon';
import {
  normalizeRemoteLaunchRequest,
  normalizeProfileCustomization,
  normalizeSocialAction,
  normalizeSocialUsername,
  type SocialRealtimeState,
} from '../shared/social/social-contract';
import { SocialService } from './social/social-service';
import { SocialRealtimeService } from './social/social-realtime-service';
import { SettingsStore } from './settings/settings-store';
import { WindowBehaviorService } from './settings/window-behavior-service';
import { GoogleDriveSyncService } from './settings/google-drive-sync-service';
import { BattlyDataRootService } from './settings/battly-data-root-service';
import { ManagedJavaRuntimeService } from './settings/managed-java-runtime-service';
import { StructuredLogger } from './diagnostics/structured-logger';
import { DiagnosticReportService } from './diagnostics/diagnostic-report-service';
import { normalizeInitialLanguage } from '../shared/onboarding/onboarding-contract';
import { shouldBackUpAutomatically } from '../shared/settings/automatic-backup-policy';
import {
  normalizeServerDraft,
  normalizeServerCommand,
  normalizeServerContentKind,
  normalizeServerContentName,
  normalizeServerId,
  normalizeServerInviteDraft,
  normalizeServerPlayerListMutation,
  normalizeServerProperties,
  normalizeServerSoftwareKind,
} from '../shared/servers/server-contract';
import { ServerStore } from './servers/server-store';
import { ServerRuntimeService } from './servers/server-runtime-service';
import { ServerInstallerService } from './servers/server-installer-service';
import { ServerPlayerListService } from './servers/server-player-list-service';
import { ServerFileService } from './servers/server-file-service';
import { ServerWorldImportService } from './servers/server-world-import-service';
import { serverAccountRegistry } from './servers/server-account-registry';
import { ServerContentService } from './servers/server-content-service';
import { ServerModloaderCatalog } from './servers/server-modloader-catalog';
import { ServerModloaderInstallerService } from './servers/server-modloader-installer-service';
import { ServerSharingService } from './servers/server-sharing-service';
import { battlyTunnelRuntimeOptions } from './servers/battly-tunnel-runtime';
import { normalizeSkinId } from '../shared/skins/skin-contract';
import { SkinService } from './skins/skin-service';
import { ThemeService } from './themes/theme-service';
import { normalizeThemeId } from '../shared/themes/theme-contract';
import { battlyProtocolAction, battlyProtocolArgument } from './battly-protocol';
import { StartupProgress } from './startup-progress';

app.setName('Battly Launcher');
if (process.platform === 'linux') {
  const features = app.commandLine.getSwitchValue('enable-features');
  app.commandLine.appendSwitch(
    'enable-features',
    [features, 'GlobalShortcutsPortal'].filter(Boolean).join(','),
  );
}

const isolatedUserDataPath = process.env.BATTLY_USER_DATA_PATH;
app.setPath('userData', isolatedUserDataPath || join(app.getPath('appData'), 'Battly Launcher'));

const development = process.env.BATTLY_DEV === '1';
const rendererPath = join(__dirname, '..', 'renderer', 'index.html');
const splashPath = join(__dirname, '..', 'renderer', 'splash.html');
const rendererUrl = pathToFileURL(rendererPath).toString();
let accountStoreContext: { readonly store: AccountStore; readonly writable: boolean } | undefined;
let authCoordinator: AuthCoordinator | undefined;
let minecraftCoreRuntime: MinecraftCoreRuntime | undefined;
let instanceStore: InstanceStore | undefined;
let customClientCatalog: RemoteJsonClient<readonly BattlyCustomClient[]> | undefined;
let launcherVersionCatalog: RemoteJsonClient<readonly LauncherVersionEntry[]> | undefined;
let hotVersionCatalog: RemoteJsonClient<readonly string[]> | undefined;
let minecraftVersionManifest:
  RemoteJsonClient<ReturnType<typeof validateMinecraftVersionManifest>> | undefined;
let playVersionService: PlayVersionService | undefined;
let loaderBuildService: LoaderBuildService | undefined;
let customClientInstaller: CustomClientInstaller | undefined;
let labyModService: LabyModService | undefined;
let configClient: ReturnType<typeof createBattlyConfigClient> | undefined;
let launcherService: LauncherService | undefined;
let launchRequestPreparing = false;
let selectedLaunchId: symbol | undefined;
let cancelSelectedLaunch = (): boolean => false;
const activeLaunchDirectories = new Map<symbol, { path: string; safeMode: boolean }>();
const runningMinecraftGames = new Map<
  symbol,
  { pid: number; version: string; server: string | null; lan: boolean }
>();
let worldsLaunchId: symbol | undefined;

function launchDirectoryKey(directory: string): string {
  const path = resolve(directory);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function otherDirectoryLaunches(id: symbol, directory: string) {
  const path = launchDirectoryKey(directory);
  return [...activeLaunchDirectories].filter(([key, value]) => key !== id && value.path === path);
}

function refreshPlayingServer(): void {
  const game = worldsLaunchId && runningMinecraftGames.get(worldsLaunchId);
  socialRealtimeService.updatePlayingServer(
    (game || [...runningMinecraftGames.values()].at(-1))?.server ?? null,
  );
}

function bindWorldsGame(id: symbol): void {
  const game = runningMinecraftGames.get(id);
  if (!game) {
    return;
  }
  worldsLaunchId = id;
  resolveWorldsDesktop().gameStarted(game.pid, game.version);
  if (game.lan) {
    worldsDesktop?.lanOpened();
  }
}

function hasActiveWorldsRoom(): boolean {
  return ['starting', 'scanning', 'connecting', 'hosting', 'joined'].includes(
    worldsService?.current().state ?? 'idle',
  );
}

const analyticsGames = new Map<symbol, { started: number; running: number; account?: string }>();
const pendingLabyUpdates = new Map<string, string>();
const battlyClientService = new BattlyClientService();
const battlyClientUpdates = new BattlyClientUpdates(battlyClientService);
let battlyClientUpdateInProgress: Promise<void> | null = null;
let battlyClientUpdateRetry: NodeJS.Timeout | undefined;
function runPendingBattlyClientUpdates(): void {
  if (!battlyClientUpdates.pending || runningMinecraftGames.size || battlyClientUpdateInProgress) {
    return;
  }
  if (
    launchRequestPreparing ||
    launcherService?.active ||
    labyUpdateInProgress ||
    pendingLabyUpdates.size
  ) {
    if (!battlyClientUpdateRetry) {
      battlyClientUpdateRetry = setTimeout(() => {
        battlyClientUpdateRetry = undefined;
        runPendingLabyUpdates();
      }, 2000);
      battlyClientUpdateRetry.unref();
    }
    return;
  }
  battlyClientUpdateInProgress = battlyClientUpdates
    .drain(
      () =>
        Boolean(
          runningMinecraftGames.size ||
          launchRequestPreparing ||
          launcherService?.active ||
          labyUpdateInProgress,
        ),
      async (root, build) => {
        launchRequestPreparing = true;
        const cancel = () => battlyClientService.cancel();
        cancelSelectedLaunch = cancel;
        try {
          await installBattlyClientBuild(root, build);
          notifications().action(
            'Battly Client actualizado',
            `Minecraft ${build.minecraftVersion} · ${build.clientVersion} · Build ${build.build}`,
          );
        } finally {
          launchRequestPreparing = false;
          if (cancelSelectedLaunch === cancel) {
            cancelSelectedLaunch = () => false;
          }
        }
      },
      (error) => console.error('[Battly Client] Deferred update failed', error),
    )
    .finally(() => {
      battlyClientUpdateInProgress = null;
    });
}
async function installBattlyClientBuild(
  root: string,
  build: BattlyClientBuild,
  sender?: Electron.WebContents,
): Promise<void> {
  await battlyClientService.install(build.id, root, (message, current, total) => {
    if (sender && !sender.isDestroyed()) {
      sender.send(desktopChannels.launchEvent, { type: 'progress', current, total, item: message });
    }
  });
}
function chooseBattlyClientUpdate(
  sender: Electron.WebContents,
  notice: BattlyClientUpdateNotice,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    let finished = false;
    const cleanup = () => {
      ipcMain.removeListener(desktopChannels.battlyClientUpdateChoice, receive);
      sender.removeListener('destroyed', closed);
      clearTimeout(timeout);
    };
    const finish = (choice: number) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve(choice);
    };
    const closed = () => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(new Error('No se pudo completar la operación'));
    };
    const receive = (event: Electron.IpcMainEvent, requestId: unknown, choice: unknown) => {
      if (
        event.sender !== sender ||
        requestId !== id ||
        typeof choice !== 'number' ||
        ![0, 1, 2].includes(choice)
      ) {
        return;
      }
      try {
        assertTrustedSender(event.senderFrame?.url);
      } catch {
        return;
      }
      finish(choice);
    };
    const timeout = setTimeout(closed, 300_000);
    timeout.unref();
    ipcMain.on(desktopChannels.battlyClientUpdateChoice, receive);
    sender.once('destroyed', closed);
    sender.send(desktopChannels.battlyClientUpdatePrompt, id, notice);
  });
}
let labyUpdateInProgress: Promise<void> | null = null;
let labyUpdateChoicePending = false;
function runPendingLabyUpdates(): void {
  if (!pendingLabyUpdates.size) {
    runPendingBattlyClientUpdates();
    return;
  }
  if (
    runningMinecraftGames.size ||
    launchRequestPreparing ||
    labyUpdateInProgress ||
    !pendingLabyUpdates.size
  ) {
    return;
  }
  labyUpdateInProgress = (async () => {
    for (const [version, root] of pendingLabyUpdates) {
      pendingLabyUpdates.delete(version);
      try {
        await resolveLabyModService().install(version, root, () => {});
        console.info(`[LabyMod] Background update completed for ${version}`);
      } catch (error) {
        console.error('[LabyMod] Background update failed', error);
      }
    }
  })().finally(() => {
    labyUpdateInProgress = null;
    runPendingBattlyClientUpdates();
  });
}

function trackMinecraftGame(id: symbol, event: MinecraftLaunchEvent, version: string): void {
  discordPresence.launch(id, event, version);
  if (event.type === 'process' || (event.type === 'state' && event.state === 'preparing')) {
    if (!analyticsGames.has(id)) {
      analyticsGames.set(id, { started: Date.now(), running: 0 });
      void resolveAccountStore()
        .store.list()
        .then((accounts) => {
          const game = analyticsGames.get(id);
          if (game) {
            game.account = accounts.selectedAccountUuid ?? undefined;
          }
        })
        .catch(() => undefined);
    }
  }
  const measured = analyticsGames.get(id);
  const measuredVersion =
    version.match(/(?:1\.\d+(?:\.\d+)?|\d{2}\.\d+)(?:-[a-z0-9.-]+)?/i)?.[0] || 'unknown';
  const measuredLoader =
    /neoforge|forge|fabric|quilt|optifine|labymod/i.exec(version)?.[0].toLowerCase() || 'vanilla';
  if (measured && event.type === 'client-ready' && !measured.running) {
    measured.running = Date.now();
    void sampleDesktopUsage().catch(() => undefined);
    notifications().action('Minecraft iniciado', formatPlayVersion(version));
    launcherAnalytics.track('minecraft:started', {
      version: measuredVersion,
      minecraftVersion: measuredVersion,
      loader: measuredLoader,
      startupMs: measured.running - measured.started,
    });
  }
  if (measured && (event.type === 'exit' || (event.type === 'state' && event.state === 'failed'))) {
    const failed = event.type === 'state' || (event.code !== null && event.code !== 0);
    notifications().action(
      failed ? 'Minecraft se ha cerrado con un error' : 'Minecraft cerrado',
      formatPlayVersion(version),
    );
    launcherAnalytics.track(failed ? 'minecraft:crashed' : 'minecraft:closed', {
      version: measuredVersion,
      minecraftVersion: measuredVersion,
      loader: measuredLoader,
      playtimeMs: measured.running ? Date.now() - measured.running : 0,
      durationMs: Date.now() - measured.started,
      ...(event.type === 'exit' ? { exitCode: event.code } : {}),
      ...(failed
        ? { errorCategory: event.type === 'exit' ? 'game-exit-code' : 'game-start-failed' }
        : {}),
    });
    analyticsGames.delete(id);
    void sampleDesktopUsage().catch(() => undefined);
  }
  if (event.type === 'process') {
    runningMinecraftGames.set(id, { pid: event.pid, version, server: null, lan: false });
    // Opening another game must not move an existing Worlds room/voice overlay.
    if (!worldsLaunchId || !hasActiveWorldsRoom()) {
      bindWorldsGame(id);
    }
    refreshPlayingServer();
  }
  if (
    event.type === 'exit' ||
    (event.type === 'state' && ['failed', 'exited'].includes(event.state))
  ) {
    runningMinecraftGames.delete(id);
    setTimeout(runPendingLabyUpdates, 1000);
    if (worldsLaunchId === id) {
      worldsLaunchId = undefined;
      worldsDesktop?.gameStopped();
      void resolveSettingsStore()
        .snapshot()
        .then((settings) =>
          settings.runtime.worlds.closeOnGameExit ? worldsService?.leaveRoom() : undefined,
        )
        .catch(() => undefined)
        .then(() => {
          const remaining = [...runningMinecraftGames.keys()].at(-1);
          if (!worldsLaunchId && remaining) {
            bindWorldsGame(remaining);
          }
        });
    }
    refreshPlayingServer();
  }
  const game = runningMinecraftGames.get(id);
  if (event.type === 'log' && game) {
    if (minecraftLanPortFromLog(event.message) !== null) {
      game.lan = true;
      if (worldsLaunchId === id) {
        worldsDesktop?.lanOpened();
      } else if (!hasActiveWorldsRoom()) {
        bindWorldsGame(id);
      }
    }
    if (minecraftDisconnectedFromLog(event.message)) {
      game.server = null;
      discordPresence.server(id, null);
      refreshPlayingServer();
    }
    const server = minecraftServerFromLog(event.message);
    if (server) {
      game.server = server;
      if (!/\[CHAT\]/i.test(event.message)) {
        discordPresence.server(id, server);
      }
      refreshPlayingServer();
    }
  }
}
let launchLogService: LaunchLogService | undefined;
let crashAnalysisService: CrashAnalysisService | undefined;
let launcherDescriptorKey: string | undefined;
let homeService: HomeService | undefined;
let newsStateService: NewsStateService | undefined;
let contentLibraryService: ContentLibraryService | undefined;
let worldBackupService: WorldBackupService | undefined;
let localModStore: LocalModStore | undefined;
let modInstaller: ModInstaller | undefined;
let modrinthClient: ModrinthClient | undefined;
let recommendedMods: RecommendedMods | undefined;
let instanceArtworkCache: InstanceArtworkCache | undefined;
function resolveInstanceArtworkCache(): InstanceArtworkCache {
  return (instanceArtworkCache ??= new InstanceArtworkCache(
    join(app.getPath('userData'), 'instance-artwork-cache'),
    resolveModrinthClient(),
    process.env.BATTLY_CURSEFORGE_API_URL
      ? { curseForgeApiBaseUrl: process.env.BATTLY_CURSEFORGE_API_URL }
      : {},
  ));
}
let mrpackInstaller: MrpackInstaller | undefined;
let curseForgeModpackInstaller: CurseForgeModpackInstaller | undefined;
let modrinthModpackInstaller: ModrinthModpackInstaller | undefined;
let socialService: SocialService | undefined;
let musicService: MusicService | undefined;
let spotifyImportService: SpotifyImportService | undefined;
let ytDlpResolver: YtDlpResolver | undefined;
let musicAudioCache: MusicAudioCache | undefined;
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'battly-audio',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveMusicAudioCache(): MusicAudioCache {
  musicAudioCache ??= new MusicAudioCache(join(app.getPath('userData'), 'cache', 'music-audio'));
  return musicAudioCache;
}
let settingsStore: SettingsStore | undefined;
let windowBehaviorService: WindowBehaviorService | undefined;
let googleDriveSyncService: GoogleDriveSyncService | undefined;
let rootMigrationActive = false;
let activeIpcOperations = 0;
let rootMigrationPicking = false;
let battlyDataRootService: BattlyDataRootService | undefined;
const taskbarProgress = new TaskbarProgress((value) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(value, {
      mode: value < 0 ? 'none' : value > 1 ? 'indeterminate' : 'normal',
    });
  }
});
const progressChannels = new Set<string>([
  desktopChannels.installModBasket,
  desktopChannels.installMod,
  desktopChannels.installServer,
  desktopChannels.startPlayVersion,
  desktopChannels.startInstance,
  desktopChannels.installManagedJava,
  desktopChannels.importMrpack,
  desktopChannels.importDroppedMrpack,
  desktopChannels.exportBypack,
  desktopChannels.exportServerBypack,
  desktopChannels.confirmBypack,
  desktopChannels.syncGoogleDrive,
  desktopChannels.createWorldBackup,
  desktopChannels.restoreWorldBackup,
]);
let managedJavaRuntimeService: ManagedJavaRuntimeService | undefined;
let activeContentRootPath: string | undefined;
let structuredLogger: StructuredLogger | undefined;
let diagnosticReportService: DiagnosticReportService | undefined;
let serverStore: ServerStore | undefined;
let serverRuntimeService: ServerRuntimeService | undefined;
let serverInstallerService: ServerInstallerService | undefined;
let serverPlayerListService: ServerPlayerListService | undefined;
let serverFileService: ServerFileService | undefined;
let serverWorldImportService: ServerWorldImportService | undefined;
let serverContentService: ServerContentService | undefined;
let serverModloaderInstallerService: ServerModloaderInstallerService | undefined;
let serverSharingService: ServerSharingService | undefined;
let skinService: SkinService | undefined;
let themeService: ThemeService | undefined;
const supportConsentRequests = new SupportConsentRequests();
const socialRealtimeService = new SocialRealtimeService(
  undefined,
  notificationContext,
  async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return false;
    }
    const owner = mainWindow;
    const closed = (): void => supportConsentRequests.cancel();
    owner.once('closed', closed);
    let notification: Notification | undefined;
    try {
      return await supportConsentRequests.request(owner.webContents.id, (request) => {
        owner.webContents.send(desktopChannels.supportConsentRequest, request);
        if (Notification.isSupported()) {
          try {
            notification = new Notification({
              title: translateNative('Asistencia de Battly'),
              body: translateNative('¿Permitir una sesión de asistencia remota?'),
              icon: packagedApplication
                ? join(process.resourcesPath, 'icon.png')
                : join(app.getAppPath(), 'src/renderer/assets/icon.png'),
            });
            notification.on('click', () => {
              if (!owner.isDestroyed()) {
                owner.show();
                owner.focus();
              }
            });
            notification.show();
          } catch {
            // The in-app request remains usable when system notifications are unavailable.
            notification = undefined;
          }
        }
      });
    } finally {
      owner.removeListener('closed', closed);
      notification?.close();
    }
  },
);
const discordRpc = new NativeDiscordRpc(undefined, undefined, undefined, (status) => {
  void resolveStructuredLogger()
    .log('info', 'discord.presence', { status })
    .catch(() => undefined);
});
const discordPresence = new DiscordPresence(discordRpc, (source) => translateNative(source));
discordRpc.subscribe((event, data) => {
  if (
    event === 'ACTIVITY_JOIN' &&
    typeof data.secret === 'string' &&
    /^[a-f0-9]{64}$/.test(data.secret)
  ) {
    sendProtocolAction({ type: 'worlds-discord', secret: data.secret });
  }
  if (event === 'ACTIVITY_JOIN_REQUEST') {
    const user = data.user as { id?: unknown } | undefined;
    if (typeof user?.id !== 'string' || !/^\d{17,20}$/.test(user.id)) {
      return;
    }
    const id = user.id;
    void (async () => {
      const privacy = (await resolveSettingsStore().snapshot()).privacy;
      const allowed =
        privacy.discordShareStatus &&
        privacy.discordShareServer &&
        (await resolveWorldsService().discordRequest(await selectedBattlyIdentity(), id));
      discordRpc.command(allowed ? 'SEND_ACTIVITY_JOIN_INVITE' : 'CLOSE_ACTIVITY_REQUEST', id);
    })().catch(() => discordRpc.command('CLOSE_ACTIVITY_REQUEST', id));
  }
});
async function refreshDiscordIdentity(): Promise<void> {
  const account = await resolveAccountStore()
    .store.selectedInternal()
    .catch(() => null);
  discordPresence.identity(app.getVersion(), typeof account?.name === 'string' ? account.name : '');
}
let discordRoomCode = '';
let discordRoomRetryAt = 0;
async function updateDiscordWorlds(snapshot: ImportedWorldsSnapshot): Promise<void> {
  discordPresence.worlds(snapshot);
  if (!['hosting', 'joined'].includes(snapshot.state)) {
    discordRoomCode = '';
    discordRoomRetryAt = 0;
    discordPresence.joinSecret('');
    return;
  }
  const privacy = (await resolveSettingsStore().snapshot()).privacy;
  if (
    !privacy.discordShareStatus ||
    !privacy.discordShareServer ||
    (snapshot.code === discordRoomCode && Date.now() < discordRoomRetryAt)
  ) {
    return;
  }
  if (discordRoomCode !== snapshot.code) {
    discordPresence.joinSecret('');
  }
  discordRoomCode = snapshot.code;
  discordRoomRetryAt = Date.now() + 30000;
  try {
    const secret = await resolveWorldsService().discordSecret(
      await selectedBattlyIdentity(),
      snapshot.code,
    );
    if (
      worldsService &&
      ['hosting', 'joined'].includes(worldsService.current().state) &&
      worldsService.current().code === snapshot.code
    ) {
      discordPresence.joinSecret(secret);
      discordRoomRetryAt = Date.now() + 60000;
    }
  } catch {
    /* Older APIs must never expose an unrestricted room code as a fallback. */
  }
}
let musicTray: Tray | undefined;
let musicOverlay: MusicOverlayDesktop | undefined;
let musicWindow: BrowserWindow | undefined;
let musicControlTarget: Electron.WebContents | undefined;
let musicPlaybackState: MusicPlaybackState = emptyMusicPlaybackState;
let mainWindow: BrowserWindow | undefined;
let splashWindow: BrowserWindow | undefined;
let splashPresentation: StartupSplashPresentation | undefined;
let pendingMrpackPath: string | undefined;
const pendingBypackReviews = new WeakMap<
  Electron.WebContents,
  {
    token: string;
    path: string;
    manifestHash: string;
    expires: number;
    artwork?: InstanceSummary['artwork'];
  }
>();
let pendingPlayRequest: PlayVersionLaunchRequest | undefined;
let pendingProtocolAction: BattlyProtocolAction | undefined;
const installingServerRuntimes = new Set<string>();

const startupProgress = new StartupProgress((change) => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(desktopChannels.startupProgress, change);
  }
});

const directPlayArgumentPrefix = '--battly-play=';

function directPlayArgument(argv: readonly string[]): PlayVersionLaunchRequest | undefined {
  const argument = argv.find((value) => value.startsWith(directPlayArgumentPrefix));
  if (!argument) {
    return undefined;
  }
  const encoded = argument.slice(directPlayArgumentPrefix.length);
  if (!encoded || encoded.length > 8192) {
    return undefined;
  }
  try {
    return normalizePlayVersionLaunchRequest(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown,
    );
  } catch {
    return undefined;
  }
}

function sendProtocolAction(action: BattlyProtocolAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingProtocolAction = action;
    return;
  }
  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
  mainWindow.webContents.send(desktopChannels.protocolAction, action);
}

function shortcutLabel(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid shortcut label');
  }
  const label = value.trim();
  if (!label || label.length > 128 || label.includes('\0')) {
    throw new TypeError('Invalid shortcut label');
  }
  return label;
}

function shortcutFilename(label: string): string {
  const withoutControls = [...label]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('');
  const safe = withoutControls
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return safe || 'Minecraft';
}

function mrpackArgument(argv: readonly string[]): string | undefined {
  return argv.find(
    (value) => isAbsolute(value) && ['.mrpack', '.bypack'].includes(extname(value).toLowerCase()),
  );
}

function modpackProgressTo(target: Electron.WebContents): ModpackInstallProgressSink {
  let completed = false;
  return (progress: ModpackInstallProgress): void => {
    taskbarProgress.update(progress.current, progress.total);
    if (progress.phase === 'complete' && !completed) {
      completed = true;
      notifications().action(
        'Modpack instalado',
        progress.pack?.name || progress.message || 'Battly',
      );
    }
    if (!target.isDestroyed()) {
      target.send(desktopChannels.modpackInstallProgress, progress);
    }
  };
}

async function installMrpackPath(
  value: unknown,
  onProgress?: ModpackInstallProgressSink,
): Promise<InstanceSummary> {
  if (
    typeof value !== 'string' ||
    value.length > 4096 ||
    !isAbsolute(value) ||
    extname(value).toLowerCase() !== '.mrpack'
  ) {
    throw new TypeError('Invalid mrpack path');
  }
  const path = resolve(value);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError('Mrpack must be a regular file');
  }
  return resolveInstanceArtworkCache().enrich(
    await resolveMrpackInstaller().install(path, undefined, onProgress),
  );
}

async function installLocalModpackPath(
  value: unknown,
  onProgress?: ModpackInstallProgressSink,
): Promise<InstanceSummary> {
  if (typeof value !== 'string' || value.length > 4096 || !isAbsolute(value)) {
    throw new TypeError('Invalid modpack path');
  }
  const path = resolve(value);
  const extension = extname(path).toLowerCase();
  if (extension === '.bypack') {
    throw new Error('El Battly Pack requiere confirmación antes de instalarse');
  }
  if (extension === '.mrpack') {
    return installMrpackPath(path, onProgress);
  }
  if (extension !== '.zip') {
    throw new TypeError('Unsupported modpack archive');
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError('Modpack must be a regular file');
  }
  return resolveInstanceArtworkCache().enrich(
    await resolveCurseForgeModpackInstaller().install(
      path,
      undefined,
      onProgress,
      async (instance) => {
        const progress = {
          phase: 'reading' as const,
          current: 1,
          total: 1,
          item: instance.name,
          message: `Manifiesto leído: ${instance.name}`,
        };
        onProgress?.({ ...progress, pack: instance });
        const enriched = await resolveInstanceArtworkCache()
          .enrich(instance)
          .catch(() => instance);
        onProgress?.({ ...progress, pack: enriched });
      },
    ),
  );
}

async function installExternalMrpack(path: string): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    pendingMrpackPath = path;
    return;
  }
  window.show();
  window.focus();
  if (extname(path).toLowerCase() === '.bypack') {
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', () => void installExternalMrpack(path));
      return;
    }
    window.webContents.send(desktopChannels.bypackOpenRequested, path);
    return;
  }
  try {
    const instance = await taskbarProgress.run(() =>
      installLocalModpackPath(path, modpackProgressTo(window.webContents)),
    );
    window.webContents.send(desktopChannels.mrpackImportEvent, { ok: true, instance });
  } catch {
    window.webContents.send(desktopChannels.mrpackImportEvent, {
      ok: false,
      message: 'No se pudo instalar el ModPack recibido',
    });
  }
}

function sendDirectPlayRequest(request: PlayVersionLaunchRequest): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) {
    pendingPlayRequest = request;
    return;
  }
  window.show();
  window.focus();
  window.webContents.send(desktopChannels.directPlayRequested, request);
}

function legacyStorePath(): string {
  return (
    process.env.BATTLY_LEGACY_STORE_PATH ||
    join(app.getPath('appData'), 'BattlyLauncher', 'battly-data.json')
  );
}

function remakeStorePath(): string {
  return process.env.BATTLY_PROFILE_STORE_PATH || join(app.getPath('userData'), 'battly-data.json');
}

function visualPreferenceStorePath(): string {
  return remakeStorePath();
}

function resolveInstanceStore(): InstanceStore {
  instanceStore ??= new InstanceStore(
    instancesPath(),
    process.env.BATTLY_INSTANCE_ARCHIVE_PATH || join(app.getPath('userData'), 'instance-archive'),
  );
  return instanceStore;
}

async function protectContentMetadata(): Promise<void> {
  await migratePrivateMetadata(instancesPath(), ['instance.json']);
  await migratePrivateMetadata(
    process.env.BATTLY_INSTANCE_ARCHIVE_PATH || join(app.getPath('userData'), 'instance-archive'),
    ['instance.json'],
  );
  await migratePrivateMetadata(
    process.env.BATTLY_SERVERS_PATH ||
      join(contentRootPath(), 'battly', 'servers', 'battlyservers.net'),
    ['server.json', 'sharing.json'],
  );
  await migratePrivateMetadata(
    process.env.BATTLY_SERVER_ARCHIVE_PATH || join(app.getPath('userData'), 'server-archive'),
    ['server.json', 'sharing.json'],
  );
}

function resolveCustomClientCatalog(): RemoteJsonClient<readonly BattlyCustomClient[]> {
  const fixtureUrl = process.env.BATTLY_VERSIONS_URL;
  customClientCatalog ??= new RemoteJsonClient({
    url: fixtureUrl || battlyResourceUrls.launcherVersions,
    cachePath: join(app.getPath('userData'), 'cache', 'custom-clients.json'),
    validate: validateBattlyCustomClients,
    timeoutMs: 10_000,
    maxBytes: 4 * 1024 * 1024,
    allowLoopbackHttp: Boolean(fixtureUrl),
  });
  return customClientCatalog;
}

function resolveLauncherVersionCatalog(): RemoteJsonClient<readonly LauncherVersionEntry[]> {
  launcherVersionCatalog ??= new RemoteJsonClient({
    url: process.env.BATTLY_VERSIONS_URL || battlyResourceUrls.launcherVersions,
    cachePath: join(app.getPath('userData'), 'cache', 'play-versions.json'),
    validate: validateLauncherVersionCatalog,
    timeoutMs: 10_000,
    maxBytes: 4 * 1024 * 1024,
    allowLoopbackHttp: Boolean(process.env.BATTLY_VERSIONS_URL),
  });
  return launcherVersionCatalog;
}

function resolveMinecraftVersionManifest(): RemoteJsonClient<
  ReturnType<typeof validateMinecraftVersionManifest>
> {
  const fixtureUrl = process.env.BATTLY_MINECRAFT_VERSION_MANIFEST_URL;
  minecraftVersionManifest ??= new RemoteJsonClient({
    url: fixtureUrl || 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    cachePath: join(app.getPath('userData'), 'cache', 'minecraft-version-manifest.json'),
    validate: validateMinecraftVersionManifest,
    timeoutMs: 10_000,
    maxBytes: 4 * 1024 * 1024,
    allowLoopbackHttp: Boolean(fixtureUrl),
  });
  return minecraftVersionManifest;
}

function resolvePlayVersionService(): PlayVersionService {
  playVersionService ??= new PlayVersionService(
    join(contentRootPath(), 'versions'),
    remakeStorePath(),
    join(contentRootPath(), 'loader'),
  );
  return playVersionService;
}

function resolveLoaderBuildService(): LoaderBuildService {
  loaderBuildService ??= new LoaderBuildService();
  return loaderBuildService;
}

function resolveCustomClientInstaller(): CustomClientInstaller {
  customClientInstaller ??= new CustomClientInstaller();
  return customClientInstaller;
}

function resolveLabyModService(): LabyModService {
  labyModService ??= new LabyModService();
  return labyModService;
}

function instancesPath(): string {
  return process.env.BATTLY_INSTANCES_PATH || join(app.getPath('appData'), '.battly', 'instances');
}

function resolveLaunchLogService(): LaunchLogService {
  launchLogService ??= new LaunchLogService(
    process.env.BATTLY_LAUNCH_LOGS_PATH || join(app.getPath('userData'), 'logs', 'minecraft'),
  );
  return launchLogService;
}

function resolveCrashAnalysisService(): CrashAnalysisService {
  crashAnalysisService ??= new CrashAnalysisService(
    resolveSettingsStore(),
    resolveInstanceStore(),
    async ({ dependencyId, requiredVersion, gameVersion, loader, gameDirectory, onProgress }) => {
      onProgress?.('searching', dependencyId);
      const query = dependencyId === 'fabric-resource-loader-v0' ? 'fabric-api' : dependencyId;
      // Resolve an exact project slug, never the first fuzzy search result.
      const versions = await resolveModrinthClient().projectVersions(query, gameVersion, loader);
      const version = versions.find(
        (entry) =>
          entry.gameVersions.includes(gameVersion) &&
          entry.loaders.includes(loader) &&
          matchesCrashDependencyVersion(entry.versionNumber, requiredVersion),
      );
      if (!version) {
        throw new Error(
          `No hay una edición verificada de ${dependencyId} (${requiredVersion}) para Minecraft ${gameVersion} y ${loader}. Puedes desactivar temporalmente el mod que la necesita.`,
        );
      }
      onProgress?.('installing', dependencyId);
      const outcome = await new ModInstaller(resolveModrinthClient(), gameDirectory).install(
        {
          projectId: version.projectId,
          versionId: version.id,
          gameVersion,
          loader,
          projectType: 'mod',
        },
        undefined,
        undefined,
        (filename) => onProgress?.('installing', filename),
      );
      return outcome.installed.map((filename) => join(gameDirectory, 'mods', filename));
    },
  );
  return crashAnalysisService;
}

function defaultContentRootPath(): string {
  return join(app.getPath('appData'), '.battly');
}

function contentRootPath(): string {
  return process.env.BATTLY_CONTENT_ROOT || activeContentRootPath || defaultContentRootPath();
}

async function bundledAuthlibInjectorPath(): Promise<string> {
  const resource = join(process.resourcesPath, 'authlib-injector.jar');
  return (await pathExists(resource))
    ? resource
    : join(__dirname, '..', '..', 'authlib-injector.jar');
}

function resolveBattlyDataRootService(): BattlyDataRootService {
  battlyDataRootService ??= new BattlyDataRootService(
    join(app.getPath('userData'), 'data-root.json'),
    defaultContentRootPath(),
    (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(desktopChannels.dataRootProgress, progress);
      }
    },
  );
  return battlyDataRootService;
}

async function battlyDataRootSnapshot() {
  if (process.env.BATTLY_CONTENT_ROOT) {
    return {
      configurable: false,
      currentPath: resolve(process.env.BATTLY_CONTENT_ROOT),
      defaultPath: defaultContentRootPath(),
      custom: true,
    } as const;
  }
  return resolveBattlyDataRootService().snapshot();
}

function resolveServerStore(): ServerStore {
  serverStore ??= new ServerStore(
    process.env.BATTLY_SERVERS_PATH ||
      join(contentRootPath(), 'battly', 'servers', 'battlyservers.net'),
    process.env.BATTLY_SERVER_ARCHIVE_PATH || join(app.getPath('userData'), 'server-archive'),
    process.env.BATTLY_DISABLE_SERVER_RUNTIME === '1'
      ? undefined
      : serverAccountRegistry(
          async () => (await selectedBattlyIdentity(true)).token,
          process.env.BATTLY_SERVER_SHARING_API_URL || 'https://api.battlylauncher.com',
        ),
  );
  return serverStore;
}

async function syncServerConfigurations(id: string, file?: string): Promise<void> {
  if (process.env.BATTLY_SERVER_FIXTURE_ROOT || installingServerRuntimes.has(id)) {
    return;
  }
  try {
    const token = await selectedBattlyToken();
    if (installingServerRuntimes.has(id)) {
      return;
    }
    await resolveServerSharingService().uploadConfigurations(id, token, file);
  } catch {
    const message = {
      type: 'log',
      id,
      stream: 'system',
      line: 'La configuración está guardada localmente, pero no se ha podido sincronizar con Battly Servers.',
    };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(desktopChannels.serverRuntimeEvent, message);
    }
  }
}

function resolveServerRuntimeService(): ServerRuntimeService {
  if (serverRuntimeService) {
    return serverRuntimeService;
  }
  const fixtureScript = [
    "process.stdout.write('Done (fixture)! For help, type help\\n')",
    "process.stdout.write('There are 0 of a max of 20 players online\\n')",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data',value=>{for(const line of value.split(/\\r?\\n/)){const command=line.trim();if(command.toLowerCase()==='stop')process.exit(0);if(command)process.stdout.write('[Server thread/INFO]: '+command+'\\n')}})",
    'setInterval(()=>{},1000)',
  ].join(';');
  serverRuntimeService = new ServerRuntimeService(resolveServerStore(), {
    ...(process.env.BATTLY_SERVER_JAVA_PATH
      ? { javaPath: process.env.BATTLY_SERVER_JAVA_PATH }
      : {}),
    ...(process.env.BATTLY_DISABLE_SERVER_RUNTIME === '1'
      ? {
          spawnServer: (_executable, _args, options) =>
            spawnChild(process.execPath, ['-e', fixtureScript], {
              ...options,
              env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
              shell: false,
              stdio: ['pipe', 'pipe', 'pipe'],
            }),
        }
      : {}),
  });
  serverRuntimeService.subscribe((runtimeEvent) => {
    if (runtimeEvent.type === 'snapshot') {
      discordPresence.hosting(runtimeEvent.snapshot);
    }
    if (runtimeEvent.type === 'log') {
      const joined = runtimeEvent.line.match(/\b([a-zA-Z0-9_]{1,16}) joined the game/);
      if (joined) {
        const name = joined[1];
        void resolveServerPlayerListService()
          .snapshot(runtimeEvent.id)
          .then((snapshot) => {
            if (
              snapshot.lists.blacklist.some(
                (player) => player.name.toLowerCase() === name.toLowerCase(),
              )
            ) {
              serverRuntimeService?.command(runtimeEvent.id, `kick ${name} Lista negra de Battly`);
            }
          })
          .catch(() => undefined);
      }
    }
    if (
      runtimeEvent.type === 'snapshot' &&
      ['stopping', 'stopped', 'error'].includes(runtimeEvent.snapshot.status)
    ) {
      void serverSharingService?.stopTunnel(runtimeEvent.snapshot.id).catch(() => undefined);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(desktopChannels.serverRuntimeEvent, runtimeEvent);
      }
    }
  });
  return serverRuntimeService;
}

function serverInstallerFixtureFetch(): typeof fetch {
  const serverJar = 'fixture server';
  const fabricJar = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x46, 0x41, 0x42]);
  const paperJar = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x50, 0x41, 0x50]);
  const forgeInstaller = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x46, 0x4f, 0x52]);
  const neoForgeInstaller = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x4e, 0x45, 0x4f]);
  const buildTools = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x42, 0x55, 0x49]);
  const java = 'fixture java';
  const checksum = (value: string | Buffer, algorithm: 'sha1' | 'sha256' = 'sha1'): string =>
    createHash(algorithm).update(value).digest('hex');
  return (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const values = new Map<string, unknown>([
      [
        'https://fixture.battly.test/versions',
        {
          versions: [{ id: '1.20.1', url: 'https://fixture.battly.test/version-metadata' }],
        },
      ],
      [
        'https://fixture.battly.test/version-metadata',
        {
          downloads: {
            server: {
              url: 'https://fixture.battly.test/server.jar',
              sha1: checksum(serverJar),
              size: Buffer.byteLength(serverJar),
            },
          },
          javaVersion: { component: 'fixture-java' },
        },
      ],
      [
        'https://fixture.battly.test/runtime-index',
        {
          'windows-x64': {
            'fixture-java': [{ manifest: { url: 'https://fixture.battly.test/runtime-manifest' } }],
            'java-runtime-delta': [
              {
                version: { name: '21.0.7-e2e' },
                manifest: { url: 'https://fixture.battly.test/runtime-manifest' },
              },
            ],
          },
        },
      ],
      [
        'https://fixture.battly.test/runtime-manifest',
        {
          files: {
            'bin/java.exe': {
              type: 'file',
              executable: true,
              downloads: {
                raw: {
                  url: 'https://fixture.battly.test/java.exe',
                  sha1: checksum(java),
                  size: Buffer.byteLength(java),
                },
              },
            },
            'bin/javaw.exe': {
              type: 'file',
              executable: true,
              downloads: {
                raw: {
                  url: 'https://fixture.battly.test/java.exe',
                  sha1: checksum(java),
                  size: Buffer.byteLength(java),
                },
              },
            },
          },
        },
      ],
      [
        'https://meta.fabricmc.net/v2/versions/loader/1.20.1',
        [{ loader: { version: '0.16.14', stable: true } }],
      ],
      ['https://meta.fabricmc.net/v2/versions/installer', [{ version: '1.0.3', stable: true }]],
      [
        'https://fill.papermc.io/v3/projects/paper/versions/1.20.1/builds',
        [
          {
            id: 196,
            channel: 'STABLE',
            downloads: {
              'server:default': {
                url: 'https://fixture.battly.test/paper.jar',
                checksums: { sha256: checksum(paperJar, 'sha256') },
                size: paperJar.byteLength,
              },
            },
          },
        ],
      ],
      [
        'https://fixture.battly.test/forge-promotions',
        { promos: { '1.20.1-recommended': '47.4.10' } },
      ],
    ]);
    if (url === 'https://fixture.battly.test/server.jar') {
      return Promise.resolve(new Response(serverJar));
    }
    if (url === 'https://fixture.battly.test/java.exe') {
      return Promise.resolve(new Response(java));
    }
    if (url === 'https://fixture.battly.test/paper.jar') {
      return Promise.resolve(new Response(paperJar));
    }
    if (url.endsWith('forge-1.20.1-47.4.10-installer.jar')) {
      return Promise.resolve(new Response(forgeInstaller));
    }
    if (url.endsWith('forge-1.20.1-47.4.10-installer.jar.sha1')) {
      return Promise.resolve(new Response(checksum(forgeInstaller)));
    }
    if (url.endsWith('neoforge/maven-metadata.xml')) {
      return Promise.resolve(
        new Response(
          '<metadata><versioning><versions><version>20.1.120</version></versions></versioning></metadata>',
        ),
      );
    }
    if (url.endsWith('neoforge-20.1.120-installer.jar')) {
      return Promise.resolve(new Response(neoForgeInstaller));
    }
    if (url.endsWith('neoforge-20.1.120-installer.jar.sha1')) {
      return Promise.resolve(new Response(checksum(neoForgeInstaller)));
    }
    if (url === 'https://fixture.battly.test/BuildTools.jar') {
      return Promise.resolve(new Response(buildTools));
    }
    if (url === 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.14/1.0.3/server/jar') {
      return Promise.resolve(
        new Response(fabricJar, {
          headers: { 'content-length': String(fabricJar.byteLength) },
        }),
      );
    }
    const value = values.get(url);
    return Promise.resolve(
      value === undefined
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }),
    );
  };
}

function resolveServerInstallerService(): ServerInstallerService {
  if (serverInstallerService) {
    return serverInstallerService;
  }
  const fixture = process.env.BATTLY_DISABLE_SERVER_RUNTIME === '1';
  serverInstallerService = new ServerInstallerService(resolveServerStore(), {
    ...(fixture
      ? {
          fetchImplementation: serverInstallerFixtureFetch(),
          platform: 'win32' as const,
          architecture: 'x64' as const,
          versionManifestUrl: 'https://fixture.battly.test/versions',
          runtimeIndexUrl: 'https://fixture.battly.test/runtime-index',
        }
      : {}),
    ...(process.env.BATTLY_SERVER_VERSION_MANIFEST_URL
      ? { versionManifestUrl: process.env.BATTLY_SERVER_VERSION_MANIFEST_URL }
      : {}),
    ...(process.env.BATTLY_SERVER_RUNTIME_INDEX_URL
      ? { runtimeIndexUrl: process.env.BATTLY_SERVER_RUNTIME_INDEX_URL }
      : {}),
  });
  serverInstallerService.subscribe((progress) => {
    taskbarProgress.update(progress.completedBytes, progress.totalBytes);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(desktopChannels.serverInstallProgress, progress);
      }
    }
  });
  return serverInstallerService;
}

function resolveServerModloaderInstallerService(): ServerModloaderInstallerService {
  if (serverModloaderInstallerService) {
    return serverModloaderInstallerService;
  }
  const fixture = process.env.BATTLY_DISABLE_SERVER_RUNTIME === '1';
  const fetchImplementation = fixture ? serverInstallerFixtureFetch() : fetch;
  const catalog = new ServerModloaderCatalog({
    fetchImplementation,
    ...(fixture
      ? {
          forgeMavenUrl: 'https://fixture.battly.test/forge-maven/',
          forgePromotionsUrl: 'https://fixture.battly.test/forge-promotions',
          neoForgeMavenUrl: 'https://fixture.battly.test/neoforge-maven/',
        }
      : {}),
  });
  serverModloaderInstallerService = new ServerModloaderInstallerService(resolveServerStore(), {
    catalog,
    fetchImplementation,
    ...(fixture
      ? {
          buildToolsUrl: 'https://fixture.battly.test/BuildTools.jar',
          platform: 'win32' as const,
          runInstaller: async (_java, args, options) => {
            if (args.includes('--rev')) {
              await writeFile(
                join(options.cwd, 'spigot-1.20.1.jar'),
                Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x53, 0x50, 0x49]),
              );
              return;
            }
            const installer = args[1] ?? '';
            const forge = installer.includes('forge-installer') && !installer.includes('neoforge');
            const root = forge
              ? join(options.cwd, 'libraries', 'net', 'minecraftforge', 'forge', '1.20.1-47.4.10')
              : join(options.cwd, 'libraries', 'net', 'neoforged', 'neoforge', '20.1.120');
            await mkdir(root, { recursive: true });
            await Promise.all([
              writeFile(join(root, 'win_args.txt'), '-cp libraries/fixture.jar FixtureMain'),
              writeFile(join(root, 'unix_args.txt'), '-cp libraries/fixture.jar FixtureMain'),
            ]);
          },
        }
      : {}),
  });
  return serverModloaderInstallerService;
}

function resolveServerPlayerListService(): ServerPlayerListService {
  serverPlayerListService ??= new ServerPlayerListService(resolveServerStore());
  return serverPlayerListService;
}

function resolveServerFileService(): ServerFileService {
  serverFileService ??= new ServerFileService(resolveServerStore());
  return serverFileService;
}

function resolveServerWorldImportService(): ServerWorldImportService {
  serverWorldImportService ??= new ServerWorldImportService(
    resolveServerStore(),
    process.env.BATTLY_SERVER_WORLD_ARCHIVE_PATH ||
      join(app.getPath('userData'), 'server-world-archive'),
  );
  return serverWorldImportService;
}

function resolveServerContentService(): ServerContentService {
  serverContentService ??= new ServerContentService(
    resolveServerStore(),
    process.env.BATTLY_SERVER_CONTENT_ARCHIVE_PATH ||
      join(app.getPath('userData'), 'server-content-archive'),
  );
  return serverContentService;
}

function resolveServerSharingService(): ServerSharingService {
  if (serverSharingService) {
    return serverSharingService;
  }
  const fixture = process.env.BATTLY_DISABLE_SERVER_RUNTIME === '1';
  const fixtureFrpc = process.execPath;
  const fixtureHash = '0'.repeat(64);
  serverSharingService = new ServerSharingService(resolveServerStore(), {
    fetchImplementation: fixture
      ? (input) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith('/create-tunnel')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  status: 'success',
                  frps_domain: 'fixture.battly.test',
                  frps_port: 7000,
                  publicAddress: 'server-e2e.battlyservers.net',
                  remote_port: 25565,
                  subdomain: 'server-e2e',
                  tokenEndpoint: 'https://fixture.battly.test/token',
                }),
              ),
            );
          }
          if (url.endsWith('/servers')) {
            return Promise.resolve(new Response(JSON.stringify([])));
          }
          if (url.endsWith('/check-if-available')) {
            return Promise.resolve(new Response(JSON.stringify({ available: true })));
          }
          if (url.endsWith('/create-server')) {
            return Promise.resolve(
              new Response(JSON.stringify({ status: 'success', _id: 'server-e2e' })),
            );
          }
          if (url.endsWith('/api/v2/users/obtenerAmigos')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  amigos: [
                    { estado: 'online', username: 'FriendE2E' },
                    { estado: 'ingame', username: 'BuilderE2E' },
                  ],
                }),
              ),
            );
          }
          if (url.endsWith('/api/v2/servers/invitar-amigo')) {
            return Promise.resolve(new Response(JSON.stringify({ status: 'success' })));
          }
          return Promise.resolve(new Response(null, { status: 404 }));
        }
      : fetch,
    frpcPath: fixture
      ? fixtureFrpc
      : process.platform === 'linux'
        ? join(
            packagedApplication ? process.resourcesPath : join(app.getAppPath(), 'build-resources'),
            'frpc',
            `linux-${process.arch}`,
            'frpc',
          )
        : join(app.getPath('appData'), '.battly', 'battly', 'launcher', 'frpc.exe'),
    frpcSha256:
      process.env.BATTLY_FRPC_SHA256 ||
      (fixture
        ? fixtureHash
        : process.platform === 'linux'
          ? 'a89129b922f91f1327853a46da65136c52ad421c85315299d333ec06da3f3bbb'
          : '68a34fd6765d3a6d791e83c29e783fbe585579e08ea1ad569962e6644a3197a3'),
    frpcUrl:
      process.env.BATTLY_FRPC_URL ||
      (fixture
        ? 'https://fixture.battly.test/frpc.exe'
        : 'https://cdn.battlylauncher.com/public/libraries/frpc/frpc.exe'),
    oidcClientSecret: fixture ? 'fixture-only' : 'unused-by-battly-tunnel',
    ...(fixture
      ? { prepareFrpc: () => Promise.resolve() }
      : process.platform === 'linux'
        ? {
            prepareFrpc: async () => {
              if (process.arch !== 'x64') {
                throw new Error('Battly Servers requiere Linux x64 en esta distribución');
              }
              const file = join(
                packagedApplication
                  ? process.resourcesPath
                  : join(app.getAppPath(), 'build-resources'),
                'frpc',
                'linux-x64',
                'frpc',
              );
              const data = await readFile(file);
              if (
                createHash('sha256').update(data).digest('hex') !==
                'a89129b922f91f1327853a46da65136c52ad421c85315299d333ec06da3f3bbb'
              ) {
                throw new Error('El componente frpc está dañado');
              }
              if (((await lstat(file)).mode & 0o111) === 0) {
                await chmod(file, 0o755);
              }
            },
          }
        : {}),
    sharingApiUrl: process.env.BATTLY_SERVER_SHARING_API_URL,
    spawnTunnel: fixture
      ? (_executable, _args, options) =>
          spawnChild(
            process.execPath,
            ['-e', 'console.log("start proxy success");setInterval(()=>{},1000)'],
            {
              ...options,
              env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
              stdio: 'pipe',
            },
          )
      : undefined,
    temporaryRoot: join(app.getPath('temp'), 'BattlyRemake', 'server-tunnels'),
    tunnelApiUrl: process.env.BATTLY_SERVER_TUNNEL_API_URL,
    ...(fixture
      ? {}
      : battlyTunnelRuntimeOptions(
          packagedApplication ? process.resourcesPath : join(app.getAppPath(), 'build-resources'),
          join(app.getPath('userData'), 'components', 'battly-tunnel'),
        )),
  });
  return serverSharingService;
}

function resolveSkinService(): SkinService {
  skinService ??= new SkinService(
    process.env.BATTLY_SKIN_API_URL || 'https://api.battlylauncher.com/',
    fetch,
    join(app.getPath('userData'), 'cache', 'skins'),
  );
  return skinService;
}

function resolveThemeService(): ThemeService {
  themeService ??= new ThemeService(
    process.env.BATTLY_THEME_API_URL || 'https://api.battlylauncher.com/api/themes',
    resolveSettingsStore(),
    fetch,
    join(app.getPath('userData'), 'cache', 'themes'),
  );
  return themeService;
}

function resolveModrinthClient(): ModrinthClient {
  modrinthClient ??= new ModrinthClient({
    ...(process.env.BATTLY_MODRINTH_API_URL
      ? { baseUrl: process.env.BATTLY_MODRINTH_API_URL }
      : {}),
  });
  return modrinthClient;
}

function resolveModInstaller(): ModInstaller {
  modInstaller ??= new ModInstaller(resolveModrinthClient(), contentRootPath());
  return modInstaller;
}

function resolveLocalModStore(): LocalModStore {
  localModStore ??= new LocalModStore(
    join(contentRootPath(), 'mods'),
    join(app.getPath('userData'), 'content-archive', 'mods'),
  );
  return localModStore;
}

function resolveMrpackInstaller(): MrpackInstaller {
  mrpackInstaller ??= new MrpackInstaller(instancesPath());
  return mrpackInstaller;
}

function resolveBypackService(): BypackService {
  return new BypackService(resolveInstanceStore(), instancesPath(), {
    ...(process.env.BATTLY_CURSEFORGE_API_KEY
      ? { curseForgeKey: process.env.BATTLY_CURSEFORGE_API_KEY }
      : {}),
    ...(process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL
      ? { curseForgeFingerprintUrl: process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL }
      : {}),
    ...(process.env.BATTLY_CURSEFORGE_API_URL
      ? { curseForgeApiBase: process.env.BATTLY_CURSEFORGE_API_URL }
      : {}),
    assertEditable: (directory) => {
      if (otherDirectoryLaunches(Symbol(), directory).length) {
        throw new Error('Cierra Minecraft antes de exportar esta instancia');
      }
    },
  });
}

function resolveCurseForgeModpackInstaller(): CurseForgeModpackInstaller {
  curseForgeModpackInstaller ??= new CurseForgeModpackInstaller(instancesPath(), {
    ...(process.env.BATTLY_CURSEFORGE_API_URL
      ? { apiBaseUrl: process.env.BATTLY_CURSEFORGE_API_URL }
      : {}),
  });
  return curseForgeModpackInstaller;
}

function resolveModrinthModpackInstaller(): ModrinthModpackInstaller {
  modrinthModpackInstaller ??= new ModrinthModpackInstaller(
    resolveModrinthClient(),
    resolveMrpackInstaller(),
    join(app.getPath('temp'), 'BattlyRemake', 'modpacks'),
  );
  return modrinthModpackInstaller;
}

function resolveMinecraftCoreRuntime(): MinecraftCoreRuntime {
  minecraftCoreRuntime ??= new MinecraftCoreRuntime(
    new MinecraftCoreInstaller({
      libraryPath: join(app.getPath('appData'), '.battly', 'battly', 'launcher', 'mc'),
    }),
  );
  return minecraftCoreRuntime;
}

function resolveConfigClient(): ReturnType<typeof createBattlyConfigClient> {
  configClient ??= createBattlyConfigClient(
    join(app.getPath('userData'), 'cache', 'launcher-config.json'),
    undefined,
    process.env.BATTLY_LAUNCHER_CONFIG_URL,
  );
  return configClient;
}

function resolveLauncherService(
  descriptor: ReturnType<typeof minecraftCorePackageFromLauncherConfig>,
): LauncherService {
  const key = `${descriptor.version}:${descriptor.sha256}:${descriptor.url}`;
  if (launcherService?.active) {
    return launcherService;
  }
  if (!launcherService || launcherDescriptorKey !== key) {
    const mesa = new MesaRuntimeService(join(app.getPath('userData'), 'runtime', 'mesa'));
    const memory = new LaunchMemoryPreflight({
      supported: process.platform === 'win32',
      read: readWindowsMemorySnapshot,
      ask: async (assessment) => {
        const prompt = launchMemoryDialog(assessment, translateNative);
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
        }
        const result =
          mainWindow && !mainWindow.isDestroyed()
            ? await dialog.showMessageBox(mainWindow, prompt.options)
            : await dialog.showMessageBox(prompt.options);
        return prompt.decisions[result.response] ?? 'cancel';
      },
      openSettings: () =>
        new Promise<void>((resolve, reject) => {
          const child = spawnChild(
            join(
              process.env.SystemRoot || 'C:\\Windows',
              'System32',
              'SystemPropertiesAdvanced.exe',
            ),
            [],
            { windowsHide: false, stdio: 'ignore' },
          );
          child.once('error', reject);
          child.once('spawn', () => {
            child.unref();
            resolve();
          });
        }),
    });
    launcherService = new LauncherService(
      [
        new IsolatedCoreAdapter(resolveMinecraftCoreRuntime(), descriptor),
        new MinecraftLauncherCoreAdapter(),
      ].map(
        (adapter) =>
          new BattlyClientAdapter(
            new MesaRecoveryAdapter(adapter, mesa, join(app.getPath('userData'), 'mesa-profiles')),
            resolveClientBridge(),
          ),
      ),
      (options, emit) => memory.prepare(options, emit),
    );
    launcherDescriptorKey = key;
  }
  return launcherService;
}

function resolveHomeService(): HomeService {
  homeService ??= new HomeService({
    updated: (snapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(desktopChannels.homeUpdated, snapshot);
      }
    },
    configClient: resolveConfigClient(),
    newsClient: new RemoteJsonClient({
      url: process.env.BATTLY_HOME_NEWS_URL || battlyResourceUrls.launcherNews,
      cachePath: join(app.getPath('userData'), 'cache', 'launcher-news.json'),
      validate: validateBattlyNews,
      allowLoopbackHttp: true,
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 10_000,
    }),
    minecraftNewsService: new MinecraftNewsService(
      process.env.BATTLY_MINECRAFT_NEWS_URL ||
        'https://launchercontent.mojang.com/v2/javaPatchNotes.json',
      fetch,
      10_000,
      join(app.getPath('userData'), 'cache', 'minecraft-news-source.json'),
    ),
    minecraftNewsTranslator: new MinecraftNewsTranslator(
      join(app.getPath('userData'), 'cache', 'minecraft-news-translations'),
    ),
    statusUrls: {
      api: process.env.BATTLY_HOME_API_URL || 'https://api.battlylauncher.com',
      web: process.env.BATTLY_HOME_WEB_URL || 'https://battlylauncher.com',
      members:
        process.env.BATTLY_HOME_MEMBERS_URL ||
        'https://api.battlylauncher.com/battlylauncher/usuarios_online',
    },
  });
  return homeService;
}

function resolveNewsStateService(): NewsStateService {
  newsStateService ??= new NewsStateService(
    resolveSettingsStore(),
    join(contentRootPath(), 'battly', 'IMPORTANTE.txt'),
    (source) => translateNative(source),
  );
  return newsStateService;
}

function resolveContentLibraryService(): ContentLibraryService {
  contentLibraryService ??= new ContentLibraryService(contentRootPath());
  return contentLibraryService;
}

function resolveWorldBackupService(): WorldBackupService {
  worldBackupService ??= new WorldBackupService(
    contentRootPath(),
    process.env.BATTLY_WORLD_BACKUPS_PATH || join(app.getPath('userData'), 'world-backups'),
    process.env.BATTLY_WORLD_BACKUP_ARCHIVE_PATH ||
      join(app.getPath('userData'), 'content-archive', 'world-backups'),
    resolveSettingsStore(),
  );
  return worldBackupService;
}

function resolveSocialService(): SocialService {
  socialService ??= new SocialService(
    process.env.BATTLY_SOCIAL_API_URL || 'https://api.battlylauncher.com/',
    fetch,
    join(app.getPath('userData'), 'cache', 'friends'),
  );
  return socialService;
}

function resolveMusicService(): MusicService {
  musicService ??= new MusicService(
    join(app.getPath('userData'), 'cache', 'music-snapshot.json'),
    process.env.BATTLY_MUSIC_API_URL || 'https://musicapi.battlylauncher.com/',
  );
  return musicService;
}

function resolveSpotifyImportService(): SpotifyImportService {
  spotifyImportService ??= new SpotifyImportService(
    process.env.BATTLY_SPOTIFY_CONVERSION_URL || 'https://battlylauncher.com/',
  );
  return spotifyImportService;
}

function resolveYtDlpResolver(): YtDlpResolver {
  ytDlpResolver ??= new YtDlpResolver(
    join(app.getPath('appData'), '.battly', 'battly', 'launcher', 'music', 'bin'),
    {
      metadataCachePath: join(app.getPath('userData'), 'cache', 'music-metadata.json'),
      ...(process.env.BATTLY_YTDLP_RELEASE_API_URL
        ? { releaseApiUrl: process.env.BATTLY_YTDLP_RELEASE_API_URL }
        : {}),
    },
  );
  return ytDlpResolver;
}

function resolveSettingsStore(): SettingsStore {
  settingsStore ??= new SettingsStore(remakeStorePath());
  return settingsStore;
}

function resolveManagedJavaRuntimeService(): ManagedJavaRuntimeService {
  if (!managedJavaRuntimeService) {
    const fixture = process.env.BATTLY_DISABLE_GAME_LAUNCH === '1';
    managedJavaRuntimeService = new ManagedJavaRuntimeService(
      join(contentRootPath(), 'runtime'),
      resolveSettingsStore(),
      {
        ...(fixture
          ? {
              fetchImplementation: serverInstallerFixtureFetch(),
              platform: 'win32' as const,
              architecture: 'x64' as const,
              runtimeIndexUrl: 'https://fixture.battly.test/runtime-index',
            }
          : {}),
        ...(process.env.BATTLY_JAVA_RUNTIME_INDEX_URL
          ? { runtimeIndexUrl: process.env.BATTLY_JAVA_RUNTIME_INDEX_URL }
          : {}),
      },
    );
    managedJavaRuntimeService.subscribe((progress) => {
      taskbarProgress.update(
        progress.phase === 'download' ? progress.completedBytes : 0,
        progress.phase === 'download' ? progress.totalBytes : 0,
      );
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(desktopChannels.managedJavaProgress, progress);
          socialRealtimeService.publishRemote({ type: 'java-progress', progress });
        }
      }
    });
  }
  return managedJavaRuntimeService;
}

function resolveWindowBehaviorService(): WindowBehaviorService {
  windowBehaviorService ??= new WindowBehaviorService(
    () => resolveSettingsStore().snapshot(),
    () => app.quit(),
    process.env.BATTLY_DISABLE_GAME_LAUNCH !== '1',
    showMusicWindow,
    closeMusicWindow,
  );
  return windowBehaviorService;
}

function resolveGoogleDriveSyncService(): GoogleDriveSyncService {
  googleDriveSyncService ??= new GoogleDriveSyncService(
    resolveSettingsStore(),
    fetch,
    process.env.BATTLY_GOOGLE_DRIVE_REFRESH_URL ||
      'https://battlylauncher.com/google-drive/refresh-token',
  );
  return googleDriveSyncService;
}

let driveAutomaticQueue: Promise<void> = Promise.resolve();
function syncWorldsOnGameClose(gameDirectory?: string, completedLaunch?: symbol): Promise<void> {
  driveAutomaticQueue = driveAutomaticQueue
    .catch(() => undefined)
    .then(() =>
      taskbarProgress.run(() => runAutomaticDriveBackups(gameDirectory, completedLaunch)),
    );
  return driveAutomaticQueue;
}
async function runAutomaticDriveBackups(
  gameDirectory?: string,
  _completedLaunch?: symbol,
): Promise<void> {
  if (rootMigrationActive || process.env.BATTLY_DISABLE_GAME_LAUNCH === '1') {
    return;
  }
  const settings = await resolveSettingsStore().snapshot();
  if (!settings.autoSyncEnabled || !settings.googleDriveConnected) {
    return;
  }
  const notify = (
    message: string,
    automaticState: 'progress' | 'complete' | 'error' = 'progress',
    detail?: DriveTransferProgress,
  ): void => {
    if (automaticState !== 'progress') {
      notifications().action(
        automaticState === 'complete' ? 'Copia completada' : 'No se pudo completar la copia',
        message || 'Google Drive / Battly',
      );
    }
    taskbarProgress.update(
      driveProgressPercent(detail) ?? 0,
      driveProgressPercent(detail) === null ? 0 : 100,
    );
    if (gameDirectory && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(desktopChannels.driveProgress, {
        message,
        automaticState,
        detail,
      });
    }
  };
  const queuePath = join(app.getPath('userData'), 'drive-pending-worlds.json');
  const completedPath = join(app.getPath('userData'), 'drive-completed-worlds.json');
  try {
    const sources = new Map<string, string>([['general', contentRootPath()]]);
    for (const instance of await resolveInstanceStore().list()) {
      sources.set(
        `instance:${instance.id}`,
        await resolveInstanceStore().directoryPathInternal(instance.id),
      );
    }
    let pending: string[] = [];
    try {
      const stored: unknown = JSON.parse(
        (await readBoundedRegularFile(queuePath, 16 * 1024 * 1024)).toString('utf8'),
      );
      if (Array.isArray(stored)) {
        pending = stored.filter(
          (item): item is string => typeof item === 'string' && sources.has(item),
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const scope = gameDirectory
      ? [...sources].find(([, directory]) => resolve(directory) === resolve(gameDirectory))?.[0]
      : undefined;
    if (scope && !pending.includes(scope)) {
      pending.push(scope);
    }
    await writeFileAtomically(queuePath, JSON.stringify(pending), randomUUID());
    // Keep queued worlds on disk. Reconnection/periodic sync retries them without error notifications.
    if (!networkAvailable()) {
      return;
    }
    const completed: Record<string, number> = {};
    try {
      const saved: unknown = JSON.parse(
        (await readBoundedRegularFile(completedPath, 128 * 1024)).toString('utf8'),
      );
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        for (const [key, value] of Object.entries(saved)) {
          if (
            sources.has(key) &&
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0
          ) {
            completed[key] = value;
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const queued = pending.filter(
      (key) =>
        !otherDirectoryLaunches(Symbol(), sources.get(key)!).length &&
        shouldBackUpAutomatically(key, settings.runtime, completed[key]),
    );
    if (!queued.length) {
      return;
    }
    const finishPresence = discordPresence.operation(desktopChannels.syncGoogleDrive);
    try {
      const result = await resolveGoogleDriveSyncService().syncWorldGroups(
        queued.map((key) => ({ savesRoot: join(sources.get(key)!, 'saves'), scope: key })),
        (message, detail) => notify(message, 'progress', detail),
        async (key) => {
          completed[key] = Date.now();
          await writeFileAtomically(completedPath, JSON.stringify(completed), randomUUID());
          pending = pending.filter((item) => item !== key);
          await writeFileAtomically(queuePath, JSON.stringify(pending), randomUUID());
        },
      );
      if (!result.success) {
        return;
      }
      if (queued.length) {
        notify('Tus mundos están listos.', 'complete');
      }
      await resolveStructuredLogger().log('info', 'google-drive.world-sync-finished', {
        worlds: result.count,
        files: result.files,
      });
    } finally {
      finishPresence();
    }
  } catch (error) {
    notify('', 'error');
    await resolveStructuredLogger().log('error', 'google-drive.world-sync-failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertMinecraftArchitecture(version: string, requiredJava?: string | null): void {
  if (is32BitArchitecture(systemArchitecture()) && requires64BitMinecraft(version, requiredJava)) {
    throw new Error(minecraft32BitNotice);
  }
}

function currentAppInfo() {
  return normalizeAppInfo({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    architecture: systemArchitecture(),
    development,
  });
}

const launcherAnalytics = new LauncherAnalytics();
let analyticsRevision = 0;
async function refreshLauncherAnalytics(): Promise<void> {
  const revision = ++analyticsRevision;
  try {
    const [settings, account, accounts] = await Promise.all([
      resolveSettingsStore().snapshot(),
      resolveAccountStore().store.selectedBattlyInternal(),
      resolveAccountStore().store.list(),
    ]);
    if (revision !== analyticsRevision) {
      return;
    }
    const token: unknown = account && Object.getOwnPropertyDescriptor(account, 'token')?.value;
    const uuid: unknown = account && Object.getOwnPropertyDescriptor(account, 'uuid')?.value;
    const selected = accounts.accounts.find((entry) => entry.selected);
    const linked = selected && (selected.uuid === uuid || selected.name === account?.name);
    launcherAnalytics.configure({
      privacy: settings.privacy,
      identity:
        linked && typeof token === 'string' && typeof uuid === 'string'
          ? { token, userId: uuid }
          : null,
      metadata: {
        launcherVersion: app.getVersion(),
        language: settings.visual.language,
        patchBuild: String(patchRuntime()?.snapshot().build || 1),
        patchVersion:
          (patchRuntime()?.snapshot().build || 1) > 1
            ? `${app.getVersion()}-patch${patchRuntime()?.snapshot().build}`
            : 'base',
        channel: notificationChannel(),
        os:
          process.platform === 'win32'
            ? 'Windows'
            : process.platform === 'darwin'
              ? 'macOS'
              : 'Linux',
        osVersion: systemRelease(),
        architecture: systemArch(),
        memoryGb: Math.round(systemMemory() / 1024 ** 3),
        cpuCount: systemCpus().length,
        accountType: selected?.type,
        electronVersion: process.versions.electron,
      },
    });
    void notificationContext()
      .then((noticeContext) => {
        publicNotificationSocket?.emit('notifications:sync', noticeContext);
        socialRealtimeService.refreshNotifications(noticeContext);
      })
      .catch(() => undefined);
  } catch {
    if (revision !== analyticsRevision) {
      return;
    }
    launcherAnalytics.configure({
      privacy: { ...defaultPrivacySettings, telemetryEnabled: false },
      identity: null,
      metadata: {},
    });
  }
}

function resolveStructuredLogger(): StructuredLogger {
  structuredLogger ??= new StructuredLogger(
    process.env.BATTLY_DIAGNOSTIC_LOG_PATH || join(app.getPath('userData'), 'logs', 'battly.jsonl'),
  );
  return structuredLogger;
}

function resolveDiagnosticReportService(): DiagnosticReportService {
  diagnosticReportService ??= new DiagnosticReportService({
    logger: resolveStructuredLogger(),
    appInfo: currentAppInfo,
    counts: async () => {
      const [accounts, instances] = await Promise.all([
        resolveAccountStore()
          .store.list()
          .catch(() => ({ accounts: [], selectedAccountUuid: null })),
        resolveInstanceStore()
          .list()
          .catch(() => []),
      ]);
      return { accounts: accounts.accounts.length, instances: instances.length };
    },
  });
  return diagnosticReportService;
}

let worldsService: BattlyWorldsService | undefined;
let worldsDesktop: WorldsDesktop | undefined;
let worldsMicAllowedUntil = 0;
function resolveWorldsDesktop(): WorldsDesktop {
  if (worldsDesktop) {
    return worldsDesktop;
  }
  worldsDesktop ??= new WorldsDesktop(
    () => mainWindow ?? null,
    packagedApplication
      ? join(process.resourcesPath, 'worlds-overlay')
      : join(app.getAppPath(), 'build-resources', 'worlds-overlay'),
    join(__dirname, '..'),
    join(app.getPath('userData'), 'battlyworlds', 'overlay.json'),
    async (version) => {
      const service = resolveWorldsService();
      service.configure((await resolveSettingsStore().snapshot()).runtime.worlds);
      await service.act(await selectedBattlyIdentity(), { type: 'host', version });
    },
    overlayRelease(join(app.getPath('userData'), 'battlyworlds', 'overlay-runtime')).prepare,
    { translate: (source) => translateNative(source) },
  );
  void resolveSettingsStore()
    .snapshot()
    .then((settings) => worldsDesktop?.applySettings(settings.runtime.worlds))
    .catch(() => undefined);
  return worldsDesktop;
}
function resolveWorldsService(): BattlyWorldsService {
  if (worldsService) {
    return worldsService;
  }
  worldsService = new BattlyWorldsService(
    new TerracottaRuntime(
      join(app.getPath('userData'), 'components', 'terracotta'),
      join(app.getPath('userData'), 'battlyworlds', 'sessions'),
    ),
    join(app.getPath('userData'), 'battlyworlds', 'invitations'),
  );
  void resolveSettingsStore()
    .snapshot()
    .then((settings) => worldsService?.configure(settings.runtime.worlds))
    .catch(() => undefined);
  worldsService.subscribe((event) => {
    if (event.type === 'snapshot') {
      void updateDiscordWorlds(event.snapshot).catch(() => undefined);
    }
    if (
      event.type === 'closed' ||
      (event.type === 'snapshot' && ['idle', 'error'].includes(event.snapshot.state))
    ) {
      clientVoiceState = { connected: false, muted: false, deafened: false, error: '' };
    }
    if (event.type === 'voice' && event.event.type === 'status') {
      clientVoiceState = { ...event.event.status };
    }
    if (event.type === 'voice' && event.event.type === 'ready') {
      worldsMicAllowedUntil = Date.now() + 30000;
    }
    resolveWorldsDesktop().emit(event);
  });
  return worldsService;
}

let clientBridge: ClientBridge | undefined;
let clientVoiceState: Record<string, unknown> = {
  connected: false,
  muted: false,
  deafened: false,
  error: '',
};
async function clientIdentity(owner: ClientOwner) {
  const selected = await resolveAccountStore().store.selectedInternal();
  if (
    owner.type !== 'battly' ||
    !selected ||
    selected.uuid !== owner.uuid ||
    selected.type !== 'battly'
  ) {
    throw new Error('La cuenta de lanzamiento ya no está seleccionada');
  }
  const identity = await selectedBattlyIdentity(true, owner.uuid);
  if (identity.username.toLowerCase() !== owner.name.toLowerCase()) {
    throw new Error('La cuenta de lanzamiento ha cambiado');
  }
  return identity;
}
function resolveClientBridge(): ClientBridge {
  return (clientBridge ??= new ClientBridge({
    session: async (owner) => {
      try {
        const identity = await clientIdentity(owner);
        return { username: identity.username, premium: identity.premium };
      } catch {
        return null;
      }
    },
    native: (pid, enabled) => resolveWorldsDesktop().setNativeClient(pid, enabled),
    dispatch: async (owner, operation, body) => {
      const identity = await clientIdentity(owner);
      switch (operation) {
        case 'social':
          return resolveSocialService().snapshot(identity.token);
        case 'search':
          return resolveSocialService().search(identity.token, normalizeSocialUsername(body.query));
        case 'friend':
          await resolveSocialService().action(
            identity.token,
            normalizeSocialAction(body.action),
            normalizeSocialUsername(body.username),
          );
          return resolveSocialService().snapshot(identity.token);
        case 'profile':
          return resolveSocialService().profile(
            body.username === undefined ? identity.username : socialIdentifier(body.username),
            identity.token,
          );
        case 'worlds':
          return resolveWorldsService().snapshot(identity);
        case 'rooms': {
          const page = body.page ?? 1;
          if (!Number.isSafeInteger(page) || Number(page) < 1 || Number(page) > 1000) {
            throw new Error('Página no válida');
          }
          return resolveWorldsService().publicRooms(identity, Number(page));
        }
        case 'worlds-action': {
          const action = normalizeWorldsAction(body);
          if (
            action.type === 'host' &&
            !['26.3', '1.8.9', '1.12.2', '1.16.5', '1.20.1', '1.21.11'].includes(action.version)
          ) {
            throw new Error('Versión de cliente no válida');
          }
          resolveWorldsService().configure(
            (await resolveSettingsStore().snapshot()).runtime.worlds,
          );
          return resolveWorldsService().act(identity, action);
        }
        case 'voice-state':
          return worldsService?.current().username === identity.username &&
            ['hosting', 'joined'].includes(worldsService.current().state)
            ? clientVoiceState
            : { connected: false, muted: false, deafened: false, error: '' };
        case 'voice': {
          const command = normalizeVoiceCommand(body);
          if (command.type === 'connect') {
            resolveWorldsService().prepareVoice();
          }
          if (command.type === 'connect' || command.type === 'input') {
            worldsMicAllowedUntil = Date.now() + 30000;
          }
          if (!mainWindow || mainWindow.isDestroyed()) {
            throw new Error('El motor de voz del launcher no está disponible');
          }
          mainWindow.webContents.send(desktopChannels.worldsEvent, {
            type: 'voice',
            event: { type: 'command', command },
          });
          return { accepted: true };
        }
        default:
          throw new Error('Operación no disponible');
      }
    },
  }));
}

async function selectedBattlyToken(): Promise<string> {
  return (await selectedBattlyIdentity()).token;
}

async function selectedBattlyIdentity(
  activeOnly = false,
  accountUuid?: unknown,
): Promise<{
  readonly token: string;
  readonly username: string;
  readonly premium: boolean;
}> {
  if (accountUuid !== undefined && (typeof accountUuid !== 'string' || !accountUuid)) {
    throw new TypeError('Invalid account id');
  }
  const account =
    typeof accountUuid === 'string'
      ? await resolveAccountStore().store.getInternal(accountUuid)
      : activeOnly
        ? await resolveAccountStore().store.selectedInternal()
        : await resolveAccountStore().store.selectedBattlyInternal();
  const value = (key: string): unknown =>
    account ? (Object.getOwnPropertyDescriptor(account, key)?.value as unknown) : undefined;
  const type = value('type');
  const token = value('token');
  if (type !== 'battly' || typeof token !== 'string' || !token || token.length > 8192) {
    throw new Error('Selecciona una cuenta de Battly para usar esta función');
  }
  const username = value('name');
  if (typeof username !== 'string' || !username || username.length > 254) {
    throw new Error('La cuenta de Battly no tiene un nombre válido');
  }
  return { token, username, premium: value('premium') === true };
}

function socialIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 256 ||
    !/^[A-Za-z0-9_.|+-]+$/.test(value)
  ) {
    throw new TypeError('Invalid social identifier');
  }
  return value;
}

function revealLauncherFromTray(): void {
  resolveWindowBehaviorService().showRequested();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function updateMusicTray(state: MusicPlaybackState, sender: Electron.WebContents): void {
  if (!musicTray) {
    return;
  }
  musicTray.setToolTip(musicTrayTooltip(state));
  const send = (action: 'next' | 'play-pause' | 'previous'): void => {
    if (!sender.isDestroyed()) {
      sender.send(desktopChannels.musicControl, action);
    }
  };
  musicTray.setContextMenu(
    Menu.buildFromTemplate([
      ...musicTrayTemplate(
        state,
        {
          send,
          showBattly: revealLauncherFromTray,
          quitBattly: () => app.quit(),
        },
        translateNative,
      ),
    ]),
  );
}

function resolveAccountStore(): { readonly store: AccountStore; readonly writable: boolean } {
  if (accountStoreContext) {
    return accountStoreContext;
  }
  const configuredPath = process.env.BATTLY_PROFILE_STORE_PATH;
  if (configuredPath) {
    accountStoreContext = { store: new AccountStore(configuredPath), writable: true };
    return accountStoreContext;
  }
  accountStoreContext = { store: new AccountStore(remakeStorePath()), writable: true };
  return accountStoreContext;
}

function resolveAuthCoordinator(): AuthCoordinator {
  const loginUrl = process.env.BATTLY_AUTH_LOGIN_URL;
  const premiumUrl = process.env.BATTLY_AUTH_PREMIUM_URL;
  const twoFactorUrl = process.env.BATTLY_AUTH_TWO_FACTOR_URL;
  const googleLoginUrl = process.env.BATTLY_AUTH_GOOGLE_LOGIN_URL;
  const googleExchangeUrl = process.env.BATTLY_AUTH_GOOGLE_EXCHANGE_URL;

  const battlySession = new BattlyCredentialsSession();
  authCoordinator ??= new AuthCoordinator(resolveAccountStore().store, [
    new BattlyPasswordProvider({
      session: battlySession,
      ...(loginUrl ? { loginUrl } : {}),
      ...(premiumUrl ? { premiumUrl } : {}),
    }),
    new BattlyTwoFactorProvider({
      session: battlySession,
      ...(twoFactorUrl ? { completeUrl: twoFactorUrl } : {}),
      ...(premiumUrl ? { premiumUrl } : {}),
    }),
    new BattlyGoogleProvider({
      openExternal: (url) => shell.openExternal(url),
      onProgress: (phase) => {
        void resolveStructuredLogger()
          .log('info', 'auth.google.phase', { phase })
          .catch(() => undefined);
      },
      ...(googleLoginUrl ? { loginUrl: googleLoginUrl } : {}),
      ...(googleExchangeUrl ? { exchangeUrl: googleExchangeUrl } : {}),
      ...(premiumUrl ? { premiumUrl } : {}),
    }),
    new MicrosoftProvider({
      runtime: resolveMinecraftCoreRuntime(),
      loadConfiguration: async () => {
        const { data } = await resolveConfigClient().load();
        return {
          clientId: data.clientId,
          corePackage: minecraftCorePackageFromLauncherConfig(data.raw),
        };
      },
    }),
  ]);
  return authCoordinator;
}

function assertTrustedSender(senderUrl: string | undefined): void {
  accessMonitor?.assertAllowed();
  if (!senderUrl || !isTrustedRendererUrl(senderUrl, rendererUrl)) {
    throw new Error('Rejected IPC request from an untrusted renderer');
  }
}

function registerDesktopIpc(): void {
  const remoteHandlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>();
  const remoteControllers = new Set<AbortController>();
  // Covers all invoke handlers, including overlay handlers with their own sender validation.
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    const guarded: Parameters<typeof ipcMain.handle>[1] = async (event, ...args: unknown[]) => {
      accessMonitor?.assertAllowed();
      if (rootMigrationActive) {
        throw new Error('Battly is moving its data. Wait for the restart.');
      }
      if (
        channel.startsWith('servers:') &&
        ![
          desktopChannels.getServers,
          desktopChannels.createServer,
          desktopChannels.getServerSoftwareAvailability,
        ].includes(channel as typeof desktopChannels.getServers) &&
        process.env.BATTLY_DISABLE_SERVER_RUNTIME !== '1'
      ) {
        const id = normalizeServerId(args[0]);
        if (!(await resolveServerStore().list()).some((server) => server.id === id)) {
          throw new Error('El servidor no pertenece a la cuenta activa');
        }
      }
      const counted = channel !== desktopChannels.migrateBattlyDataRoot;
      if (counted) {
        activeIpcOperations++;
      }
      try {
        const result: unknown = await listener(event, ...args);
        return result;
      } finally {
        if (counted) {
          activeIpcOperations--;
        }
      }
    };
    if ((Object.values(remoteOperations) as readonly string[]).includes(channel)) {
      remoteHandlers.set(channel, guarded);
    }
    handle(channel, guarded);
  };
  rendererPreferences = new RendererPreferences(
    join(app.getPath('userData'), 'renderer-preferences.json'),
  );
  ipcMain.handle('storage:renderer-migrate', (event, legacy: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return rendererPreferences!.migrate(legacy);
  });
  ipcMain.handle('storage:renderer-set', (event, key: unknown, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return rendererPreferences!.set(key, value);
  });
  const updateNotifier = createUpdateNotifier({
    text: translateNative,
    icon: packagedApplication
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'src/renderer/assets/icon.png'),
    open: (action) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send(desktopChannels.updateNotice, action);
      }
    },
    later: () => {
      void updates.action('later');
    },
  });
  notificationChannel = () => updates.snapshot().settings.channel;
  const updates: UpdateService = new UpdateService({
    ready: updateNotifier.ready,
    later: updateNotifier.close,
    install: (): Promise<unknown> => requestUpdateAction('install'),
  });
  app.once('will-quit', updateNotifier.close);
  ipcMain.handle(desktopChannels.getUpdates, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return updates.snapshot();
  });
  ipcMain.handle(desktopChannels.notices, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return notifications().snapshot();
  });
  ipcMain.handle(desktopChannels.noticeRead, (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return notifications().read(id);
  });
  ipcMain.handle(desktopChannels.noticeClear, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return notifications().clear();
  });
  ipcMain.handle(desktopChannels.noticeSettings, (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return notifications().update(value);
  });
  ipcMain.handle(desktopChannels.noticeLink, async (event, id: unknown, url: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    await openNoticeLink(id, url);
  });
  ipcMain.handle(desktopChannels.updateSettings, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    updates.settings(value);
    await updates.automatic();
    return updates.snapshot();
  });
  ipcMain.handle(desktopChannels.updateAction, async (event, action: UpdateAction) => {
    assertTrustedSender(event.senderFrame?.url);
    return requestUpdateAction(action);
  });
  async function requestUpdateAction(action: UpdateAction) {
    if (
      (action === 'install' || action === 'rollback') &&
      (activeLaunchDirectories.size || runningMinecraftGames.size || installingServerRuntimes.size)
    ) {
      throw new Error(
        'Cierra Minecraft y espera a que terminen las instalaciones antes de reiniciar Battly.',
      );
    }
    if ((action === 'install' || action === 'rollback') && serverRuntimeService) {
      const servers = await resolveServerStore().list();
      if (
        servers.some((server) =>
          ['starting', 'running', 'stopping'].includes(
            serverRuntimeService!.snapshot(server.id).status,
          ),
        )
      ) {
        throw new Error('Detén tus servidores antes de reiniciar Battly para actualizar.');
      }
    }
    if (action === 'check') {
      await updates.automatic();
      return updates.snapshot();
    }
    return updates.action(action);
  }
  let updateStartupChecked = false;
  let startupUpdateRun: Promise<boolean> | undefined;
  const operationEvents: Record<string, string> = {
    'mods:install': 'mod:installed',
    'settings:save': 'launcher:settings_changed',
    'music:record-play': 'music:played',
    'social:chat-send': 'message:sent',
    'themes:apply': 'theme:applied',
  };
  const trackedHandle: typeof ipcMain.handle = (channel, handler) =>
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertTrustedSender(event.senderFrame?.url);
      const finishPresence = discordPresence.operation(channel);
      const started = performance.now();
      const installation = [desktopChannels.installServer, desktopChannels.installMod].includes(
        channel as typeof desktopChannels.installServer,
      );
      if (installation) {
        launcherAnalytics.track('installation:started', { operation: channel });
      }
      try {
        const perform = async (): Promise<unknown> => {
          const result: unknown = await handler(event, ...args);
          return result;
        };
        const result = await (progressChannels.has(channel)
          ? taskbarProgress.run(perform)
          : perform());
        if (
          (
            [
              desktopChannels.saveSettings,
              desktopChannels.selectAccount,
              desktopChannels.removeAccount,
              desktopChannels.removeAllAccounts,
              desktopChannels.startAuth,
            ] as readonly string[]
          ).includes(channel)
        ) {
          await refreshLauncherAnalytics();
          await refreshDiscordIdentity();
        }
        const success = !(
          result &&
          typeof result === 'object' &&
          'ok' in result &&
          result.ok === false
        );
        launcherAnalytics.track(success ? 'operation:completed' : 'operation:failed', {
          operation: channel,
          durationMs: Math.round(performance.now() - started),
          success,
          ...(!success ? { errorCategory: analyticsFailedResultCategory(result, channel) } : {}),
        });
        if (success && operationEvents[channel]) {
          launcherAnalytics.track(operationEvents[channel], {
            operation: channel,
            durationMs: Math.round(performance.now() - started),
          });
        }
        if (installation) {
          launcherAnalytics.track(success ? 'installation:completed' : 'installation:failed', {
            operation: channel,
            durationMs: Math.round(performance.now() - started),
          });
        }
        const noticeTitles: Record<string, string> = {
          [desktopChannels.installMod]: 'Mod instalado',
          [desktopChannels.installServer]: 'Servidor instalado',
          [desktopChannels.startServerRuntime]: 'Servidor iniciado',
          [desktopChannels.stopServerRuntime]: 'Servidor detenido',
          [desktopChannels.exportBypack]: 'Instancia exportada',
        };
        const modpack =
          channel === desktopChannels.installMod &&
          args[0] &&
          typeof args[0] === 'object' &&
          'projectType' in args[0] &&
          args[0].projectType === 'modpack';
        if (success && result !== null && noticeTitles[channel] && !modpack) {
          const names =
            result &&
            typeof result === 'object' &&
            'installed' in result &&
            Array.isArray(result.installed)
              ? result.installed.filter((v) => typeof v === 'string').join(', ')
              : 'Battly';
          notifications().action(noticeTitles[channel], names.slice(0, 4000) || 'Battly');
        }
        return result;
      } catch (error) {
        void resolveStructuredLogger()
          .log('error', 'operation.failed', { operation: channel, error })
          .catch(() => undefined);
        launcherAnalytics.log('error', channel + ' failed', {
          errorCategory: analyticsErrorCategory(error),
        });
        if (installation) {
          launcherAnalytics.track('installation:failed', {
            operation: channel,
            durationMs: Math.round(performance.now() - started),
            errorCategory: analyticsErrorCategory(error),
          });
        }
        launcherAnalytics.track('operation:failed', {
          operation: channel,
          durationMs: Math.round(performance.now() - started),
          errorCategory: analyticsErrorCategory(error),
        });
        throw error;
      } finally {
        finishPresence();
      }
    });
  ipcMain.handle(desktopChannels.analyticsPanel, (event, panel: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    launcherAnalytics.panel(panel);
  });
  ipcMain.handle(desktopChannels.discordPanel, (event, panel: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (event.sender === mainWindow?.webContents) {
      discordPresence.panel(panel);
    }
  });
  const errorReports = new ErrorReportService(resolveStructuredLogger(), app.getVersion());
  const reportWindows = new WeakSet<Electron.WebContents>();
  ipcMain.handle(desktopChannels.prepareErrorReport, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = event.sender.id;
    if (!reportWindows.has(event.sender)) {
      reportWindows.add(event.sender);
      event.sender.once('destroyed', () => errorReports.clear(owner));
    }
    let capture = await event.sender.capturePage();
    if (capture.isEmpty()) {
      throw new Error('No se pudo capturar la ventana de Battly.');
    }
    if (capture.getSize().width > 1600) {
      capture = capture.resize({ width: 1600 });
    }
    if (event.sender.isDestroyed()) {
      throw new Error('La ventana se ha cerrado.');
    }
    return errorReports.prepare(owner, capture.toDataURL());
  });
  ipcMain.handle(desktopChannels.submitErrorReport, async (event, comment: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    await errorReports.submit(event.sender.id, comment, selectedBattlyToken);
  });
  ipcMain.handle(desktopChannels.launcherReady, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      return;
    }
    patchRuntime()?.healthy();
    if (packagedApplication && !process.windowsStore && !process.env.FLATPAK_ID) {
      startupUpdateRun ??= (async () => {
        await splashPresentation?.wait();
        return showStartupUpdates(
          updates,
          () => requestUpdateAction('install'),
          (await resolveSettingsStore().snapshot()).visual.language,
          () => {
            if (splashWindow && !splashWindow.isDestroyed()) {
              splashWindow.close();
            }
            splashWindow = undefined;
          },
        );
      })();
      if (await startupUpdateRun) {
        return;
      }
    }
    if (!updateStartupChecked) {
      updateStartupChecked = true;
      updates.start(!startupUpdateRun);
    }
    await splashPresentation?.wait();
    if (splashWindow && !splashWindow.isDestroyed()) {
      startupProgress.complete('renderer', 'Battly está listo');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!mainWindow || !(await revealStartupMainWindow(mainWindow, () => !accessMonitor?.ban))) {
      void resolveStructuredLogger()
        .log('error', 'startup.main-window-not-visible', {})
        .catch(() => undefined);
      return;
    }
    startupProgress.complete('renderer', 'Battly está listo');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    splashWindow = undefined;
  });
  ipcMain.handle(desktopChannels.getAppInfo, (event) => {
    assertTrustedSender(event.senderFrame?.url);

    return { ...currentAppInfo(), online: networkAvailable() };
  });
  ipcMain.handle(desktopChannels.writeClipboardText, async (event, value: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    if (typeof value !== 'string' || value.length > 32_768) {
      throw new TypeError('Invalid clipboard text');
    }
    await writeVerifiedClipboardText(value);
    return true;
  });

  async function canUseThemeMedia(): Promise<boolean> {
    try {
      return (await resolveThemeService().sounds(await selectedBattlyToken())).premium;
    } catch {
      return false;
    }
  }
  function staticVisual<T extends { backgroundUrl: string | null }>(visual: T): T {
    return {
      ...visual,
      backgroundUrl:
        visual.backgroundUrl && /\.(png|jpe?g)$/i.test(visual.backgroundUrl)
          ? visual.backgroundUrl
          : null,
    };
  }
  ipcMain.handle(desktopChannels.getVisualPreferences, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    try {
      const visual = await readVisualPreferencesFile(visualPreferenceStorePath());
      return visual.backgroundUrl &&
        !/\.(png|jpe?g)$/i.test(visual.backgroundUrl) &&
        !(await canUseThemeMedia())
        ? staticVisual(visual)
        : visual;
    } catch {
      return defaultVisualPreferences;
    }
  });

  ipcMain.handle(desktopChannels.getSettings, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const snapshot = await resolveSettingsStore().snapshot();
    if (
      (snapshot.runtime.startupSoundEnabled ||
        (snapshot.visual.backgroundUrl &&
          !/\.(png|jpe?g)$/i.test(snapshot.visual.backgroundUrl))) &&
      !(await canUseThemeMedia())
    ) {
      return {
        ...snapshot,
        visual: staticVisual(snapshot.visual),
        runtime: { ...snapshot.runtime, startupSoundEnabled: false },
      };
    }
    return snapshot;
  });
  ipcMain.handle('settings:language', async (event) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    return (await resolveSettingsStore().snapshot()).visual.language;
  });

  ipcMain.handle(desktopChannels.previewMinecraftWindow, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) {
      throw new Error('No se encontró la ventana de Battly');
    }
    const language = (await resolveSettingsStore().snapshot()).visual.language;
    const size = await previewMinecraftWindow(
      parent,
      value,
      await nativeTranslator(language),
      language,
    );
    if (size && (value as { persist?: boolean } | null)?.persist !== false) {
      const store = resolveSettingsStore();
      const current = await store.snapshot();
      await store.save(
        normalizeSettingsDraft({
          ...current,
          runtime: { ...current.runtime, windowWidth: size.width, windowHeight: size.height },
        }),
      );
    }
    return size;
  });

  trackedHandle(desktopChannels.saveSettings, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    let draft = normalizeSettingsDraft(value);
    if (
      (draft.runtime.launchBoostEnabled ||
        draft.runtime.startupSoundEnabled ||
        (draft.visual.backgroundUrl && !/\.(png|jpe?g)$/i.test(draft.visual.backgroundUrl))) &&
      !(await canUseThemeMedia())
    ) {
      draft = {
        ...draft,
        visual: staticVisual(draft.visual),
        runtime: { ...draft.runtime, launchBoostEnabled: false, startupSoundEnabled: false },
      };
    }
    const snapshot = await resolveSettingsStore().save(draft);
    translateNative = await nativeTranslator(snapshot.visual.language);
    if (musicControlTarget && !musicControlTarget.isDestroyed()) {
      updateMusicTray(musicPlaybackState, musicControlTarget);
    }
    socialRealtimeService.updatePrivacy(snapshot.privacy);
    discordPresence.configure(snapshot.privacy);
    worldsService?.configure(snapshot.runtime.worlds);
    if (worldsDesktop) {
      await worldsDesktop.applySettings(snapshot.runtime.worlds);
    }
    if (snapshot.autoSyncEnabled && snapshot.googleDriveConnected) {
      void syncWorldsOnGameClose();
    }
    return snapshot;
  });

  ipcMain.handle(desktopChannels.worldsDiagnostics, async (event, action: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!['status', 'test', 'report', 'reset-overlay'].includes(String(action))) {
      throw new TypeError('Acción no válida');
    }
    if (action === 'reset-overlay') {
      const desktop = resolveWorldsDesktop();
      await desktop.configure({
        ...desktop.preferences(),
        position: 'top-right',
        offsetX: null,
        offsetY: null,
      });
      return 'Posición del overlay restablecida.';
    }
    const report = await resolveWorldsService().diagnostics(action === 'test');
    return `Notificaciones del sistema: ${Notification.isSupported() ? 'disponibles' : 'no disponibles'}\n${report}`;
  });

  ipcMain.handle(desktopChannels.getJvmArgs, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSettingsStore().jvmArgs();
  });

  ipcMain.handle(desktopChannels.saveJvmArgs, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSettingsStore().saveJvmArgs(normalizeJvmArgsConfig(value));
  });

  ipcMain.handle(desktopChannels.getManagedJava, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveManagedJavaRuntimeService().snapshot();
  });
  trackedHandle(
    desktopChannels.installManagedJava,
    async (event, value: unknown, provider: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveManagedJavaRuntimeService().install(
        normalizeManagedJavaMajor(value),
        normalizeJavaRuntimeProvider(provider),
      );
    },
  );
  ipcMain.handle(desktopChannels.selectManagedJava, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveManagedJavaRuntimeService().select(normalizeManagedJavaMajor(value));
  });
  ipcMain.handle(desktopChannels.clearManagedJava, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveManagedJavaRuntimeService().clearSelection();
  });

  ipcMain.handle(desktopChannels.selectJavaExecutable, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Java picker has no owning window');
    }
    let path = process.env.BATTLY_JAVA_PICKER_PATH;
    if (!path) {
      const result = await dialog.showOpenDialog(owner, {
        title: 'Seleccionar ejecutable de Java',
        properties: ['openFile'],
        ...(process.platform === 'win32'
          ? { filters: [{ name: 'Ejecutable de Java', extensions: ['exe'] }] }
          : {}),
      });
      path = result.filePaths[0];
      if (result.canceled || !path) {
        return null;
      }
    }
    if (!isAbsolute(path) || path.length > 4096) {
      throw new TypeError('Invalid Java executable path');
    }
    const normalized = resolve(path);
    const info = await lstat(normalized);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Java executable must be a regular file');
    }
    return normalized;
  });
  ipcMain.handle(desktopChannels.getBattlyDataRoot, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return battlyDataRootSnapshot();
  });
  ipcMain.handle(desktopChannels.migrateBattlyDataRoot, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (process.env.BATTLY_CONTENT_ROOT) {
      throw new Error('La ruta de Battly está fijada por el entorno');
    }
    if (rootMigrationPicking) {
      throw new Error('A migration is already being prepared');
    }
    rootMigrationPicking = true;
    try {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) {
        throw new Error('Battly path picker has no owning window');
      }
      const result = await dialog.showOpenDialog(owner, {
        title: 'Selecciona una carpeta vacía para Battly',
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0];
      if (result.canceled || !selected) {
        return null;
      }
      if (
        runningMinecraftGames.size ||
        launcherService?.active ||
        launchRequestPreparing ||
        serverRuntimeService?.active ||
        installingServerRuntimes.size ||
        labyUpdateInProgress ||
        battlyClientUpdateInProgress ||
        battlyClientUpdates.active ||
        activeIpcOperations
      ) {
        throw new Error(
          'Close Minecraft, servers and ongoing operations before moving Battly data.',
        );
      }
      rootMigrationActive = true;
      await driveAutomaticQueue;
      await googleDriveSyncService?.waitForIdle();
      const snapshot = await resolveBattlyDataRootService().migrate(selected);
      // Keep all services on the old root until the new process starts. No writes enter the new root yet.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 800);
      return snapshot;
    } catch (error) {
      rootMigrationActive = false;
      throw error;
    } finally {
      rootMigrationPicking = false;
    }
  });

  ipcMain.handle(desktopChannels.openLocalBackups, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const path =
      process.env.BATTLY_WORLD_BACKUPS_PATH || join(app.getPath('userData'), 'world-backups');
    await mkdir(path, { recursive: true });
    const error = await shell.openPath(path);
    if (error) {
      throw new Error(error);
    }
  });
  ipcMain.handle(desktopChannels.getDriveState, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveGoogleDriveSyncService().state();
  });
  ipcMain.handle(desktopChannels.disconnectDrive, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await resolveSettingsStore().disconnectDrive();
  });
  ipcMain.handle(desktopChannels.openDriveFolder, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const state = await resolveGoogleDriveSyncService().state();
    if (!state.connected) {
      throw new Error('Inicia sesión en Google Drive');
    }
    await confirmExternalLink(
      state.folderId
        ? `https://drive.google.com/drive/folders/${state.folderId}`
        : 'https://drive.google.com/drive/my-drive',
    );
  });
  trackedHandle(desktopChannels.syncGoogleDrive, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const progress = (message: string, detail?: DriveTransferProgress): void => {
      taskbarProgress.update(
        driveProgressPercent(detail) ?? 0,
        driveProgressPercent(detail) === null ? 0 : 100,
      );
      if (!event.sender.isDestroyed()) {
        event.sender.send(desktopChannels.driveProgress, { message, detail });
      }
    };
    const sources = [{ directory: contentRootPath(), scope: 'general' }];
    for (const instance of await resolveInstanceStore().list()) {
      sources.push({
        directory: await resolveInstanceStore().directoryPathInternal(instance.id),
        scope: `instance:${instance.id}`,
      });
    }
    if (sources.some((source) => otherDirectoryLaunches(Symbol(), source.directory).length)) {
      throw new Error('Cierra Minecraft antes de copiar todos los mundos');
    }
    return resolveGoogleDriveSyncService().syncWorldGroups(
      sources.map((source) => ({
        savesRoot: join(source.directory, 'saves'),
        scope: source.scope,
      })),
      progress,
    );
  });
  ipcMain.handle(desktopChannels.saveGoogleDriveCredentials, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid Google Drive credentials');
    }
    const tokens = value as Record<string, unknown>;
    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    const expiryDate = Number(tokens.expiry_date);
    const expiresIn = Number(tokens.expires_in);
    if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 16_384) {
      throw new TypeError('Invalid Google Drive access token');
    }
    if (
      refreshToken !== undefined &&
      (typeof refreshToken !== 'string' || refreshToken.length > 16_384)
    ) {
      throw new TypeError('Invalid Google Drive refresh token');
    }
    const verify = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      },
    );
    if (!verify.ok) {
      throw new Error('Google no ha autorizado el acceso a Drive');
    }
    const verified = JSON.parse(await readBoundedResponse(verify, 1024 * 1024)) as {
      user?: { emailAddress?: string };
    };
    let durableRefresh = typeof refreshToken === 'string' && refreshToken ? refreshToken : null;
    if (!durableRefresh) {
      // Google may omit refresh_token on repeated consent. Reuse only after verifying the same account.
      const previous = await resolveSettingsStore().googleDriveCredentials();
      if (previous?.refreshToken && verified.user?.emailAddress) {
        const previousAccount = await resolveGoogleDriveSyncService()
          .state()
          .catch(() => null);
        if (previousAccount?.email === verified.user.emailAddress) {
          durableRefresh = previous.refreshToken;
        }
      }
    }
    if (!durableRefresh) {
      throw new Error('Google no ha autorizado el acceso a Drive');
    }
    await resolveSettingsStore().replaceGoogleDriveCredentials({
      accessToken,
      refreshToken: durableRefresh,
      expiresAt: Number.isFinite(expiryDate)
        ? expiryDate
        : Number.isFinite(expiresIn)
          ? Date.now() + expiresIn * 1_000
          : null,
    });
    void syncWorldsOnGameClose();
    return true;
  });

  ipcMain.handle(desktopChannels.saveDiagnosticReport, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Diagnostic report has no owning window');
    }
    let path = process.env.BATTLY_DIAGNOSTIC_REPORT_PATH;
    if (!path) {
      const result = await dialog.showSaveDialog(owner, {
        title: 'Guardar diagnóstico de Battly',
        defaultPath: `battly-diagnostic-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'Informe JSON', extensions: ['json'] }],
      });
      path = result.filePath;
    }
    if (!path) {
      return { saved: false };
    }
    await resolveDiagnosticReportService().write(path);
    await resolveStructuredLogger().log('info', 'diagnostics.report-created');
    return { saved: true };
  });

  ipcMain.handle(desktopChannels.getThemes, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().library(await selectedBattlyToken());
  });
  ipcMain.handle(
    desktopChannels.getThemeMarketplace,
    async (event, query: unknown, sort: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveThemeService().marketplace(
        typeof query === 'string' ? query : '',
        sort === 'trending' ? 'trending' : 'newest',
      );
    },
  );
  ipcMain.handle(desktopChannels.saveTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().save(await selectedBattlyToken(), value);
  });
  trackedHandle(desktopChannels.applyTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().apply(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.archiveTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().archive(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.installMarketplaceTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().install(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.shareTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().share(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.requestThemeReview, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().requestReview(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.getThemeReviewStatus, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().reviewStatus(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.unpublishTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().unpublish(await selectedBattlyToken(), value);
  });
  ipcMain.handle(desktopChannels.openThemePage, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const id = normalizeThemeId(value);
    await confirmExternalLink(`https://battlylauncher.com/theme/${encodeURIComponent(id)}`);
    return true;
  });
  ipcMain.handle(desktopChannels.importTheme, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().import(await selectedBattlyToken(), value);
  });

  ipcMain.handle(desktopChannels.getHome, async (event, translateNews?: boolean) => {
    assertTrustedSender(event.senderFrame?.url);
    if (translateNews !== undefined && typeof translateNews !== 'boolean') {
      throw new TypeError('Invalid news translation preference');
    }
    return resolveHomeService().load(
      translateNews === false ? 'en' : (await resolveSettingsStore().snapshot()).visual.language,
    );
  });
  ipcMain.handle(desktopChannels.getNewsState, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveNewsStateService().state();
  });
  ipcMain.handle(desktopChannels.completeNews, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveNewsStateService().complete();
  });
  ipcMain.handle(desktopChannels.getMyBattly, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    void sampleDesktopUsage().catch(() => undefined);
    const [accounts, modReport, worlds, resourcePacks, backupCount, latestBackupAt] =
      await Promise.all([
        resolveAccountStore().store.list(),
        resolveLocalModStore().compatibilityReport(),
        resolveContentLibraryService().worlds(),
        resolveContentLibraryService().resourcePacks(),
        resolveSettingsStore().backupCount(),
        resolveSettingsStore().latestBackupAt(),
      ]);
    const selected = accounts.accounts.find(
      (account) => account.uuid === accounts.selectedAccountUuid,
    );
    let playedSeconds: number | null = null;
    let cloudUsageHistory: ImportedUsageDay[] | undefined;
    let social: {
      friendCount: number;
      onlineFriendCount: number;
      receivedRequestCount: number;
      receivedRequests: readonly string[];
    } | null = null;
    if (selected?.type === 'battly') {
      try {
        const { token } = await selectedBattlyIdentity(true);
        const signal = AbortSignal.timeout(2_500);
        const [statistics, socialSnapshot] = await Promise.allSettled([
          resolveSocialService().desktopUsage(token, signal),
          resolveSocialService().snapshot(token, signal),
        ]);
        if (statistics.status === 'fulfilled') {
          playedSeconds = statistics.value.playedSeconds;
          cloudUsageHistory = statistics.value.days;
        }
        if (socialSnapshot.status === 'fulfilled') {
          social = {
            friendCount: socialSnapshot.value.friends.length,
            onlineFriendCount: socialSnapshot.value.friends.filter(
              (friend) => friend.status === 'online',
            ).length,
            receivedRequestCount: socialSnapshot.value.receivedRequests.length,
            receivedRequests: socialSnapshot.value.receivedRequests,
          };
        }
      } catch {
        // MyBattly's local content remains available when the Battly API is offline.
      }
    }
    return {
      username: selected?.name ?? '',
      mods: modReport.mods,
      worlds,
      resourcePacks,
      backupCount,
      latestBackupAt,
      playedSeconds,
      social,
      usageHistory: cloudUsageHistory,
    };
  });
  ipcMain.handle(desktopChannels.archiveWorld, async (event, name: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveContentLibraryService().archiveWorld(normalizeContentName(name));
  });
  ipcMain.handle(desktopChannels.toggleResourcePack, async (event, name: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveContentLibraryService().toggleResourcePack(normalizeContentName(name));
  });
  ipcMain.handle(desktopChannels.archiveResourcePack, async (event, name: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveContentLibraryService().archiveResourcePack(normalizeContentName(name));
  });
  ipcMain.handle(desktopChannels.getWorldBackups, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const [local, cloud] = await Promise.all([
      resolveWorldBackupService().list(),
      resolveGoogleDriveSyncService().listBackups(),
    ]);
    return [...cloud, ...local.map((entry) => ({ ...entry, storage: 'local' as const }))];
  });
  trackedHandle(desktopChannels.restoreWorldBackup, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string' || !/^(snapshot|drive):[A-Za-z0-9_-]{1,256}$/.test(id)) {
      throw new Error('Invalid backup');
    }
    return resolveGoogleDriveSyncService().restore(
      id,
      join(contentRootPath(), 'saves'),
      (message, detail) => {
        taskbarProgress.update(
          driveProgressPercent(detail) ?? 0,
          driveProgressPercent(detail) === null ? 0 : 100,
        );
        if (!event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.driveProgress, { message, detail });
        }
      },
    );
  });
  ipcMain.handle(desktopChannels.getBackupWorlds, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const sources = [
      { directory: contentRootPath(), instanceId: null as string | null, label: 'General' },
    ];
    for (const instance of await resolveInstanceStore().list()) {
      sources.push({
        directory: await resolveInstanceStore().directoryPathInternal(instance.id),
        instanceId: instance.id,
        label: instance.name,
      });
    }
    const worlds: { name: string; instanceId: string | null; label: string }[] = [];
    for (const source of sources) {
      const saves = join(source.directory, 'saves');
      if (!(await pathExists(saves))) {
        continue;
      }
      for (const entry of await readdir(saves, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          (await pathExists(join(saves, entry.name, 'level.dat')))
        ) {
          worlds.push({ name: entry.name, instanceId: source.instanceId, label: source.label });
        }
      }
    }
    return worlds;
  });
  trackedHandle(
    desktopChannels.createWorldBackup,
    async (event, name: unknown, instanceId: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (instanceId !== undefined && typeof instanceId !== 'string') {
        throw new Error('Invalid instance');
      }
      const directory =
        typeof instanceId === 'string'
          ? await resolveInstanceStore().directoryPathInternal(instanceId)
          : contentRootPath();
      if (otherDirectoryLaunches(Symbol(), directory).length) {
        throw new Error('Cierra Minecraft antes de crear una copia');
      }
      const result = await resolveGoogleDriveSyncService().syncWorlds(
        join(directory, 'saves'),
        undefined,
        normalizeContentName(name),
        (message, detail) => {
          taskbarProgress.update(
            driveProgressPercent(detail) ?? 0,
            driveProgressPercent(detail) === null ? 0 : 100,
          );
          if (!event.sender.isDestroyed()) {
            event.sender.send(desktopChannels.driveProgress, { message, detail });
          }
        },
        typeof instanceId === 'string' ? `instance:${instanceId}` : 'general',
      );
      if (!result.success) {
        throw new Error('Inicia sesión en Google Drive para guardar tus mundos');
      }
      return resolveGoogleDriveSyncService().listBackups();
    },
  );
  ipcMain.handle(desktopChannels.archiveWorldBackup, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id === 'string' && (id.startsWith('drive:') || id.startsWith('snapshot:'))) {
      await resolveGoogleDriveSyncService().archiveBackup(id);
      return resolveGoogleDriveSyncService().listBackups();
    }
    return resolveWorldBackupService().archive(normalizeBackupId(id));
  });
  ipcMain.handle(desktopChannels.getOnboarding, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSettingsStore().onboardingState();
  });
  ipcMain.handle(desktopChannels.selectInitialLanguage, async (event, language: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const selected = normalizeInitialLanguage(language);
    const state = await resolveSettingsStore().selectInitialLanguage(selected);
    translateNative = await nativeTranslator(selected);
    if (musicControlTarget && !musicControlTarget.isDestroyed()) {
      updateMusicTray(musicPlaybackState, musicControlTarget);
    }
    return state;
  });
  ipcMain.handle(desktopChannels.completeWelcome, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSettingsStore().completeWelcome();
  });
  ipcMain.handle(desktopChannels.getServers, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerStore().list();
  });
  const serverSoftwareCatalog = new ServerModloaderCatalog();
  ipcMain.handle(desktopChannels.getServerSoftwareAvailability, (event, version: string) => {
    assertTrustedSender(event.senderFrame?.url);
    return serverSoftwareCatalog.availability(version);
  });
  trackedHandle(
    desktopChannels.createServer,
    async (event, value: unknown, software: unknown = 'vanilla') => {
      assertTrustedSender(event.senderFrame?.url);
      const draft = normalizeServerDraft(value);
      if (!draft.eulaAccepted) {
        throw new Error('Debes aceptar el EULA de Minecraft para crear el servidor.');
      }
      await serverSoftwareCatalog.assertAvailable(
        draft.version,
        normalizeServerSoftwareKind(software),
      );
      return resolveServerStore().create(draft, 1);
    },
  );
  ipcMain.handle(
    desktopChannels.updateServerProperties,
    async (event, id: unknown, value: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalized = normalizeServerId(id);
      if (installingServerRuntimes.has(normalized)) {
        throw new Error('Espera a que termine la operación del servidor');
      }
      const result = await resolveServerStore().updateProperties(
        normalized,
        normalizeServerProperties(value),
      );
      void syncServerConfigurations(normalized, 'server.properties');
      return result;
    },
  );
  trackedHandle(desktopChannels.archiveServer, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    if (installingServerRuntimes.has(normalized)) {
      throw new Error('Espera a que termine la operación actual del servidor');
    }
    installingServerRuntimes.add(normalized);
    try {
      await resolveServerSharingService().stopTunnel(normalized);
      await resolveServerRuntimeService().stopAndWait(normalized);
      await resolveServerSharingService().deleteRemoteServer(
        normalized,
        await selectedBattlyToken(),
      );
      return await resolveServerStore().remove(normalized);
    } finally {
      installingServerRuntimes.delete(normalized);
    }
  });
  ipcMain.handle(desktopChannels.getServerRuntime, (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerRuntimeService().snapshot(normalizeServerId(id));
  });
  trackedHandle(desktopChannels.startServerRuntime, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    if (installingServerRuntimes.has(normalized)) {
      throw new Error('Server installation is active');
    }
    const token = await selectedBattlyToken();
    const runtime = resolveServerRuntimeService();
    await resolveServerSharingService().assertProviderDomain(normalized);
    await runtime.start(normalized);
    if (!['starting', 'running'].includes(runtime.snapshot(normalized).status)) {
      return runtime.snapshot(normalized);
    }
    await resolveServerSharingService().startTunnel(normalized, token);
    void syncServerConfigurations(normalized);
    return runtime.snapshot(normalized);
  });
  trackedHandle(desktopChannels.stopServerRuntime, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    const runtime = resolveServerRuntimeService();
    runtime.stop(normalized);
    await resolveServerSharingService().stopTunnel(normalized);
    return runtime.snapshot(normalized);
  });
  ipcMain.handle(desktopChannels.restartServerRuntime, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    if (installingServerRuntimes.has(normalized)) {
      throw new Error('Espera a que termine la operación actual del servidor');
    }
    const token = await selectedBattlyToken();
    await resolveServerSharingService().assertProviderDomain(normalized);
    await resolveServerSharingService().stopTunnel(normalized);
    const runtime = resolveServerRuntimeService();
    await runtime.restart(normalized);
    await resolveServerSharingService().startTunnel(normalized, token);
    void syncServerConfigurations(normalized);
    return runtime.snapshot(normalized);
  });
  ipcMain.handle(desktopChannels.sendServerCommand, (event, id: unknown, command: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    resolveServerRuntimeService().command(normalizeServerId(id), normalizeServerCommand(command));
  });
  trackedHandle(
    desktopChannels.installServer,
    async (
      event,
      id: unknown,
      software: unknown = 'vanilla',
      acceptCompatiblePaper: unknown = false,
    ) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalized = normalizeServerId(id);
      const runtime = resolveServerRuntimeService().snapshot(normalized);
      if (!['stopped', 'error'].includes(runtime.status)) {
        throw new Error('Stop the server before installing its runtime');
      }
      const normalizedSoftware = normalizeServerSoftwareKind(software);
      const server = (await resolveServerStore().list()).find((entry) => entry.id === normalized);
      if (!server) {
        throw new Error('Servidor no encontrado');
      }
      await serverSoftwareCatalog.assertAvailable(server.version, normalizedSoftware);
      if (installingServerRuntimes.has(normalized)) {
        throw new Error('Server installation is active');
      }
      installingServerRuntimes.add(normalized);
      try {
        if (
          normalizedSoftware === 'forge' ||
          normalizedSoftware === 'neoforge' ||
          normalizedSoftware === 'spigot'
        ) {
          await resolveServerModloaderInstallerService().preflight(normalized, normalizedSoftware);
          const directory = await resolveServerStore().directoryPathInternal(normalized);
          const javaExists = await lstat(
            join(directory, 'java', 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
          )
            .then((info) => info.isFile() && !info.isSymbolicLink())
            .catch(() => false);
          if (!javaExists) {
            await resolveServerInstallerService().install(normalized, 'vanilla');
          }
          taskbarProgress.update(0, 0);
          event.sender.send(desktopChannels.serverInstallProgress, {
            id: normalized,
            phase: 'loader',
            completedBytes: 0,
            totalBytes: 0,
            current: `Instalando ${normalizedSoftware}. La primera instalación puede tardar varios minutos.`,
          });
          await resolveServerModloaderInstallerService().install(normalized, normalizedSoftware);
          event.sender.send(desktopChannels.serverInstallProgress, {
            id: normalized,
            phase: 'complete',
            completedBytes: 1,
            totalBytes: 1,
            current: `${normalizedSoftware} instalado`,
          });
        } else {
          await resolveServerInstallerService().install(
            normalized,
            normalizedSoftware,
            acceptCompatiblePaper === true,
          );
        }
      } finally {
        installingServerRuntimes.delete(normalized);
      }
    },
  );
  ipcMain.handle(desktopChannels.getServerPlayerLists, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerPlayerListService().snapshot(normalizeServerId(id));
  });
  ipcMain.handle(
    desktopChannels.mutateServerPlayerList,
    async (event, id: unknown, value: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalizedId = normalizeServerId(id);
      const mutation = normalizeServerPlayerListMutation(value);
      const snapshot = await resolveServerPlayerListService().mutate(normalizedId, mutation);
      void syncServerConfigurations(normalizedId);
      if (resolveServerRuntimeService().snapshot(normalizedId).status === 'running') {
        const command =
          mutation.kind === 'banned'
            ? `${mutation.action === 'add' ? 'ban' : 'pardon'} ${mutation.name}`
            : mutation.kind === 'whitelist'
              ? `whitelist ${mutation.action} ${mutation.name}`
              : mutation.kind === 'operators'
                ? `${mutation.action === 'add' ? 'op' : 'deop'} ${mutation.name}`
                : mutation.action === 'add'
                  ? `kick ${mutation.name} Lista negra de Battly`
                  : null;
        if (command) {
          try {
            resolveServerRuntimeService().command(normalizedId, command);
          } catch {
            // The files remain the source of truth if the process stops during this action.
          }
        }
      }
      return snapshot;
    },
  );
  ipcMain.handle(desktopChannels.listServerFiles, async (event, id: unknown, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerFileService().list(normalizeServerId(id), path);
  });
  ipcMain.handle(desktopChannels.readServerFile, async (event, id: unknown, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerFileService().read(normalizeServerId(id), path);
  });
  ipcMain.handle(
    desktopChannels.writeServerFile,
    async (event, id: unknown, path: unknown, content: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalized = normalizeServerId(id);
      const result = await resolveServerFileService().write(normalized, path, content);
      if (typeof path === 'string' && !path.includes('/') && !path.includes('\\')) {
        void syncServerConfigurations(normalized, path);
      }
      return result;
    },
  );
  ipcMain.handle(desktopChannels.exportServerFile, async (event, id: unknown, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const source = await resolveServerFileService().absoluteFilePath(normalizeServerId(id), path);
    const result = await dialog.showSaveDialog({
      title: 'Guardar archivo del servidor',
      defaultPath: join(app.getPath('downloads'), basename(source)),
    });
    if (result.canceled || !result.filePath) {
      return false;
    }
    if (resolve(source) !== resolve(result.filePath)) {
      await copyFile(source, result.filePath);
    }
    return true;
  });
  ipcMain.handle(desktopChannels.revealServerFile, async (event, id: unknown, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    shell.showItemInFolder(
      await resolveServerFileService().absoluteFilePath(normalizeServerId(id), path),
    );
  });
  ipcMain.handle(desktopChannels.archiveServerFile, async (event, id: unknown, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    const runtime = resolveServerRuntimeService().snapshot(normalized);
    if (!['stopped', 'error'].includes(runtime.status)) {
      throw new Error('Stop the server before archiving files');
    }
    await resolveServerFileService().archive(normalized, path);
  });
  ipcMain.handle(desktopChannels.importServerWorld, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    const runtime = resolveServerRuntimeService().snapshot(normalized);
    if (!['stopped', 'error'].includes(runtime.status)) {
      throw new Error('Stop the server before importing a world');
    }
    const fixturePath = process.env.BATTLY_SERVER_WORLD_IMPORT_PATH;
    let selected = fixturePath;
    if (!selected) {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) {
        throw new Error('World picker has no owning window');
      }
      const result = await dialog.showOpenDialog(owner, {
        title: 'Importar mundo del servidor',
        properties: ['openFile'],
        filters: [{ name: 'Mundo comprimido', extensions: ['zip'] }],
      });
      selected = result.filePaths[0];
      if (result.canceled || !selected) {
        return false;
      }
    }
    await resolveServerWorldImportService().import(normalized, selected);
    return true;
  });
  ipcMain.handle(desktopChannels.getServerContent, async (event, id: unknown, kind: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerContentService().list(
      normalizeServerId(id),
      normalizeServerContentKind(kind),
    );
  });
  ipcMain.handle(desktopChannels.importServerContent, async (event, id: unknown, kind: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalizedId = normalizeServerId(id);
    const normalizedKind = normalizeServerContentKind(kind);
    const runtime = resolveServerRuntimeService().snapshot(normalizedId);
    if (!['stopped', 'error'].includes(runtime.status)) {
      throw new Error('Stop the server before importing content');
    }
    let selected = process.env.BATTLY_SERVER_CONTENT_IMPORT_PATH;
    if (!selected) {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) {
        throw new Error('Content picker has no owning window');
      }
      const result = await dialog.showOpenDialog(owner, {
        title:
          normalizedKind === 'mods' ? 'Importar mod del servidor' : 'Importar plugin del servidor',
        properties: ['openFile'],
        filters: [{ name: 'Archivo JAR', extensions: ['jar'] }],
      });
      selected = result.filePaths[0];
      if (result.canceled || !selected) {
        return null;
      }
    }
    return resolveServerContentService().import(normalizedId, normalizedKind, selected);
  });
  ipcMain.handle(
    desktopChannels.toggleServerContent,
    async (event, id: unknown, kind: unknown, name: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalizedId = normalizeServerId(id);
      const runtime = resolveServerRuntimeService().snapshot(normalizedId);
      if (!['stopped', 'error'].includes(runtime.status)) {
        throw new Error('Stop the server before changing content');
      }
      return resolveServerContentService().toggle(
        normalizedId,
        normalizeServerContentKind(kind),
        normalizeServerContentName(name),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.archiveServerContent,
    async (event, id: unknown, kind: unknown, name: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalizedId = normalizeServerId(id);
      const runtime = resolveServerRuntimeService().snapshot(normalizedId);
      if (!['stopped', 'error'].includes(runtime.status)) {
        throw new Error('Stop the server before archiving content');
      }
      return resolveServerContentService().archive(
        normalizedId,
        normalizeServerContentKind(kind),
        normalizeServerContentName(name),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.openServerContentFolder,
    async (event, id: unknown, kind: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const path = await resolveServerContentService().directory(
        normalizeServerId(id),
        normalizeServerContentKind(kind),
      );
      const error = await shell.openPath(path);
      if (error) {
        throw new Error(error);
      }
    },
  );
  ipcMain.handle(desktopChannels.getServerSharing, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerSharingService().snapshot(
      normalizeServerId(id),
      await selectedBattlyToken(),
    );
  });
  ipcMain.handle(desktopChannels.startServerTunnel, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    if (resolveServerRuntimeService().snapshot(normalized).status !== 'running') {
      throw new Error('Inicia el servidor antes de abrir el túnel');
    }
    return resolveServerSharingService().startTunnel(normalized, await selectedBattlyToken());
  });
  ipcMain.handle(desktopChannels.stopServerTunnel, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerSharingService().stopTunnel(
      normalizeServerId(id),
      await selectedBattlyToken(),
    );
  });
  ipcMain.handle(desktopChannels.inviteServerFriend, async (event, id: unknown, draft: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveServerSharingService().invite(
      normalizeServerId(id),
      normalizeServerInviteDraft(draft),
      await selectedBattlyToken(),
    );
  });
  ipcMain.handle(
    desktopChannels.revokeServerPermission,
    async (event, id: unknown, username: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveServerSharingService().revoke(
        normalizeServerId(id),
        username,
        await selectedBattlyToken(),
      );
    },
  );
  ipcMain.handle(desktopChannels.getCapes, async (event, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    return resolveSkinService().capes(identity.token, identity.username);
  });
  for (const [channel, action] of [
    [desktopChannels.setCape, 'establecer'],
    [desktopChannels.deleteCape, 'eliminar'],
    [desktopChannels.removeCape, 'quitar'],
  ] as const) {
    ipcMain.handle(channel, async (event, id: unknown, accountUuid: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const identity = await selectedBattlyIdentity(true, accountUuid);
      return resolveSkinService().changeCape(
        identity.token,
        action,
        action === 'quitar' ? undefined : normalizeSkinId(id),
      );
    });
  }
  ipcMain.handle(desktopChannels.uploadCape, async (event, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    if (!(await resolveSkinService().capes(identity.token, identity.username)).premium) {
      throw new Error('Necesitas Battly+ para subir capas propias');
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('No se pudo abrir el selector de capa');
    }
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Seleccionar capa (PNG 64x32, hasta 100 KB)',
      properties: ['openFile'],
      filters: [{ name: 'Capa PNG', extensions: ['png'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return null;
    }
    const current = await selectedBattlyIdentity(true, accountUuid);
    if (identity.token !== current.token) {
      throw new Error('La cuenta activa ha cambiado. Vuelve a abrir el personalizador.');
    }
    return resolveSkinService().uploadCape(
      identity.token,
      identity.premium,
      selection.filePaths[0],
    );
  });
  ipcMain.handle(desktopChannels.getSkins, async (event, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    return resolveSkinService().snapshot(identity.token, identity.username, identity.premium);
  });
  ipcMain.handle(desktopChannels.uploadSkin, async (event, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Skin picker has no owning window');
    }
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Seleccionar skin de Minecraft',
      properties: ['openFile'],
      filters: [{ name: 'Skin PNG', extensions: ['png'] }],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) {
      return null;
    }
    const current = await selectedBattlyIdentity(true, accountUuid);
    if (current.token !== identity.token) {
      throw new Error('La cuenta activa ha cambiado. Vuelve a abrir el personalizador.');
    }
    return resolveSkinService().upload(identity.token, identity.username, identity.premium, path);
  });
  ipcMain.handle(desktopChannels.setSkin, async (event, id: unknown, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    return resolveSkinService().set(
      identity.token,
      identity.username,
      identity.premium,
      normalizeSkinId(id),
    );
  });
  ipcMain.handle(desktopChannels.deleteSkin, async (event, id: unknown, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    return resolveSkinService().delete(
      identity.token,
      identity.username,
      identity.premium,
      normalizeSkinId(id),
    );
  });
  ipcMain.handle(desktopChannels.searchMods, async (event, request: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    recommendedMods ??= new RecommendedMods(
      join(app.getPath('userData'), 'cache', 'recommended-mods.json'),
    );
    const [result, recommendations] = await Promise.all([
      resolveModrinthClient().search(normalizeModSearchRequest(request)),
      recommendedMods.load(),
    ]);
    const ids = new Set(recommendations.modrinth);
    return {
      ...result,
      projects: result.projects.map((project) => ({
        ...project,
        recommendedByBattly: ids.has(project.id),
      })),
    };
  });
  ipcMain.handle(desktopChannels.getModVersionCatalog, async (event, projectId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeModInstallRequest({
      projectId,
      projectType: 'mod',
      gameVersion: '1.20.1',
      loader: 'minecraft',
    });
    return (
      await resolveModrinthClient()
        .projectVersions(normalized.projectId, '', '')
        .catch((error) => {
          if (isNetworkFailure(error)) {
            return [];
          }
          throw error;
        })
    )
      .filter((version) => version.files.length)
      .map(({ id, gameVersions, loaders }) => ({ id, gameVersions, loaders }));
  });
  ipcMain.handle(desktopChannels.getModProjectDetails, async (event, request: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeModInstallRequest(request);
    const [project, versions] = await Promise.all([
      resolveModrinthClient()
        .project(normalized.projectId)
        .catch(() => null),
      resolveModrinthClient().projectVersions(
        normalized.projectId,
        normalized.gameVersion,
        normalized.loader,
        undefined,
        true,
      ),
    ]);
    const creators = project
      ? await resolveModrinthClient()
          .projectMembers(project.teamId)
          .catch(() => [])
      : [];
    return {
      body: project?.body ?? '',
      categories: project?.categories ?? [],
      creators,
      discordUrl: project?.discordUrl ?? null,
      downloads: project?.downloads ?? 0,
      followers: project?.followers ?? 0,
      gallery: project?.gallery ?? [],
      projectId: normalized.projectId,
      gameVersion: normalized.gameVersion,
      licenseId: project?.licenseId ?? 'unknown',
      licenseName: project?.licenseName ?? 'Desconocida',
      licenseUrl: project?.licenseUrl ?? null,
      loader: normalized.loader,
      loaders: project?.loaders ?? [normalized.loader],
      published: project?.published ?? '',
      sourceUrl: project?.sourceUrl ?? null,
      updated: project?.updated ?? '',
      wikiUrl: project?.wikiUrl ?? null,
      versions: versions.flatMap((version) => {
        const file = version.files.find((candidate) => candidate.primary) ?? version.files[0];
        if (!file) {
          return [];
        }
        return [
          {
            changelog: version.changelog,
            datePublished: version.datePublished,
            downloads: version.downloads,
            id: version.id,
            name: version.name,
            filename: file.filename,
            size: file.size,
            versionNumber: version.versionNumber,
            dependencies: version.dependencies.map((dependency) => ({
              type: dependency.dependencyType,
              projectId: dependency.projectId,
              versionId: dependency.versionId,
            })),
          },
        ];
      }),
    };
  });
  trackedHandle(desktopChannels.installModBasket, async (event, raw: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = normalizeModBasketRequest(raw);
    let directory = contentRootPath();
    let targetLoaderVersion: string | undefined;
    const validateDestination = async (): Promise<void> => {
      if (request.destinationInstanceId) {
        const instance = await resolveInstanceStore().readInternal(request.destinationInstanceId);
        if (instance.version !== request.gameVersion || instance.loader !== request.loader) {
          throw new Error('Comprueba que la versión y el loader coinciden con la instancia.');
        }
        directory = await resolveInstanceStore().directoryPathInternal(
          request.destinationInstanceId,
        );
        targetLoaderVersion =
          typeof instance.loaderVersion === 'string' && instance.loaderVersion !== 'latest'
            ? instance.loaderVersion
            : undefined;
      }
      if (request.destinationServerId) {
        const id = normalizeServerId(request.destinationServerId);
        const server = (await resolveServerStore().list()).find((value) => value.id === id);
        if (!server?.software.installedAt) {
          throw new Error('Instala primero el software del servidor');
        }
        if (!['stopped', 'error'].includes(resolveServerRuntimeService().snapshot(id).status)) {
          throw new Error('Detén el servidor antes de instalar mods');
        }
        if (
          server.software.kind !== request.loader ||
          (server.software.gameVersion ?? server.version) !== request.gameVersion
        ) {
          throw new Error('El mod debe coincidir con la versión y el loader del servidor');
        }
        directory = await resolveServerStore().directoryPathInternal(id);
        targetLoaderVersion = server.software.build ?? undefined;
      }
      if (
        !request.destinationServerId &&
        otherDirectoryLaunches(Symbol('mod-basket'), directory).length
      ) {
        throw new Error('Cierra Minecraft antes de instalar la cesta de mods');
      }
    };
    const serverId = request.destinationServerId
      ? normalizeServerId(request.destinationServerId)
      : undefined;
    if (serverId && installingServerRuntimes.has(serverId)) {
      throw new Error('Espera a que termine la operación del servidor');
    }
    if (serverId) {
      installingServerRuntimes.add(serverId);
    }
    try {
      await validateDestination();
      return await new ModBasketInstaller(
        resolveModrinthClient(),
        directory,
        targetLoaderVersion,
        contentRootPath(),
      ).install(
        request,
        remoteOperationContext.getStore(),
        (progress) => {
          taskbarProgress.update(progress.current, progress.total);
          if (!event.sender.isDestroyed()) {
            event.sender.send(desktopChannels.modBasketProgress, progress);
          }
        },
        validateDestination,
      );
    } finally {
      if (serverId) {
        installingServerRuntimes.delete(serverId);
      }
    }
  });
  trackedHandle(desktopChannels.installMod, async (event, request: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeModInstallRequest(request);
    if (normalized.projectType === 'modpack') {
      const instance = await resolveModrinthModpackInstaller().install(
        normalized,
        remoteOperationContext.getStore(),
        modpackProgressTo(event.sender),
      );
      const installedInstance = await resolveInstanceArtworkCache().enrich(
        instance,
        normalized.projectId,
      );
      return { installed: [instance.name], instance: installedInstance };
    }
    if (normalized.destinationServerId) {
      const id = normalizeServerId(normalized.destinationServerId);
      if (installingServerRuntimes.has(id)) {
        throw new Error('Espera a que termine la operación del servidor');
      }
      installingServerRuntimes.add(id);
      try {
        const server = (await resolveServerStore().list()).find((entry) => entry.id === id);
        if (!server || !server.software.installedAt) {
          throw new Error('Instala primero el software del servidor');
        }
        if (!['stopped', 'error'].includes(resolveServerRuntimeService().snapshot(id).status)) {
          throw new Error('Detén el servidor antes de instalar mods');
        }
        if (
          !['forge', 'fabric', 'neoforge'].includes(server.software.kind) ||
          normalized.loader !== server.software.kind ||
          normalized.gameVersion !== (server.software.gameVersion ?? server.version)
        ) {
          throw new Error('El mod debe coincidir con la versión y el loader del servidor');
        }
        const directory = await resolveServerStore().directoryPathInternal(id);
        return await new ModInstaller(resolveModrinthClient(), directory).install(
          normalized,
          remoteOperationContext.getStore(),
          (current, total) => {
            taskbarProgress.update(current, total);
            socialRealtimeService.publishRemote({ type: 'mod-progress', current, total });
          },
        );
      } finally {
        installingServerRuntimes.delete(id);
      }
    }
    if (normalized.destinationInstanceId) {
      const instanceDirectory = await resolveInstanceStore().directoryPathInternal(
        normalized.destinationInstanceId,
      );
      return new ModInstaller(resolveModrinthClient(), instanceDirectory).install(
        normalized,
        remoteOperationContext.getStore(),
        (current, total) => {
          taskbarProgress.update(current, total);
          socialRealtimeService.publishRemote({ type: 'mod-progress', current, total });
        },
      );
    }
    return resolveModInstaller().install(
      normalized,
      remoteOperationContext.getStore(),
      (current, total) => {
        taskbarProgress.update(current, total);
        socialRealtimeService.publishRemote({ type: 'mod-progress', current, total });
      },
    );
  });
  ipcMain.handle(
    desktopChannels.openModrinthProject,
    async (event, projectId: unknown, projectType: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const normalized = normalizeModInstallRequest({
        projectId,
        projectType,
        gameVersion: '1.20.1',
        loader: 'minecraft',
      });
      const typePath = normalized.projectType === 'modpack' ? 'modpack' : normalized.projectType;
      await confirmExternalLink(
        `https://modrinth.com/${encodeURIComponent(typePath)}/${encodeURIComponent(normalized.projectId)}`,
      );
    },
  );
  ipcMain.handle(desktopChannels.getLocalMods, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLocalModStore().list();
  });
  ipcMain.handle(desktopChannels.toggleLocalMod, async (event, filename: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLocalModStore().toggle(normalizeLocalModFilename(filename));
  });
  ipcMain.handle(
    desktopChannels.batchLocalMods,
    async (event, action: unknown, filenames: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveLocalModStore().batch(action, filenames);
    },
  );
  ipcMain.handle(
    desktopChannels.getModDisableDependents,
    async (event, filename: unknown, instanceId: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const name = normalizeLocalModFilename(filename);
      let store = resolveLocalModStore();
      if (instanceId !== undefined) {
        if (typeof instanceId !== 'string') {
          throw new Error('Instancia inválida');
        }
        const directory = await resolveInstanceStore().directoryPathInternal(instanceId);
        store = new LocalModStore(
          join(directory, 'mods'),
          join(directory, '.battly-content-archive', 'mods'),
        );
      }
      const { mods } = await store.compatibilityReport();
      const selected = mods.find((mod) => mod.filename === name && mod.enabled);
      if (!selected?.id) {
        return [];
      }
      const disabledIds = new Set([selected.id]);
      const affected = new Map<string, { filename: string; name: string }>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const mod of mods) {
          if (
            !mod.enabled ||
            mod.filename === name ||
            affected.has(mod.filename) ||
            !mod.dependencies.some((id) => disabledIds.has(id))
          ) {
            continue;
          }
          affected.set(mod.filename, { filename: mod.filename, name: mod.name });
          if (mod.id) {
            disabledIds.add(mod.id);
          }
          changed = true;
        }
      }
      return [...affected.values()];
    },
  );
  ipcMain.handle(desktopChannels.revealLocalMod, async (event, filename: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    shell.showItemInFolder(
      await resolveLocalModStore().revealPath(normalizeLocalModFilename(filename)),
    );
  });
  ipcMain.handle(desktopChannels.openLocalMod, async (event, filename: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const path = await resolveLocalModStore().revealPath(normalizeLocalModFilename(filename));
    shell.showItemInFolder(path);
  });
  ipcMain.handle(desktopChannels.archiveLocalMod, async (event, filename: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLocalModStore().archive(normalizeLocalModFilename(filename));
  });
  ipcMain.handle(desktopChannels.openModsFolder, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const modsPath = join(contentRootPath(), 'mods');
    await mkdir(modsPath, { recursive: true });
    return (await shell.openPath(modsPath)) === '';
  });
  ipcMain.handle(desktopChannels.analyzeLocalMods, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLocalModStore().compatibilityReport();
  });
  let repairingLocalMods = false;
  ipcMain.handle(desktopChannels.disableIncompatibleMods, async (event, target: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (repairingLocalMods) {
      throw new Error('Espera a que termine la reparación de mods');
    }
    repairingLocalMods = true;
    try {
      return target
        ? await resolveLocalModStore().repair(target, async (id, chosen) => {
            // Fixed, reviewed project identifiers. Never install a fuzzy search result as a dependency.
            const projects: Record<string, string> = {
              fabric: 'P7dR8mSH',
              'fabric-api': 'P7dR8mSH',
              sodium: 'AANobbMI',
              iris: 'YL57xq9U',
              cloth_config: '9s6osm5g',
              'cloth-config': '9s6osm5g',
              modmenu: 'mOgUt4GM',
            };
            const projectId = projects[id];
            if (!projectId) {
              return [];
            }
            const result = await new ModInstaller(
              resolveModrinthClient(),
              contentRootPath(),
            ).install(
              {
                projectId,
                gameVersion: chosen.gameVersion!,
                loader: chosen.loader!,
                projectType: 'mod',
              },
              AbortSignal.timeout(120_000),
            );
            return result.installed;
          })
        : await resolveLocalModStore().disableIncompatible();
    } finally {
      repairingLocalMods = false;
    }
  });
  trackedHandle(desktopChannels.importMrpack, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Mrpack picker has no owning window');
    }
    const result = await dialog.showOpenDialog(owner, {
      title: 'Instalar ModPack',
      properties: ['openFile'],
      filters: [
        {
          name: 'ModPack de Battly, Modrinth o CurseForge',
          extensions: ['bypack', 'mrpack', 'zip'],
        },
        { name: 'Battly Pack', extensions: ['bypack'] },
        { name: 'Modrinth ModPack', extensions: ['mrpack'] },
        { name: 'CurseForge ModPack', extensions: ['zip'] },
      ],
    });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) {
      return null;
    }
    if (extname(selected).toLowerCase() === '.bypack') {
      event.sender.send(desktopChannels.bypackOpenRequested, selected);
      return null;
    }
    return installLocalModpackPath(selected, modpackProgressTo(event.sender));
  });
  trackedHandle(desktopChannels.importDroppedMrpack, async (event, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof path === 'string' && extname(path).toLowerCase() === '.bypack') {
      event.sender.send(desktopChannels.bypackOpenRequested, path);
      return null;
    }
    return installLocalModpackPath(path, modpackProgressTo(event.sender));
  });
  ipcMain.handle(desktopChannels.getMusic, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().snapshot(await selectedBattlyToken());
  });
  trackedHandle(desktopChannels.recordMusicPlay, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().recordPlay(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(id),
    );
  });
  trackedHandle(
    desktopChannels.resolveMusicSource,
    async (event, id: unknown, quality: unknown, source: unknown, refresh: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const songId = normalizeMusicIdentifier(id);
      const audioQuality = normalizeMusicQuality(quality);
      if (refresh === true) {
        await resolveMusicAudioCache().invalidate(songId, audioQuality);
        resolveYtDlpResolver().invalidate(songId, audioQuality);
      }
      let sourceUrl: string | undefined;
      if (source !== undefined && source !== null) {
        if (typeof source !== 'string' || source.length > 8192) {
          throw new TypeError('Invalid music source');
        }
        const url = new URL(source);
        if (url.protocol !== 'https:' || url.username || url.password) {
          throw new TypeError('Invalid music source');
        }
        const expiry = Number(url.searchParams.get('expire')) * 1000;
        const expired = Number.isFinite(expiry) && expiry > 0 && expiry <= Date.now() + 60000;
        // Persisted playlists may still contain a signed CDN URL from days ago.
        if (refresh !== true && !expired) {
          sourceUrl = url.toString();
        }
      }
      return resolveMusicAudioCache().resolve(songId, audioQuality, () =>
        sourceUrl
          ? Promise.resolve(sourceUrl)
          : resolveYtDlpResolver().resolve(songId, audioQuality),
      );
    },
  );
  trackedHandle(desktopChannels.searchMusic, (event, query: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveYtDlpResolver().search(normalizeMusicSearchQuery(query));
  });
  ipcMain.handle(desktopChannels.resolveMusicMetadata, (event, ids: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveYtDlpResolver().metadata(normalizeMusicMetadataIdentifiers(ids));
  });
  ipcMain.handle(desktopChannels.rememberMusicDuration, (event, id: unknown, duration: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (
      typeof duration !== 'number' ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 86_400
    ) {
      throw new TypeError('Invalid music duration');
    }
    return resolveYtDlpResolver().rememberDuration(normalizeMusicVideoIdentifier(id), duration);
  });
  ipcMain.handle(desktopChannels.getYouTubeMusicPlaylist, (event, url: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof url !== 'string') {
      throw new TypeError('Invalid YouTube playlist URL');
    }
    return resolveYtDlpResolver().playlist(url);
  });
  ipcMain.handle(desktopChannels.getSpotifyMusicPlaylist, async (event, url: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSpotifyImportService().importPlaylist(
      await selectedBattlyToken(),
      url,
      (progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.spotifyMusicProgress, progress);
        }
      },
    );
  });
  ipcMain.handle(desktopChannels.getMusicFavorites, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().favorites(await selectedBattlyToken());
  });
  ipcMain.handle(
    desktopChannels.setMusicFavorite,
    async (event, favorite: unknown, enabled: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (typeof enabled !== 'boolean') {
        throw new TypeError('Invalid music favorite state');
      }
      return resolveMusicService().setFavorite(
        await selectedBattlyToken(),
        normalizeMusicFavorite(favorite),
        enabled,
      );
    },
  );
  ipcMain.handle(desktopChannels.createMusicPlaylist, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().createPlaylist(
      await selectedBattlyToken(),
      normalizePlaylistDraft(value),
    );
  });
  ipcMain.handle(
    desktopChannels.updateMusicPlaylist,
    async (event, playlistId: unknown, value: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveMusicService().updatePlaylist(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(playlistId),
        normalizePlaylistUpdateDraft(value),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.updateMusicPlaylistSongs,
    async (event, playlistId: unknown, songs: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveMusicService().updatePlaylistSongs(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(playlistId),
        normalizePlaylistSongs(songs),
      );
    },
  );
  ipcMain.handle(desktopChannels.deleteMusicPlaylist, async (event, playlistId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().deletePlaylist(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(playlistId),
    );
  });
  ipcMain.handle(desktopChannels.shareMusicPlaylist, async (event, playlistId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().sharePlaylist(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(playlistId),
    );
  });
  ipcMain.handle(desktopChannels.importSharedMusicPlaylist, async (event, shareToken: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().importSharedPlaylist(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(shareToken),
    );
  });
  ipcMain.handle(desktopChannels.getMusicInvites, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().collaborationInvites(await selectedBattlyToken());
  });
  ipcMain.handle(
    desktopChannels.respondMusicInvite,
    async (event, inviteId: unknown, action: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (action !== 'accept' && action !== 'reject') {
        throw new TypeError('Invalid invite action');
      }
      return resolveMusicService().respondInvite(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(inviteId),
        action,
      );
    },
  );
  ipcMain.handle(desktopChannels.getMusicPlaylistCollaboration, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().playlistCollaboration(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(id),
    );
  });
  ipcMain.handle(
    desktopChannels.inviteMusicPlaylistCollaborator,
    async (event, id: unknown, username: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveMusicService().invitePlaylistCollaborator(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(id),
        normalizeMusicUsername(username),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.cancelMusicPlaylistInvite,
    async (event, id: unknown, inviteId: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveMusicService().cancelPlaylistInvite(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(id),
        normalizeMusicIdentifier(inviteId),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.removeMusicPlaylistCollaborator,
    async (event, id: unknown, collaboratorId: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveMusicService().removePlaylistCollaborator(
        await selectedBattlyToken(),
        normalizeMusicIdentifier(id),
        normalizeMusicIdentifier(collaboratorId),
      );
    },
  );
  ipcMain.handle(desktopChannels.getMusicPlaylistActivity, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveMusicService().playlistActivity(
      await selectedBattlyToken(),
      normalizeMusicIdentifier(id),
    );
  });
  ipcMain.handle(desktopChannels.musicPlaybackState, (event, state: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const playback = normalizeMusicPlaybackState(state);
    if (musicPlaybackState.playing && !playback.playing) {
      launcherAnalytics.track('music:paused');
    }
    musicPlaybackState = playback;
    discordPresence.music(playback);
    musicControlTarget = event.sender;
    updateMusicTray(playback, event.sender);
    updateMusicWindows(playback);
  });
  ipcMain.handle(desktopChannels.getMusicPlaybackState, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return musicPlaybackState;
  });
  ipcMain.handle(desktopChannels.musicOverlayGet, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!musicOverlayEnabled) {
      return {
        playback: musicPlaybackState,
        preferences: { widgets: [] },
        displays: [],
        displayId: '',
        open: false,
        maximized: false,
        editing: false,
        shortcutAvailable: false,
      };
    }
    resolveMusicOverlay().rendererReady(event.sender);
    return resolveMusicOverlay().snapshot(event.sender);
  });
  ipcMain.handle(desktopChannels.musicOverlayConfigure, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (musicOverlayEnabled) {
      await resolveMusicOverlay().configure(value);
    }
  });
  ipcMain.handle(desktopChannels.musicOverlayCommand, (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (musicOverlayEnabled) {
      resolveMusicOverlay().command(normalizeMusicOverlayCommand(value));
    }
  });
  ipcMain.handle(desktopChannels.sendMusicControl, (event, action: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeMusicControlAction(action);
    if (normalized === 'next') {
      launcherAnalytics.track('music:skipped');
    }
    if (musicControlTarget && !musicControlTarget.isDestroyed()) {
      if (normalized === 'play-pause') {
        musicPlaybackState = { ...musicPlaybackState, playing: !musicPlaybackState.playing };
        updateMusicTray(musicPlaybackState, musicControlTarget);
        updateMusicWindows(musicPlaybackState);
      }
      musicControlTarget.send(desktopChannels.musicControl, normalized);
    }
  });
  ipcMain.handle(desktopChannels.getSocial, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSocialService().snapshot(await selectedBattlyToken());
  });
  ipcMain.handle(desktopChannels.searchSocialUsers, async (event, query: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSocialService().search(
      await selectedBattlyToken(),
      normalizeSocialUsername(query),
    );
  });
  ipcMain.handle(
    desktopChannels.socialAction,
    async (event, action: unknown, username: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const token = await selectedBattlyToken();
      await resolveSocialService().action(
        token,
        normalizeSocialAction(action),
        normalizeSocialUsername(username),
      );
      return resolveSocialService().snapshot(token);
    },
  );
  ipcMain.handle(desktopChannels.getSocialProfile, (event, userId: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveSocialService().profile(socialIdentifier(userId));
  });
  ipcMain.handle(desktopChannels.getOwnSocialProfile, async (event, accountUuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const identity = await selectedBattlyIdentity(true, accountUuid);
    return resolveSocialService().profile(identity.username, identity.token);
  });
  ipcMain.handle(
    desktopChannels.updateSocialProfile,
    async (event, value: unknown, accountUuid: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveSocialService().updateProfile(
        (await selectedBattlyIdentity(true, accountUuid)).token,
        normalizeProfileCustomization(value),
      );
    },
  );
  ipcMain.handle(
    desktopChannels.selectSocialProfileBackground,
    async (event, accountUuid: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const identity = await selectedBattlyIdentity(true, accountUuid);
      if (!identity.premium) {
        throw new Error('Las imágenes de perfil requieren Battly+');
      }
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) {
        throw new Error('Profile background picker has no owning window');
      }
      const fixturePath = process.env.BATTLY_PROFILE_BACKGROUND_PATH;
      const selection = fixturePath
        ? { canceled: false, filePaths: [fixturePath] }
        : await dialog.showOpenDialog(owner, {
            title: 'Seleccionar fondo de perfil',
            properties: ['openFile'],
            filters: [{ name: 'Imagen de perfil', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
          });
      const path = selection.filePaths[0];
      if (selection.canceled || !path) {
        return null;
      }
      return resolveSocialService().uploadProfileBackground(
        identity.token,
        await readBoundedUploadFile(
          path,
          5 * 1024 * 1024,
          'La imagen de perfil debe ocupar como máximo 5 MB',
        ),
        path,
      );
    },
  );
  ipcMain.handle(
    desktopChannels.removeSocialProfileBackground,
    async (event, accountUuid: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return resolveSocialService().removeProfileBackground(
        (await selectedBattlyIdentity(true, accountUuid)).token,
      );
    },
  );
  ipcMain.handle(desktopChannels.getThemeSounds, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveThemeService().sounds(await selectedBattlyToken());
  });
  ipcMain.handle(desktopChannels.selectThemeSound, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Sound picker has no owning window');
    }
    const token = await selectedBattlyToken();
    if (!(await resolveThemeService().sounds(token)).premium) {
      throw new Error('Necesitas Battly+ para subir sonidos');
    }
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Sonido de inicio · máximo 10 segundos y 5 MB',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac'] }],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) {
      return null;
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) {
      throw new Error('El sonido supera 5 MB');
    }
    return resolveThemeService().uploadSound(
      token,
      await readBoundedUploadFile(path, 5 * 1024 * 1024, 'El sonido supera 5 MB'),
      path,
    );
  });
  ipcMain.handle(desktopChannels.selectThemeBackground, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('Theme background picker has no owning window');
    }
    const token = await selectedBattlyToken();
    const premium = (await resolveThemeService().sounds(token)).premium;
    const selection = await dialog.showOpenDialog(owner, {
      title: 'Seleccionar fondo del tema',
      properties: ['openFile'],
      filters: [
        {
          name: 'Imagen',
          extensions: premium ? ['png', 'jpg', 'jpeg', 'gif', 'webp'] : ['png', 'jpg', 'jpeg'],
        },
      ],
    });
    const path = selection.filePaths[0];
    if (selection.canceled || !path) {
      return null;
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > 8 * 1024 * 1024) {
      throw new Error('La imagen supera 8 MB');
    }
    return resolveThemeService().uploadBackground(
      token,
      await readBoundedUploadFile(path, 8 * 1024 * 1024, 'La imagen supera 8 MB'),
      path,
    );
  });
  ipcMain.handle(desktopChannels.openWorldsGamePanel, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!worldsDesktop) {
      throw new Error('Abre Minecraft desde Battly antes de abrir este panel.');
    }
    worldsDesktop.openGamePanel();
  });
  ipcMain.handle(desktopChannels.openWorldsSource, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await confirmExternalLink('https://github.com/BattlyLauncher/Terracotta');
  });
  ipcMain.handle('worlds:overlay-avatar', (event, username: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      throw new Error('Overlay no válido');
    }
    return overlayAvatar(username);
  });
  ipcMain.handle('worlds:overlay-friends', async (event) => {
    if (!worldsDesktop?.trusted(event)) {
      throw new Error('Overlay no válido');
    }
    const social = await resolveSocialService().snapshot(await selectedBattlyToken());
    return social.friends;
  });
  ipcMain.handle('worlds:overlay-search-users', async (event, query: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      throw new Error('Overlay no válido');
    }
    return resolveSocialService().search(
      await selectedBattlyToken(),
      normalizeSocialUsername(query),
    );
  });
  ipcMain.handle('worlds:overlay-preferences', (event) => {
    if (!worldsDesktop?.trusted(event)) {
      throw new Error('Overlay no válido');
    }
    return worldsDesktop.preferences();
  });
  ipcMain.handle('worlds:overlay-configure', (event, value: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      throw new Error('Overlay no válido');
    }
    return worldsDesktop.configure(value);
  });
  ipcMain.handle('worlds:overlay-height', (event, value: unknown) => {
    if (!worldsDesktop?.trusted(event) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('Overlay no válido');
    }
    worldsDesktop.compactHeight(value);
  });
  ipcMain.handle('worlds:lan-response', (event, accept: unknown) => {
    if (!worldsDesktop?.trusted(event) || typeof accept !== 'boolean') {
      throw new Error('Overlay no válido');
    }
    return worldsDesktop.respondLan(accept);
  });
  ipcMain.handle('worlds:overlay-expand', (event, expanded: unknown) => {
    if (!worldsDesktop?.trusted(event) || typeof expanded !== 'boolean') {
      throw new Error('Overlay no válido');
    }
    worldsDesktop.expand(expanded);
  });
  ipcMain.handle(desktopChannels.worldsPublicRooms, async (event, page: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 1000) {
      throw new Error('Página no válida');
    }
    if (!networkAvailable()) {
      return [];
    }
    return resolveWorldsService().publicRooms(await selectedBattlyIdentity(), Number(page));
  });
  ipcMain.handle(desktopChannels.worldsVoiceCommand, (event, raw: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    const command = normalizeVoiceCommand(raw);
    if (command.type === 'connect') {
      resolveWorldsService().prepareVoice();
    }
    if (command.type === 'connect' || command.type === 'input') {
      worldsMicAllowedUntil = Date.now() + 30000;
    }
    mainWindow?.webContents.send(desktopChannels.worldsEvent, {
      type: 'voice',
      event: { type: 'command', command },
    });
  });
  ipcMain.handle(desktopChannels.worldsVoiceSignal, (event, to: unknown, signal: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    resolveWorldsService().voiceSignal(to, signal);
  });
  ipcMain.handle(desktopChannels.worldsVoiceActivity, (event, raw: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!Array.isArray(raw) || raw.length > 128) {
      throw new Error('Actividad de voz no válida');
    }
    const speakers: { userId: string; level: number }[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const value = entry as Record<string, unknown>;
      if (
        typeof value.userId === 'string' &&
        /^[\w-]{1,128}$/.test(value.userId) &&
        typeof value.level === 'number' &&
        Number.isFinite(value.level) &&
        value.level >= 0 &&
        value.level <= 1
      ) {
        speakers.push({ userId: value.userId, level: value.level });
      }
    }
    resolveWorldsDesktop().emit({ type: 'voice', event: { type: 'activity', speakers } });
  });
  ipcMain.handle(desktopChannels.worldsVoiceState, (event, raw: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Estado de voz no válido');
    }
    const v = raw as Record<string, unknown>;
    if (
      typeof v.connected !== 'boolean' ||
      typeof v.muted !== 'boolean' ||
      typeof v.deafened !== 'boolean' ||
      typeof v.error !== 'string' ||
      v.error.length > 300
    ) {
      throw new Error('Estado de voz no válido');
    }
    const devices: { deviceId: string; label: string }[] = [];
    if (Array.isArray(v.devices)) {
      for (const rawDevice of v.devices.slice(0, 32)) {
        if (!rawDevice || typeof rawDevice !== 'object') {
          continue;
        }
        const device = rawDevice as Record<string, unknown>;
        if (
          typeof device.deviceId === 'string' &&
          device.deviceId.length <= 512 &&
          typeof device.label === 'string' &&
          device.label.length <= 256
        ) {
          devices.push({ deviceId: device.deviceId, label: device.label });
        }
      }
    }
    const inputDeviceId =
      typeof v.inputDeviceId === 'string' && v.inputDeviceId.length <= 512 ? v.inputDeviceId : '';
    resolveWorldsService().voiceState(v.connected, v.muted || v.deafened);
    resolveWorldsDesktop().emit({
      type: 'voice',
      event: {
        type: 'status',
        status: {
          devices,
          inputDeviceId,
          connected: v.connected,
          muted: v.muted,
          deafened: v.deafened,
          error: v.error,
        },
      },
    });
  });
  ipcMain.handle(desktopChannels.worldsVoiceParty, (event, action: unknown, value: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    if (typeof action !== 'string') {
      throw new Error('Grupo no válido');
    }
    return resolveWorldsService().voiceParty(action, value);
  });
  ipcMain.handle(desktopChannels.getWorldsSnapshot, async (event) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    return resolveWorldsService().snapshot(await selectedBattlyIdentity());
  });
  ipcMain.handle(desktopChannels.worldsAction, async (event, value: unknown) => {
    if (!worldsDesktop?.trusted(event)) {
      assertTrustedSender(event.senderFrame?.url);
    }
    const action = normalizeWorldsAction(value);
    resolveWorldsService().configure((await resolveSettingsStore().snapshot()).runtime.worlds);
    if (action.type === 'host' || action.type === 'invite') {
      if (!worldsDesktop?.trusted(event) || !worldsDesktop.gameRunning()) {
        throw new Error('Crea la sala e invita a tus amigos desde Minecraft, con Ctrl + B.');
      }
      if (action.type === 'host') {
        return resolveWorldsService().act(await selectedBattlyIdentity(), {
          type: 'host',
          version: worldsDesktop.hostingVersion(),
        });
      }
    }
    return resolveWorldsService().act(await selectedBattlyIdentity(), action);
  });
  ipcMain.handle(
    desktopChannels.supportConsentResponse,
    (event, id: unknown, accepted: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      supportConsentRequests.respond(event.sender.id, id, accepted);
    },
  );
  ipcMain.handle(desktopChannels.startSocialRealtime, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const sendState = (state: SocialRealtimeState) => {
      if (state === 'disconnected' || state === 'reconnecting') {
        supportConsentRequests.cancel();
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send(desktopChannels.socialRealtimeState, state);
      }
    };
    if (process.env.BATTLY_DISABLE_SOCIAL_REALTIME === '1') {
      sendState('disconnected');
      return;
    }
    const token = await selectedBattlyToken();
    const privacy = (await resolveSettingsStore().snapshot()).privacy;
    socialRealtimeService.updatePrivacy(privacy);
    socialRealtimeService.start(
      process.env.BATTLY_SOCIAL_SOCKET_URL || 'https://api.battlylauncher.com/',
      token,
      () => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.socialChanged);
        }
      },
      sendState,
      privacy.presenceShareStatus,
      async (command, arguments_) => {
        if (command === 'kill') {
          setTimeout(() => app.quit(), 500);
          return { closing: true };
        }
        if (command === 'operation') {
          const operation = remoteOperation(arguments_.operation);
          const params: unknown = arguments_.params;
          if (
            !Array.isArray(params) ||
            params.length > 12 ||
            JSON.stringify(params).length > 32768
          ) {
            throw new TypeError('Invalid operation parameters');
          }
          const handler = remoteHandlers.get(remoteOperations[operation]);
          if (!handler || !mainWindow || mainWindow.isDestroyed()) {
            throw new Error('Remote operation unavailable');
          }
          if (operation === 'cancel') {
            for (const controller of remoteControllers) {
              controller.abort(new Error('Remote operation cancelled'));
            }
            return cancelSelectedLaunch();
          }
          const controller = new AbortController();
          remoteControllers.add(controller);
          const parameters: unknown[] = params;
          try {
            const result: unknown = await remoteOperationContext.run(
              controller.signal,
              async () => {
                const result: unknown = await handler(
                  {
                    sender: mainWindow!.webContents,
                    senderFrame: mainWindow!.webContents.mainFrame,
                  } as Electron.IpcMainInvokeEvent,
                  ...parameters,
                );
                return result;
              },
            );
            return result;
          } finally {
            remoteControllers.delete(controller);
          }
        }
        if (command === 'stop-minecraft') {
          const pids = [...runningMinecraftGames.values()].map((game) => game.pid);
          const alive = (pid: number): boolean => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          };
          const stopped = pids.filter(alive).length;
          for (const id of activeLaunchDirectories.keys()) {
            launcherService?.cancel(id);
          }
          for (const pid of pids) {
            try {
              process.kill(pid);
            } catch {
              /* Already exited through cancellation. */
            }
          }
          const deadline = Date.now() + 10000;
          while (pids.some(alive) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          if (pids.some(alive)) {
            throw new Error('Minecraft is still stopping. Try again before modifying its files.');
          }
          return { stopped };
        }
        if (['ls', 'mkdir', 'rm', 'read-file', 'write-file'].includes(command)) {
          const files = new RemoteFiles(contentRootPath());
          if (command === 'ls') {
            return files.list(arguments_.path);
          }
          if (command === 'read-file') {
            return { content: await files.read(arguments_.path) };
          }
          if (command === 'mkdir') {
            await files.make(arguments_.path);
          }
          if (command === 'rm') {
            await files.archive(arguments_.path);
          }
          if (command === 'write-file') {
            await files.write(arguments_.path, arguments_.content);
          }
          return { success: true };
        }
        if (command === 'log_dump') {
          const service = resolveLaunchLogService();
          const files = await service.list();
          const id = typeof arguments_.id === 'string' ? arguments_.id : files[0]?.id;
          if (!id) {
            return { logs: '', files };
          }
          const document = await service.read(id);
          const identity = await selectedBattlyIdentity();
          return {
            logs: document.content
              .slice(-65536)
              .replaceAll(identity.token, '[redacted]')
              .replace(
                /\b(access[_-]?token|client[_-]?token|password|authorization)\s*[=:]\s*[^\s,;]+/gi,
                '$1=[redacted]',
              )
              .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]'),
            files,
          };
        }
        if (command === 'get_config') {
          const snapshot = await resolveSettingsStore().snapshot();
          return {
            runtime: snapshot.runtime,
            visual: snapshot.visual,
            privacy: snapshot.privacy,
            jvmArgs: await resolveSettingsStore().jvmArgs(),
            java: await resolveManagedJavaRuntimeService().snapshot(),
          };
        }
        if (command === 'set_config') {
          const current = await resolveSettingsStore().snapshot();
          const jvmArgs =
            arguments_.jvmArgs === undefined
              ? undefined
              : normalizeJvmArgsConfig(arguments_.jvmArgs);
          // Remote configuration cannot grant itself permissions or enable telemetry.
          let draft = normalizeSettingsDraft({
            ...current,
            runtime: {
              ...current.runtime,
              ...(arguments_.runtime && typeof arguments_.runtime === 'object'
                ? arguments_.runtime
                : {}),
            },
            visual: {
              ...current.visual,
              ...(arguments_.visual && typeof arguments_.visual === 'object'
                ? arguments_.visual
                : {}),
            },
            privacy: current.privacy,
          });
          if (
            (draft.runtime.launchBoostEnabled ||
              draft.runtime.startupSoundEnabled ||
              (draft.visual.backgroundUrl &&
                !/\.(png|jpe?g)$/i.test(draft.visual.backgroundUrl))) &&
            !(await canUseThemeMedia())
          ) {
            draft = {
              ...draft,
              visual: staticVisual(draft.visual),
              runtime: { ...draft.runtime, launchBoostEnabled: false, startupSoundEnabled: false },
            };
          }
          const saved = await resolveSettingsStore().save(draft);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(desktopChannels.visualPreferencesChanged, saved.visual);
          }
          if (jvmArgs) {
            await resolveSettingsStore().saveJvmArgs(jvmArgs);
          }
          translateNative = await nativeTranslator(saved.visual.language);
          socialRealtimeService.updatePrivacy(saved.privacy);
          discordPresence.configure(saved.privacy);
          worldsService?.configure(saved.runtime.worlds);
          if (worldsDesktop) {
            await worldsDesktop.applySettings(saved.runtime.worlds);
          }
          return { runtime: saved.runtime, visual: saved.visual };
        }
        if (command === 'get_versions') {
          const instances = await resolveInstanceStore().list();
          return {
            versions: instances.map((instance) => ({
              id: instance.id,
              name: instance.name,
              version: instance.version,
              loader: instance.loader,
            })),
          };
        }
        let request = normalizeRemoteLaunchRequest(arguments_);
        if (arguments_.javaMajor !== undefined) {
          const major = Number(arguments_.javaMajor);
          if (![8, 16, 17, 21, 25].includes(major)) {
            throw new TypeError('Invalid Java major');
          }
          const runtimes = await resolveManagedJavaRuntimeService().snapshot();
          const runtime = runtimes.runtimes.find((r) => r.major === major && r.installed && r.path);
          if (!runtime?.path) {
            throw new Error('Selected Java is not installed');
          }
          request = { ...request, javaPath: runtime.path };
        } else if (request.javaPath) {
          throw new TypeError('Select Java by major version');
        }
        if (!mainWindow || mainWindow.isDestroyed()) {
          throw new Error('UI_NOT_AVAILABLE');
        }
        const handler = remoteHandlers.get(desktopChannels.startInstance);
        if (!handler) {
          throw new Error('Remote launch unavailable');
        }
        const result: unknown = await handler(
          {
            sender: mainWindow.webContents,
            senderFrame: mainWindow.webContents.mainFrame,
          } as Electron.IpcMainInvokeEvent,
          request.instanceId,
          { safeMode: false, ...(request.javaPath ? { javaPath: request.javaPath } : {}) },
        );
        return result;
      },
      (invitation) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.serverInvitation, invitation);
        }
      },
      (payload) => {
        void notifications()
          .publish(payload)
          .catch(() => console.warn('[notifications] Invalid announcement ignored'));
      },
      () =>
        notifications().action(
          'Solicitud de amistad recibida',
          'Revisa tus solicitudes de amistad en Battly Social.',
          'social',
        ),
      (payload) => {
        const id =
          payload && typeof payload === 'object' ? (payload as Record<string, unknown>)._id : null;
        // Re-fetch with the socket identity so a stale event cannot apply another account's theme.
        void resolveThemeService()
          .apply(token, id)
          .then((snapshot) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(desktopChannels.themeApplied, snapshot);
            }
          })
          .catch(() => console.warn('[themes] No se pudo aplicar el tema recibido de la web'));
      },
    );
  });
  ipcMain.handle(desktopChannels.stopSocialRealtime, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    socialRealtimeService.stop((state) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(desktopChannels.socialRealtimeState, state);
      }
    });
  });

  const accountPremium = new AccountPremiumService();
  const microsoftSkins = new Map<string, { url: string; expires: number }>();
  ipcMain.handle(desktopChannels.getAccountSkinUrl, async (event, uuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof uuid !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(uuid)) {
      return null;
    }
    const accounts = await resolveAccountStore().store.list();
    if (
      !accounts.accounts.some((account) => account.uuid === uuid && account.type === 'microsoft')
    ) {
      return null;
    }
    const cached = microsoftSkins.get(uuid);
    if (cached && cached.expires > Date.now()) {
      return cached.url;
    }
    try {
      const response = await fetch(
        `https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replaceAll('-', '')}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!response.ok) {
        return null;
      }
      const profile = JSON.parse(await readBoundedResponse(response, 1024 * 1024)) as {
        properties?: { name: string; value: string }[];
      };
      const texture = profile.properties?.find((property) => property.name === 'textures')?.value;
      if (!texture || texture.length > 65536) {
        return null;
      }
      const data = JSON.parse(Buffer.from(texture, 'base64').toString('utf8')) as {
        textures?: { SKIN?: { url?: string } };
      };
      const url = new URL(data.textures?.SKIN?.url ?? '');
      if (
        url.hostname !== 'textures.minecraft.net' ||
        !['https:', 'http:'].includes(url.protocol)
      ) {
        return null;
      }
      url.protocol = 'https:';
      microsoftSkins.set(uuid, { url: url.href, expires: Date.now() + 10 * 60 * 1000 });
      return url.href;
    } catch {
      return null;
    }
  });
  ipcMain.handle(desktopChannels.getAccounts, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    try {
      return await accountPremium.refresh(await resolveAccountStore().store.list());
    } catch {
      return { accounts: [], selectedAccountUuid: null };
    }
  });
  trackedHandle(desktopChannels.selectAccount, async (event, uuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const accountStore = resolveAccountStore();
    if (!accountStore.writable) {
      throw new Error('Legacy account profile is read-only in development');
    }
    if (typeof uuid !== 'string') {
      throw new TypeError('Invalid account id');
    }
    await worldsService?.stop();
    const selected = await accountStore.store.select(uuid);
    const accounts = await accountPremium.refresh(selected);
    return accounts;
  });
  trackedHandle(desktopChannels.removeAccount, async (event, uuid: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const accountStore = resolveAccountStore();
    if (!accountStore.writable) {
      throw new Error('Legacy account profile is read-only in development');
    }
    if (typeof uuid !== 'string') {
      throw new TypeError('Invalid account id');
    }
    await worldsService?.stop();
    const removed = await accountStore.store.remove(uuid);
    const accounts = await accountPremium.refresh(removed);
    return accounts;
  });
  trackedHandle(desktopChannels.removeAllAccounts, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const accountStore = resolveAccountStore();
    if (!accountStore.writable) {
      throw new Error('Legacy account profile is read-only in development');
    }
    await worldsService?.stop();
    const accounts = await accountStore.store.removeAll();
    return accounts;
  });
  trackedHandle(desktopChannels.startAuth, async (event, request: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    try {
      const accounts = await resolveAuthCoordinator().start(normalizeAuthRequest(request));
      void resolveStructuredLogger()
        .log('info', 'auth.account-saved', { accountCount: accounts.accounts.length })
        .catch(() => undefined);
      void worldsService?.stop().catch((error) => {
        void resolveStructuredLogger()
          .log('warn', 'auth.worlds-cleanup-failed', { error })
          .catch(() => undefined);
      });
      return { ok: true, accounts };
    } catch (error) {
      if (error instanceof BattlyTwoFactorRequiredError) {
        return { ok: false, code: 'two-factor-required', message: 'Se requiere verificación A2F' };
      }
      if (error instanceof AuthCancelledError) {
        return { ok: false, code: 'cancelled', message: 'Inicio de sesión cancelado' };
      }
      void resolveStructuredLogger()
        .log('error', 'auth.failed', { error })
        .catch(() => undefined);
      if (error instanceof Error && error.message === 'Account already exists') {
        return {
          ok: false,
          code: 'failed',
          message: 'Esta cuenta ya está añadida. Puedes seleccionarla en el selector de cuentas.',
        };
      }
      if (
        error instanceof TypeError &&
        error.message.startsWith('Authentication provider unavailable')
      ) {
        return { ok: false, code: 'unavailable', message: 'Método de inicio no disponible' };
      }
      if (
        typeof request === 'object' &&
        request !== null &&
        Reflect.get(request, 'method') === 'battly-two-factor'
      ) {
        return { ok: false, code: 'failed', message: 'El código no es válido o ha expirado' };
      }
      const detail =
        error instanceof Error ? String(sanitizeDiagnosticValue(error.message)).slice(0, 300) : '';
      return {
        ok: false,
        code: 'failed',
        message: detail ? `No se pudo iniciar sesión: ${detail}` : 'No se pudo iniciar sesión',
      };
    }
  });
  ipcMain.handle(desktopChannels.cancelAuth, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveAuthCoordinator().cancel();
  });
  ipcMain.handle(desktopChannels.getInstances, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const instances = await resolveInstanceStore().list();
    return remoteOperationContext.getStore()
      ? instances.map((instance) => {
          const result = { ...instance };
          delete result.iconDataUrl;
          delete result.artwork;
          return result;
        })
      : resolveInstanceArtworkCache().list(instances);
  });
  ipcMain.handle(desktopChannels.getPlayVersions, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const catalog = await cachedPlayCatalog(resolveLauncherVersionCatalog());
    return resolvePlayVersionService().snapshot(catalog);
  });
  ipcMain.handle(desktopChannels.getDownloadCatalog, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    hotVersionCatalog ??= new RemoteJsonClient({
      url: battlyResourceUrls.hotVersions,
      cachePath: join(app.getPath('userData'), 'cache', 'hot-versions.json'),
      validate: validateHotVersions,
      timeoutMs: 4_000,
      maxBytes: 128 * 1024,
    });
    const [launcher, minecraft, hotVersions] = await Promise.all([
      resolveLauncherVersionCatalog().load().catch(emptyOfflineCatalog),
      resolveMinecraftVersionManifest().load().catch(emptyOfflineCatalog),
      hotVersionCatalog
        .load()
        .then((result) => result.data)
        .catch(() => []),
    ]);
    return { launcher: launcher.data, minecraft: minecraft.data, hotVersions };
  });
  ipcMain.handle(desktopChannels.getMinecraftVersionList, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return (await resolveMinecraftVersionManifest().load().catch(emptyOfflineCatalog)).data;
  });
  ipcMain.handle(
    desktopChannels.getLoaderBuilds,
    async (event, loaderValue: unknown, minecraftVersionValue: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const request = normalizeLoaderBuildRequest(loaderValue, minecraftVersionValue);
      return resolveLoaderBuildService().list(request.loader, request.minecraftVersion);
    },
  );
  ipcMain.handle(desktopChannels.getLoaderGameVersions, async (event, loaderValue: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const request = normalizeLoaderBuildRequest(loaderValue, 'version-check');
    return resolveLoaderBuildService().gameVersions(request.loader);
  });
  trackedHandle(desktopChannels.installPlayClient, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const id = normalizeCustomClientId(value);
    const catalog = await resolveCustomClientCatalog().load();
    const client = catalog.data.find((candidate) => candidate.id === id);
    if (!client) {
      throw new TypeError('Unknown custom client');
    }
    assertMinecraftArchitecture(client.folderName, client.requiredJavaVersion);
    await resolveCustomClientInstaller().install(client, contentRootPath());
  });
  ipcMain.handle(desktopChannels.getBattlyClientBuilds, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return battlyClientService.versions();
  });
  trackedHandle(desktopChannels.installBattlyClient, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof value !== 'string') {
      throw new TypeError('Invalid Battly Client build');
    }
    if (runningMinecraftGames.size) {
      throw new Error('Close Minecraft before updating Battly Client');
    }
    if (launchRequestPreparing || launcherService?.preparing) {
      throw new Error(
        'Espera a que termine de prepararse la otra versión. Después puedes abrir otra partida.',
      );
    }
    launchRequestPreparing = true;
    const cancel = () => battlyClientService.cancel();
    cancelSelectedLaunch = cancel;
    try {
      return await battlyClientService.install(
        value,
        contentRootPath(),
        (message, current, total) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(desktopChannels.launchEvent, {
              type: 'progress',
              current,
              total,
              item: message,
            });
          }
        },
      );
    } finally {
      launchRequestPreparing = false;
      if (cancelSelectedLaunch === cancel) {
        cancelSelectedLaunch = () => false;
      }
    }
  });
  ipcMain.handle(desktopChannels.getLabyModVersions, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLabyModService().versions();
  });
  trackedHandle(desktopChannels.installLabyMod, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (launchRequestPreparing || battlyClientUpdateInProgress) {
      throw new Error(
        'Espera a que termine de prepararse la otra versión. Después puedes abrir otra partida.',
      );
    }
    const version = normalizeLabyModVersion(value);
    assertMinecraftArchitecture(version);
    if (labyUpdateChoicePending) {
      throw new Error('Elige primero qué hacer con la actualización de LabyMod.');
    }
    if (labyUpdateInProgress) {
      await labyUpdateInProgress;
    }
    const service = resolveLabyModService();
    const root = contentRootPath();
    const installed = await service.installed(version, root);
    if (installed) {
      if (!(await service.updateAvailable(installed.commit))) {
        return installed;
      }
      if (labyUpdateChoicePending) {
        throw new Error('Ya hay una decisión de LabyMod pendiente.');
      }
      labyUpdateChoicePending = true;
      const choice = await new Promise<{ response: number }>((resolve, reject) => {
        const id = randomUUID();
        const sender = event.sender;
        let finished = false;
        const finish = (response: number) => {
          if (finished) {
            return;
          }
          finished = true;
          ipcMain.removeListener('labymod:update-choice', receive);
          sender.removeListener('destroyed', closed);
          labyUpdateChoicePending = false;
          resolve({ response });
        };
        const closed = () => {
          if (finished) {
            return;
          }
          finished = true;
          labyUpdateChoicePending = false;
          ipcMain.removeListener('labymod:update-choice', receive);
          reject(new Error('La ventana se cerró antes de elegir la actualización de LabyMod.'));
        };
        const receive = (reply: Electron.IpcMainEvent, requestId: unknown, response: unknown) => {
          if (
            reply.sender !== sender ||
            requestId !== id ||
            typeof response !== 'number' ||
            ![0, 1, 2].includes(response)
          ) {
            return;
          }
          try {
            assertTrustedSender(reply.senderFrame?.url);
          } catch {
            return;
          }
          finish(response);
        };
        ipcMain.on('labymod:update-choice', receive);
        sender.once('destroyed', closed);
        sender.send('labymod:update-prompt', id);
      });
      if (choice.response === 2) {
        pendingLabyUpdates.set(version, root);
      }
      if (choice.response !== 0) {
        return installed;
      }
      if (runningMinecraftGames.size) {
        throw new Error('Cierra Minecraft antes de actualizar LabyMod.');
      }
    }
    return resolveLabyModService().install(
      version,
      contentRootPath(),
      (message, current, total) => {
        if (event.sender.isDestroyed()) {
          return;
        }
        event.sender.send(desktopChannels.launchEvent, { type: 'phase', phase: 'labymod' });
        event.sender.send(desktopChannels.launchEvent, {
          type: 'progress',
          current,
          total,
          item: message,
        });
        event.sender.send(desktopChannels.launchEvent, {
          type: 'log',
          stream: 'game',
          message: `[LabyMod] ${message}`,
        });
      },
    );
  });
  trackedHandle(desktopChannels.startPlayVersion, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    let request = normalizePlayVersionLaunchRequest(value);
    assertMinecraftArchitecture(request.version, request.requiredJavaVersion);
    if (labyUpdateChoicePending) {
      throw new Error('Elige primero qué hacer con la actualización de LabyMod.');
    }
    if (labyUpdateInProgress) {
      await labyUpdateInProgress;
    }
    if (battlyClientUpdateInProgress) {
      await battlyClientUpdateInProgress;
    }
    if (launchRequestPreparing || launcherService?.preparing) {
      return {
        ok: false,
        code: 'busy',
        state: 'preparing',
        message:
          'Espera a que termine de prepararse la otra versión. Después puedes abrir otra partida.',
      };
    }
    launchRequestPreparing = true;
    const launchId = Symbol('minecraft-launch');
    selectedLaunchId = launchId;
    cancelSelectedLaunch = () => false;
    let handedOff = false;
    try {
      const root = contentRootPath();
      if (!request.installOnly) {
        const customVersion =
          request.installedVersionId || (request.custom ? request.customVersion : '');
        const javaVersion = await battlyClientUpdates.beforeLaunch(
          root,
          customVersion,
          (update) =>
            chooseBattlyClientUpdate(event.sender, {
              minecraftVersion: update.latest.minecraftVersion,
              installedVersion: update.installedVersion,
              installedBuild: update.installedBuild,
              clientVersion: update.latest.clientVersion,
              build: update.latest.build,
              canUpdateNow: runningMinecraftGames.size === 0,
            }),
          () => runningMinecraftGames.size === 0,
          async (directory, build) => {
            const cancel = () => battlyClientService.cancel();
            cancelSelectedLaunch = cancel;
            try {
              await installBattlyClientBuild(directory, build, event.sender);
            } finally {
              if (cancelSelectedLaunch === cancel) {
                cancelSelectedLaunch = () => false;
              }
            }
          },
        );
        if (javaVersion) {
          request = { ...request, requiredJavaVersion: javaVersion };
        }
      }
      const gameDirectory = request.custom
        ? customClientProfileDirectory(root, request.customVersion)
        : root;
      const otherLaunches = otherDirectoryLaunches(launchId, gameDirectory);
      if (
        otherLaunches.some(([, launch]) => launch.safeMode) ||
        (request.safeMode && otherLaunches.length)
      ) {
        return {
          ok: false,
          code: 'busy',
          state: 'preparing',
          message:
            'El modo seguro necesita acceso exclusivo a esta carpeta. Puedes abrir otra instancia en una carpeta diferente.',
        };
      }
      activeLaunchDirectories.set(launchId, {
        path: launchDirectoryKey(gameDirectory),
        safeMode: request.safeMode === true,
      });
      await mkdir(gameDirectory, { recursive: true });
      const launchLog = await resolveLaunchLogService().start(
        `play-${Date.now()}`,
        request.version,
      );
      const launchWindow = BrowserWindow.fromWebContents(event.sender);
      const readyObserver = new MinecraftClientReadyObserver((ready) => emit(ready));
      const emit = (launchEvent: MinecraftLaunchEvent): void => {
        readyObserver.observe(launchEvent);
        taskbarProgress.launch(launchEvent);
        launchLog.record(launchEvent);
        socialRealtimeService.publishRemote({ type: 'launch', event: launchEvent });
        if (!request.installOnly) {
          trackMinecraftGame(
            launchId,
            launchEvent,
            request.installedVersionId ||
              request.customVersion ||
              `${request.loader || 'Vanilla'} ${request.version}${request.loaderVersion && request.loaderVersion !== 'latest' ? ` (${request.loaderVersion})` : ''}`,
          );
        }
        const terminal =
          launchEvent.type === 'exit' ||
          (launchEvent.type === 'state' && ['exited', 'failed'].includes(launchEvent.state));
        if (
          launchWindow &&
          !request.installOnly &&
          (terminal
            ? runningMinecraftGames.size === 0 || selectedLaunchId === launchId
            : selectedLaunchId === launchId)
        ) {
          resolveWindowBehaviorService().launchEvent(launchWindow, launchEvent);
        }
        if (selectedLaunchId === launchId && !event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.launchEvent, launchEvent);
        }
      };
      const safeMode = new InstanceSafeModeService();
      if (otherLaunches.length === 0) {
        await safeMode.recover(gameDirectory);
      }
      let safeModeContext: InstanceSafeModeContext | undefined;
      const restoreSafeMode = async (): Promise<void> => {
        if (!safeModeContext) {
          return;
        }
        const context = safeModeContext;
        safeModeContext = undefined;
        await safeMode.restore(context);
      };
      let finalized = false;
      const finalizeLaunch = async (
        exit: MinecraftLaunchExit | null = null,
        launchError?: unknown,
      ): Promise<void> => {
        if (finalized) {
          return;
        }
        finalized = true;
        try {
          refreshPlayingServer();
          await restoreSafeMode();
          await launchLog.close();
          if (launchError instanceof LaunchMemoryCancelledError) {
            return;
          }
          if (
            !request.installOnly &&
            exit?.code === 0 &&
            !launchError &&
            otherDirectoryLaunches(launchId, gameDirectory).length === 0
          ) {
            await syncWorldsOnGameClose(gameDirectory, launchId);
          }
          if (request.installOnly && !launchError && (exit?.code === null || exit?.code === 0)) {
            launcherAnalytics.track('installation:completed', {
              operation: 'minecraft:version-install',
              version: request.version,
              loader: request.loader || 'vanilla',
            });
            return;
          }
          try {
            const report = await resolveCrashAnalysisService().analyze({
              exit,
              gameDirectory,
              instanceId: null,
              launchLogPath: launchLog.path,
              launchStartedAt: launchLog.startedAt,
              ...(launchError ? { launchError } : {}),
            });
            if (report && selectedLaunchId === launchId && !event.sender.isDestroyed()) {
              event.sender.send(desktopChannels.crashReportEvent, {
                ...report,
                launchRequest: request,
              });
            }
          } catch (error) {
            await resolveStructuredLogger().log('error', 'crash-report.analysis-failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          activeLaunchDirectories.delete(launchId);
        }
      };
      if (request.safeMode) {
        try {
          safeModeContext = await safeMode.prepare(gameDirectory);
        } catch {
          emit({ type: 'state', state: 'failed' });
          await finalizeLaunch();
          return { ok: false, code: 'failed', message: 'No se pudo preparar el modo seguro' };
        }
        emit({ type: 'log', stream: 'game', message: '[Battly] Modo seguro temporal activado' });
      }
      if (process.env.BATTLY_DISABLE_GAME_LAUNCH === '1') {
        await resolvePlayVersionService().recordLaunch(request);
        const crashFixture = process.env.BATTLY_CRASH_REPORT_FIXTURE === 'oom';
        emit({ type: 'state', state: 'preparing' });
        emit({ type: 'phase', phase: 'fixture' });
        emit({
          type: 'progress',
          current: 1,
          total: 1,
          item: request.customVersion || request.version,
        });
        emit({ type: 'log', stream: 'game', message: 'Fixture de lanzamiento preparado' });
        emit({ type: 'state', state: 'running' });
        setTimeout(() => {
          if (crashFixture) {
            emit({
              type: 'log',
              stream: 'game',
              message: 'java.lang.OutOfMemoryError: Java heap space',
            });
          }
          const exit = { code: crashFixture ? 1 : 0, signal: null };
          emit({ type: 'exit', ...exit });
          void finalizeLaunch(exit).finally(() => emit({ type: 'state', state: 'exited' }));
        }, 1_000);
        handedOff = true;
        return { ok: true };
      }
      const account = await resolveAccountStore().store.selectedInternal();
      if (!account) {
        await finalizeLaunch();
        return { ok: false, code: 'no-account', message: 'Selecciona una cuenta antes de jugar' };
      }
      try {
        const [profileValues, loadedConfig] = await Promise.all([
          readProfileValuesFile(remakeStorePath()),
          resolveConfigClient().load({ preferCache: true }),
        ]);
        const externalId =
          request.installedVersionId || (request.custom ? request.customVersion : '');
        const baseVersion = externalId
          ? await resolvePlayVersionService().customBaseVersion(externalId)
          : request.version;
        if (!baseVersion) {
          throw new Error('Custom Minecraft version has no base version');
        }
        const baseOptions = prepareOfflineLaunch(
          buildInstanceLaunchOptions({
            account,
            config: loadedConfig.data,
            instanceDirectory: root,
            ...(request.instanceId ? { instanceId: request.instanceId } : {}),
            instanceMetadata: {
              name: request.customVersion || request.version,
              description: '',
              version: baseVersion,
              loader: request.custom || request.loader === 'vanilla' ? null : request.loader,
              loaderVersion:
                request.custom || request.loader === 'vanilla'
                  ? null
                  : request.loaderVersion || 'latest',
            },
            profileValues,
          }),
        );
        if (baseOptions.javaArguments.some((argument) => /authlib-injector\.jar/i.test(argument))) {
          await ensureAuthlibInjector(
            baseOptions.root,
            await bundledAuthlibInjectorPath(),
            baseOptions.core?.resourceUrl,
            fetch,
            join(app.getPath('userData'), 'authlib-integrity'),
          );
        }
        const descriptor = minecraftCorePackageFromLauncherConfig(loadedConfig.data.raw);
        let options: MinecraftLaunchOptions;
        if (request.custom || request.installedVersionId || request.loader === 'optifine') {
          const optifineCustomId =
            request.loader === 'optifine'
              ? request.customVersion || `${request.version}-optifine-${request.loaderVersion}`
              : '';
          options = normalizeMinecraftLaunchOptions({
            ...baseOptions,
            engine: 'minecraft-launcher-core',
            core: undefined,
            gameDirectory,
            version: {
              id: baseVersion,
              type: 'release',
              customId:
                request.installedVersionId ||
                (request.custom ? request.customVersion : optifineCustomId),
            },
          });
        } else {
          options = normalizeMinecraftLaunchOptions(baseOptions);
        }
        options = await prepareLaunchJava(
          {
            ...options,
            installOnly: request.installOnly === true,
            installOptiForge:
              request.loader === 'forge' && request.installOptiForge === true && !request.safeMode,
          },
          {
            contentRoot: root,
            requiredJavaVersion: request.requiredJavaVersion,
            install: (major) => installLaunchJava(resolveManagedJavaRuntimeService(), major, emit),
          },
          emit,
        );
        options = withWorldsLanConnection(
          withDirectConnectArguments(options, request.directConnect ?? null),
          request.directConnect,
          worldsService?.current(),
          worldsLanAgentPath(process.resourcesPath, __dirname),
        );
        if (options.javaArguments.some((argument) => argument.includes('worlds-lan-agent.jar='))) {
          emit({
            type: 'log',
            stream: 'game',
            message: '[BattlyWorlds/INFO] LAN adapter attached for the joined room',
          });
        }
        const service = resolveLauncherService(descriptor);
        cancelSelectedLaunch = () => service.cancel(launchId);
        await accessMonitor?.check();
        accessMonitor?.assertAllowed();
        await service.start(
          options,
          emit,
          finalizeLaunch,
          launchId,
          request.allowDuplicateMods === true,
        );
        handedOff = true;
        if (!request.installOnly) {
          await resolvePlayVersionService().recordLaunch({ ...request, version: baseVersion });
        }
        return { ok: true };
      } catch (error) {
        if (error instanceof LaunchMemoryCancelledError) {
          emit({ type: 'state', state: 'exited' });
          await finalizeLaunch(null, error);
          analyticsGames.delete(launchId);
          return { ok: false, code: 'cancelled', message: '' };
        }
        emit({ type: 'state', state: 'failed' });
        await finalizeLaunch(null, error);
        const detail =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Error desconocido';
        return {
          ok: false,
          code: 'failed',
          message: minecraftFailureMessage(
            error,
            request.installOnly
              ? `No se pudo instalar la versión: ${detail}`
              : `No se pudo iniciar la versión: ${detail}`,
          ),
        };
      }
    } finally {
      launchRequestPreparing = false;
      setTimeout(runPendingLabyUpdates, 1000);
      if (!handedOff) {
        activeLaunchDirectories.delete(launchId);
      }
    }
  });
  ipcMain.handle(
    desktopChannels.createPlayShortcut,
    async (event, value: unknown, labelValue: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (process.platform !== 'win32' && process.platform !== 'linux') {
        throw new Error('Los accesos directos de versiones sólo están disponibles en Windows');
      }
      const request = normalizePlayVersionLaunchRequest(value);
      assertMinecraftArchitecture(request.version, request.requiredJavaVersion);
      if (
        request.instanceId &&
        !(await resolveInstanceStore().list()).some(
          (instance) => instance.id === request.instanceId,
        )
      ) {
        throw new Error('La instancia ya no existe');
      }
      const label = shortcutLabel(labelValue);
      const shortcutRequest = request.instanceId
        ? { instanceId: request.instanceId, version: request.version }
        : request;
      const payload = Buffer.from(JSON.stringify(shortcutRequest), 'utf8').toString('base64url');
      if (process.platform === 'linux') {
        const shortcutPath = join(
          app.getPath('desktop'),
          `Battly - ${shortcutFilename(label)}.desktop`,
        );
        await createLinuxShortcut(shortcutPath, {
          label: `Battly - ${label}`,
          executable: process.env.APPIMAGE || process.execPath,
          args: [
            ...(packagedApplication ? [] : [app.getAppPath()]),
            `${directPlayArgumentPrefix}${payload}`,
          ],
          icon: packagedApplication
            ? join(process.resourcesPath, 'icon.png')
            : join(app.getAppPath(), 'src/renderer/assets/icon.png'),
        });
        return shortcutPath;
      }
      const shortcutPath = join(app.getPath('desktop'), `Battly - ${shortcutFilename(label)}.lnk`);
      const iconPath = packagedApplication
        ? join(process.resourcesPath, 'icon.ico')
        : join(app.getAppPath(), 'build-resources', 'icon.ico');
      const created = shell.writeShortcutLink(shortcutPath, 'create', {
        target: process.execPath,
        cwd: packagedApplication ? dirname(process.execPath) : app.getAppPath(),
        args: packagedApplication
          ? `${directPlayArgumentPrefix}${payload}`
          : `"${app.getAppPath()}" ${directPlayArgumentPrefix}${payload}`,
        description: `Abrir ${label} directamente con Battly`,
        icon: iconPath,
        iconIndex: 0,
        appUserModelId: 'com.battlylauncher.launcher',
      });
      if (!created) {
        throw new Error('Windows no pudo crear el acceso directo');
      }
      return shortcutPath;
    },
  );
  trackedHandle(desktopChannels.createInstance, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    await resolveInstanceStore().create(normalizeInstanceDraft(value));
    const instances = await resolveInstanceStore().list();
    return remoteOperationContext.getStore()
      ? instances.map((instance) => {
          const result = { ...instance };
          delete result.iconDataUrl;
          delete result.artwork;
          return result;
        })
      : resolveInstanceArtworkCache().list(instances);
  });
  ipcMain.handle(desktopChannels.updateInstance, async (event, id: unknown, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string') {
      throw new TypeError('Invalid instance id');
    }
    await resolveInstanceStore().update(id, normalizeInstanceDraft(value));
    const instances = await resolveInstanceStore().list();
    return remoteOperationContext.getStore()
      ? instances.map((instance) => {
          const result = { ...instance };
          delete result.iconDataUrl;
          delete result.artwork;
          return result;
        })
      : resolveInstanceArtworkCache().list(instances);
  });
  ipcMain.handle(desktopChannels.archiveInstance, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string') {
      throw new TypeError('Invalid instance id');
    }
    await resolveInstanceStore().archive(id);
    const instances = await resolveInstanceStore().list();
    return remoteOperationContext.getStore()
      ? instances.map((instance) => {
          const result = { ...instance };
          delete result.iconDataUrl;
          delete result.artwork;
          return result;
        })
      : resolveInstanceArtworkCache().list(instances);
  });
  ipcMain.handle(desktopChannels.openInstanceFolder, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const path = await resolveInstanceStore().directoryPathInternal(String(id));
    const error = await shell.openPath(path);
    if (error) {
      throw new Error(error);
    }
  });
  const instanceContent = new InstanceContentService(
    { directoryPathInternal: (id) => resolveInstanceStore().directoryPathInternal(id) },
    (directory) => {
      if (otherDirectoryLaunches(Symbol(), directory).length) {
        throw new Error('Cierra Minecraft antes de modificar el contenido de esta instancia');
      }
    },
    new ContentArtwork(
      new BypackSources({
        ...(process.env.BATTLY_CURSEFORGE_API_KEY
          ? { curseForgeKey: process.env.BATTLY_CURSEFORGE_API_KEY }
          : {}),
        ...(process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL
          ? { curseForgeFingerprintUrl: process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL }
          : {}),
        ...(process.env.BATTLY_CURSEFORGE_API_URL
          ? { curseForgeApiBase: process.env.BATTLY_CURSEFORGE_API_URL }
          : {}),
      }),
    ),
  );
  const bypackProgress =
    (target: Electron.WebContents): ModpackInstallProgressSink =>
    (value) => {
      taskbarProgress.update(value.current, value.total);
      if (!target.isDestroyed()) {
        target.send(desktopChannels.bypackProgress, value);
      }
    };
  const exportedBypacks = new Set<string>();
  ipcMain.handle(desktopChannels.revealBypack, (event, path: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof path !== 'string' || !exportedBypacks.has(path)) {
      throw new Error('El paquete no se ha exportado en esta sesión');
    }
    shell.showItemInFolder(path);
  });
  trackedHandle(desktopChannels.exportServerBypack, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const normalized = normalizeServerId(id);
    const store = resolveServerStore();
    const server = (await store.list()).find((entry) => entry.id === normalized);
    if (!server) {
      throw new Error('Servidor no encontrado');
    }
    const metadata = { name: server.name };
    const directory = await store.directoryPathInternal(normalized);
    const assertEditable = (): void => {
      if (
        installingServerRuntimes.has(normalized) ||
        !['stopped', 'error'].includes(resolveServerRuntimeService().snapshot(normalized).status)
      ) {
        throw new Error('Detén el servidor antes de compartir sus mods');
      }
    };
    assertEditable();
    const service = createServerBypackService(store, directory, {
      assertEditable,
      ...(process.env.BATTLY_CURSEFORGE_API_KEY
        ? { curseForgeKey: process.env.BATTLY_CURSEFORGE_API_KEY }
        : {}),
      ...(process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL
        ? { curseForgeFingerprintUrl: process.env.BATTLY_CURSEFORGE_FINGERPRINT_URL }
        : {}),
      ...(process.env.BATTLY_CURSEFORGE_API_URL
        ? { curseForgeApiBase: process.env.BATTLY_CURSEFORGE_API_URL }
        : {}),
    });
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('No se pudo abrir el selector de archivos');
    }
    const name = (typeof metadata.name === 'string' ? metadata.name : 'instancia')
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 100);
    const selected = await dialog.showSaveDialog(owner, {
      title: 'Compartir mods del servidor',
      defaultPath: join(app.getPath('downloads'), `${name}.bypack`),
      filters: [{ name: 'Battly Pack', extensions: ['bypack'] }],
    });
    if (selected.canceled || !selected.filePath) {
      return null;
    }
    const accounts = await resolveAccountStore()
      .store.list()
      .catch(() => null);
    const author = accounts?.accounts.find(
      (account) => account.uuid === accounts.selectedAccountUuid,
    )?.name;
    const result = await service.export(
      normalized,
      selected.filePath,
      bypackProgress(event.sender),
      author,
    );
    exportedBypacks.add(result.path);
    return result;
  });
  trackedHandle(desktopChannels.exportBypack, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string') {
      throw new Error('Instancia inválida');
    }
    const metadata = await resolveInstanceStore().readInternal(id);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('No se pudo abrir el selector de archivos');
    }
    const name = (typeof metadata.name === 'string' ? metadata.name : 'instancia')
      .replace(/[<>:"/\\|?*]/g, '_')
      .slice(0, 100);
    const selected = await dialog.showSaveDialog(owner, {
      title: 'Exportar instancia a .bypack',
      defaultPath: join(app.getPath('downloads'), `${name}.bypack`),
      filters: [{ name: 'Battly Pack', extensions: ['bypack'] }],
    });
    if (selected.canceled || !selected.filePath) {
      return null;
    }
    const accounts = await resolveAccountStore()
      .store.list()
      .catch(() => null);
    const author = accounts?.accounts.find(
      (account) => account.uuid === accounts.selectedAccountUuid,
    )?.name;
    const result = await resolveBypackService().export(
      id,
      selected.filePath,
      bypackProgress(event.sender),
      author,
    );
    exportedBypacks.add(result.path);
    return result;
  });
  trackedHandle(desktopChannels.importBypack, async (event, source: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) {
      throw new Error('No se pudo abrir el selector de archivos');
    }
    let path: string;
    if (source !== undefined) {
      if (typeof source !== 'string' || source.length > 32768) {
        throw new Error('Archivo .bypack inválido');
      }
      path = source;
    } else {
      const selected = await dialog.showOpenDialog(owner, {
        title: 'Importar instancia .bypack',
        properties: ['openFile'],
        filters: [{ name: 'Battly Pack', extensions: ['bypack'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) {
        return null;
      }
      path = selected.filePaths[0];
    }
    const { manifestHash, ...preview } = await resolveBypackService().inspect(path);
    const token = randomUUID();
    const enriched = await resolveInstanceArtworkCache().enrich({
      ...preview.instance,
      id: `bypack-${manifestHash.slice(0, 32)}`,
    });
    pendingBypackReviews.set(event.sender, {
      token,
      path,
      manifestHash,
      expires: Date.now() + 15 * 60_000,
      artwork: enriched.artwork,
    });
    return { ...preview, token, ...(enriched.artwork ? { artwork: enriched.artwork } : {}) };
  });
  trackedHandle(desktopChannels.confirmBypack, async (event, token: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const reviewed = pendingBypackReviews.get(event.sender);
    if (!reviewed || reviewed.token !== token || reviewed.expires < Date.now()) {
      throw new Error('Vuelve a abrir el paquete para revisar sus datos');
    }
    pendingBypackReviews.delete(event.sender);
    const instance = await resolveBypackService().install(
      reviewed.path,
      bypackProgress(event.sender),
      reviewed.manifestHash,
    );
    return { ...instance, ...(reviewed.artwork ? { artwork: reviewed.artwork } : {}) };
  });
  ipcMain.handle(desktopChannels.getInstanceContent, async (event, id: unknown, kind: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    return instanceContent.list(String(id), kind);
  });
  ipcMain.handle(
    desktopChannels.actInstanceContent,
    async (event, id: unknown, kind: unknown, name: unknown, action: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      return instanceContent.act(String(id), kind, name, action);
    },
  );
  ipcMain.handle(
    desktopChannels.importInstanceContent,
    async (event, id: unknown, kindValue: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const kind = normalizeInstanceContentKind(kindValue);
      await instanceContent.directory(String(id), kind);
      if (kind === 'saves') {
        throw new Error('Añade los mundos desde su carpeta');
      }
      const selection = await dialog.showOpenDialog({
        title: 'Añadir contenido a la instancia',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: kind === 'mods' ? 'Mods' : 'Packs',
            extensions: [kind === 'mods' ? 'jar' : 'zip'],
          },
        ],
      });
      return selection.canceled
        ? instanceContent.list(String(id), kind)
        : instanceContent.import(String(id), kind, selection.filePaths);
    },
  );
  ipcMain.handle(
    desktopChannels.openInstanceContentFolder,
    async (event, id: unknown, kind: unknown, archived: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      const path = await instanceContent.directory(
        String(id),
        kind,
        archived === 'backups' ? 'backups' : archived === true,
      );
      const error = await shell.openPath(path);
      if (error) {
        throw new Error(error);
      }
    },
  );
  ipcMain.handle(desktopChannels.getCustomClients, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return (await resolveCustomClientCatalog().load()).data;
  });
  trackedHandle(desktopChannels.installCustomClient, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    const id = normalizeCustomClientId(value);
    const clients = (await resolveCustomClientCatalog().load()).data;
    const client = clients.find((entry) => entry.id === id);
    if (!client) {
      throw new TypeError('Cliente de Battly desconocido');
    }
    assertMinecraftArchitecture(client.folderName, client.requiredJavaVersion);
    const instances = resolveInstanceStore();
    const instance = await instances.create({
      name: client.name,
      description: 'Cliente oficial del catálogo de Battly',
      version: client.folderName,
      loader: null,
      loaderVersion: null,
      ...(client.requiredJavaVersion
        ? {
            launchProfile: {
              ramMinGb: null,
              ramMaxGb: null,
              javaVersion: 'automatic' as const,
              javaPath: '',
              jvmArgs: '',
            },
          }
        : {}),
    });
    try {
      await resolveCustomClientInstaller().install(
        client,
        await instances.directoryPathInternal(instance.id),
      );
    } catch (error) {
      await instances.archive(instance.id);
      throw error;
    }
    return instances.list();
  });
  trackedHandle(desktopChannels.startInstance, async (event, id: unknown, value: unknown) => {
    if (labyUpdateChoicePending) {
      throw new Error('Elige primero qué hacer con la actualización de LabyMod.');
    }
    if (labyUpdateInProgress) {
      await labyUpdateInProgress;
    }
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string') {
      throw new TypeError('Invalid instance id');
    }
    const request = normalizeInstanceLaunchRequest(value);
    if (launchRequestPreparing || launcherService?.preparing) {
      return {
        ok: false,
        code: 'busy',
        state: 'preparing',
        message:
          'Espera a que termine de prepararse la otra versión. Después puedes abrir otra partida.',
      };
    }
    launchRequestPreparing = true;
    const launchId = Symbol('minecraft-launch');
    selectedLaunchId = launchId;
    cancelSelectedLaunch = () => false;
    let handedOff = false;
    try {
      const instances = resolveInstanceStore();
      const [metadata, instanceDirectory] = await Promise.all([
        instances.readInternal(id),
        instances.directoryPathInternal(id),
      ]);
      const otherLaunches = otherDirectoryLaunches(launchId, instanceDirectory);
      if (
        otherLaunches.some(([, launch]) => launch.safeMode) ||
        (request.safeMode && otherLaunches.length)
      ) {
        return {
          ok: false,
          code: 'busy',
          state: 'preparing',
          message:
            'El modo seguro necesita acceso exclusivo a esta carpeta. Puedes abrir otra instancia en una carpeta diferente.',
        };
      }
      activeLaunchDirectories.set(launchId, {
        path: launchDirectoryKey(instanceDirectory),
        safeMode: request.safeMode === true,
      });
      const overlayInstance = normalizeInstanceDraft(metadata);
      const launchLog = await resolveLaunchLogService().start(
        id,
        `${overlayInstance.version} ${overlayInstance.loader ?? ''}`.trim(),
      );
      const launchWindow = BrowserWindow.fromWebContents(event.sender);
      const readyObserver = new MinecraftClientReadyObserver((ready) => emit(ready));
      const emit = (launchEvent: MinecraftLaunchEvent): void => {
        readyObserver.observe(launchEvent);
        taskbarProgress.launch(launchEvent);
        launchLog.record(launchEvent);
        socialRealtimeService.publishRemote({ type: 'launch', event: launchEvent });
        trackMinecraftGame(
          launchId,
          launchEvent,
          `${overlayInstance.loader || 'Vanilla'} ${overlayInstance.version}${overlayInstance.loaderVersion && overlayInstance.loaderVersion !== 'latest' ? ` (${overlayInstance.loaderVersion})` : ''}`,
        );
        const terminal =
          launchEvent.type === 'exit' ||
          (launchEvent.type === 'state' && ['exited', 'failed'].includes(launchEvent.state));
        if (
          launchWindow &&
          (terminal
            ? runningMinecraftGames.size === 0 || selectedLaunchId === launchId
            : selectedLaunchId === launchId)
        ) {
          resolveWindowBehaviorService().launchEvent(launchWindow, launchEvent);
        }
        if (selectedLaunchId === launchId && !event.sender.isDestroyed()) {
          event.sender.send(desktopChannels.launchEvent, launchEvent);
        }
      };
      const safeMode = new InstanceSafeModeService();
      if (otherLaunches.length === 0) {
        await safeMode.recover(instanceDirectory);
      }
      let safeModeContext: InstanceSafeModeContext | undefined;
      const restoreSafeMode = async (): Promise<void> => {
        if (!safeModeContext) {
          return;
        }
        const context = safeModeContext;
        safeModeContext = undefined;
        await safeMode.restore(context);
      };
      let finalized = false;
      const finalizeLaunch = async (
        exit: MinecraftLaunchExit | null = null,
        launchError?: unknown,
      ): Promise<void> => {
        if (finalized) {
          return;
        }
        finalized = true;
        try {
          refreshPlayingServer();
          await restoreSafeMode();
          await launchLog.close();
          if (launchError instanceof LaunchMemoryCancelledError) {
            return;
          }
          if (
            exit?.code === 0 &&
            !launchError &&
            otherDirectoryLaunches(launchId, instanceDirectory).length === 0
          ) {
            await syncWorldsOnGameClose(instanceDirectory, launchId);
          }
          try {
            const report = await resolveCrashAnalysisService().analyze({
              exit,
              gameDirectory: instanceDirectory,
              instanceId: id,
              launchLogPath: launchLog.path,
              launchStartedAt: launchLog.startedAt,
              ...(launchError ? { launchError } : {}),
            });
            if (report && selectedLaunchId === launchId && !event.sender.isDestroyed()) {
              event.sender.send(desktopChannels.crashReportEvent, report);
            }
          } catch (error) {
            await resolveStructuredLogger().log('error', 'crash-report.analysis-failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          activeLaunchDirectories.delete(launchId);
        }
      };
      if (request.safeMode) {
        try {
          safeModeContext = await safeMode.prepare(instanceDirectory);
        } catch {
          emit({ type: 'state', state: 'failed' });
          await finalizeLaunch();
          return { ok: false, code: 'failed', message: 'No se pudo preparar el modo seguro' };
        }
        emit({ type: 'log', stream: 'game', message: '[Battly] Modo seguro temporal activado' });
      }
      if (process.env.BATTLY_DISABLE_GAME_LAUNCH === '1') {
        emit({ type: 'state', state: 'preparing' });
        emit({ type: 'phase', phase: 'fixture' });
        emit({ type: 'progress', current: 1, total: 1, item: 'fixture' });
        emit({ type: 'log', stream: 'game', message: 'Fixture de lanzamiento preparado' });
        emit({ type: 'state', state: 'running' });
        setTimeout(() => {
          emit({ type: 'exit', code: 0, signal: null });
          void finalizeLaunch({ code: 0, signal: null }).finally(() =>
            emit({ type: 'state', state: 'exited' }),
          );
        }, 1_000);
        handedOff = true;
        return { ok: true };
      }
      const account = await resolveAccountStore().store.selectedInternal();
      if (!account) {
        await finalizeLaunch();
        return { ok: false, code: 'no-account', message: 'Selecciona una cuenta antes de jugar' };
      }
      try {
        const [profileValues, loadedConfig] = await Promise.all([
          readProfileValuesFile(remakeStorePath()),
          resolveConfigClient().load({ preferCache: true }),
        ]);
        const baseOptions = prepareOfflineLaunch(
          buildInstanceLaunchOptions({
            account,
            config: loadedConfig.data,
            instanceDirectory,
            instanceId: id,
            instanceMetadata: metadata,
            profileValues,
          }),
        );
        if (baseOptions.javaArguments.some((argument) => /authlib-injector\.jar/i.test(argument))) {
          await ensureAuthlibInjector(
            baseOptions.root,
            await bundledAuthlibInjectorPath(),
            baseOptions.core?.resourceUrl,
            fetch,
            join(app.getPath('userData'), 'authlib-integrity'),
          );
        }
        const preparedOptions = await prepareLaunchJava(
          { ...baseOptions, ...(request.javaPath ? { javaPath: request.javaPath } : {}) },
          {
            contentRoot: contentRootPath(),
            explicitInstancePath:
              Boolean(request.javaPath) ||
              normalizeInstanceDraft(metadata).launchProfile?.javaVersion === 'custom-path',
            install: (major) => installLaunchJava(resolveManagedJavaRuntimeService(), major, emit),
          },
          emit,
        );
        const options = withWorldsLanConnection(
          withDirectConnectArguments(preparedOptions, request.directConnect),
          request.directConnect,
          worldsService?.current(),
          worldsLanAgentPath(process.resourcesPath, __dirname),
        );
        if (options.javaArguments.some((argument) => argument.includes('worlds-lan-agent.jar='))) {
          emit({
            type: 'log',
            stream: 'game',
            message: '[BattlyWorlds/INFO] LAN adapter attached for the joined room',
          });
        }
        if (request.directConnect) {
          emit({
            type: 'log',
            stream: 'game',
            message: `[servidor] ${request.directConnect.host}:${request.directConnect.port}`,
          });
        }
        const descriptor = minecraftCorePackageFromLauncherConfig(loadedConfig.data.raw);
        const service = resolveLauncherService(descriptor);
        cancelSelectedLaunch = () => service.cancel(launchId);
        await accessMonitor?.check();
        accessMonitor?.assertAllowed();
        await service.start(
          options,
          emit,
          finalizeLaunch,
          launchId,
          request.allowDuplicateMods === true,
        );
        handedOff = true;
        return { ok: true };
      } catch (error) {
        if (error instanceof LaunchMemoryCancelledError) {
          emit({ type: 'state', state: 'exited' });
          await finalizeLaunch(null, error);
          analyticsGames.delete(launchId);
          return { ok: false, code: 'cancelled', message: '' };
        }
        emit({ type: 'state', state: 'failed' });
        await finalizeLaunch(null, error);
        const detail = error instanceof Error ? error.message : 'Error desconocido';
        return {
          ok: false,
          code: 'failed',
          message: minecraftFailureMessage(error, `No se pudo iniciar la instancia: ${detail}`),
        };
      }
    } finally {
      launchRequestPreparing = false;
      setTimeout(runPendingLabyUpdates, 1000);
      if (!handedOff) {
        activeLaunchDirectories.delete(launchId);
      }
    }
  });
  ipcMain.handle(desktopChannels.cancelLaunch, (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return cancelSelectedLaunch();
  });
  ipcMain.handle(desktopChannels.openLaunchLogs, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const path = resolveLaunchLogService().root;
    await mkdir(path, { recursive: true });
    const error = await shell.openPath(path);
    if (error) {
      throw new Error('Could not open Minecraft launch logs');
    }
  });
  ipcMain.handle(desktopChannels.listLaunchLogs, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    return resolveLaunchLogService().list();
  });
  ipcMain.handle(desktopChannels.readLaunchLog, async (event, id: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (typeof id !== 'string') {
      throw new TypeError('Invalid launch log id');
    }
    return resolveLaunchLogService().read(id);
  });
  trackedHandle(
    desktopChannels.applyCrashRepair,
    async (event, reportValue: unknown, repairValue: unknown) => {
      assertTrustedSender(event.senderFrame?.url);
      if (activeLaunchDirectories.size || runningMinecraftGames.size) {
        throw new Error('Cierra Minecraft antes de aplicar una reparación');
      }
      const request = normalizeCrashRepairRequest(reportValue, repairValue);
      const service = resolveCrashAnalysisService();
      try {
        return await service.apply(request.reportId, request.repairId, undefined, (phase, mod) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(desktopChannels.crashRepairProgress, {
              reportId: request.reportId,
              repairId: request.repairId,
              phase,
              mod,
            });
          }
        });
      } catch (error) {
        if (!(error instanceof CrashRepairFileRequiredError)) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? String(sanitizeDiagnosticValue(error.message))
                : 'No se pudo aplicar la solución de forma segura.',
            repairId: null,
          };
        }
        const owner = BrowserWindow.fromWebContents(event.sender);
        const options: Electron.OpenDialogOptions = {
          title: 'Selecciona opengl32.dll de Mesa3D',
          properties: ['openFile'],
          filters: [{ name: 'Biblioteca OpenGL de Mesa3D', extensions: ['dll'] }],
        };
        const selection = owner
          ? await dialog.showOpenDialog(owner, options)
          : await dialog.showOpenDialog(options);
        if (selection.canceled || !selection.filePaths[0]) {
          return { ok: false, message: 'No se ha seleccionado ningún archivo.', repairId: null };
        }
        if (activeLaunchDirectories.size || runningMinecraftGames.size) {
          throw new Error('Cierra Minecraft antes de aplicar una reparación', { cause: error });
        }
        try {
          return await service.apply(request.reportId, request.repairId, selection.filePaths[0]);
        } catch (repairError) {
          return {
            ok: false,
            message:
              repairError instanceof Error
                ? String(sanitizeDiagnosticValue(repairError.message))
                : 'No se pudo aplicar la solución de forma segura.',
            repairId: null,
          };
        }
      }
    },
  );
  trackedHandle(desktopChannels.rollbackCrashRepair, async (event, value: unknown) => {
    assertTrustedSender(event.senderFrame?.url);
    if (activeLaunchDirectories.size || runningMinecraftGames.size) {
      throw new Error('Cierra Minecraft antes de deshacer una reparación');
    }
    return resolveCrashAnalysisService().rollback(normalizeCrashRepairRollback(value));
  });

  const withTrustedWindow = (
    senderUrl: string | undefined,
    sender: Electron.WebContents,
    action: (window: BrowserWindow) => void,
  ): void => {
    assertTrustedSender(senderUrl);
    const window = BrowserWindow.fromWebContents(sender);
    if (!window) {
      throw new Error('Rejected window action without an owning window');
    }
    action(window);
  };

  ipcMain.handle(desktopChannels.minimizeWindow, (event) => {
    withTrustedWindow(event.senderFrame?.url, event.sender, (window) => window.minimize());
  });
  ipcMain.handle(desktopChannels.toggleMaximizeWindow, (event) => {
    withTrustedWindow(event.senderFrame?.url, event.sender, (window) => {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    });
  });
  ipcMain.handle(desktopChannels.closeWindow, (event) => {
    withTrustedWindow(event.senderFrame?.url, event.sender, (window) => window.close());
  });
  ipcMain.handle(desktopChannels.openBattlyFolder, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    const path = contentRootPath();
    await mkdir(path, { recursive: true });
    return (await shell.openPath(path)) === '';
  });
  ipcMain.handle(desktopChannels.openDiscord, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await confirmExternalLink('https://discord.gg/tecno-bros-885235460178342009');
    return true;
  });
  ipcMain.handle(desktopChannels.openPasswordHelp, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await confirmExternalLink('https://discord.gg/tecno-bros-885235460178342009');
    return true;
  });
  ipcMain.handle(desktopChannels.openBattlyRegister, async (event) => {
    assertTrustedSender(event.senderFrame?.url);
    await confirmExternalLink('https://battlylauncher.com/register');
    return true;
  });
}

function secureWebContents(window: BrowserWindow, allowGoogleDriveAuth = false): void {
  if (allowGoogleDriveAuth) {
    window.webContents.on('did-create-window', (popup, details) => {
      if (details.url === 'https://battlylauncher.com/google-drive/auth') {
        bridgeGoogleDriveAuthorization(window, popup);
      }
    });
  }
  window.webContents.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') {
      return;
    }
    launcherAnalytics.log(details.level === 'error' ? 'error' : 'warn', details.message, {
      line: details.lineNumber,
    });
    void resolveStructuredLogger()
      .log(details.level === 'error' ? 'error' : 'warn', 'renderer.console', {
        message: details.message,
        source: details.sourceId,
        line: details.lineNumber,
      })
      .catch(() => undefined);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowGoogleDriveAuth && url === 'https://battlylauncher.com/google-drive/auth') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 600,
          parent: window,
          modal: true,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, rendererUrl)) {
      event.preventDefault();
    }
  });
}

function createMainWindow(
  showWhenReady = true,
  visual: VisualPreferences = defaultVisualPreferences,
  loadingColor = '#3e8ed0',
  introVolume = 0.8,
  startupSound = 'start',
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 980,
    minHeight: 552,
    frame: false,
    titleBarStyle:
      process.platform === 'darwin' || process.platform === 'linux' ? 'hidden' : 'default',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1623',
    webPreferences: {
      ...createSecureWebPreferences(join(__dirname, '..', 'preload', 'index.js')),
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false);
  }
  secureWebContents(window, true);
  window.on('focus', () => void sampleDesktopUsage().catch(() => undefined));
  window.on('blur', () => void sampleDesktopUsage().catch(() => undefined));
  window.on('close', (event) => resolveWindowBehaviorService().closeRequested(window, event));
  window.on('show', () => {
    if (focusStartupUpdate()) {
      window.hide();
    }
  });
  if (showWhenReady) {
    window.once('ready-to-show', () => window.show());
  }
  void window.loadFile(rendererPath, {
    query: {
      theme: visual.buttonColor,
      hover: visual.buttonHoverColor,
      footer: visual.footerColor,
      opacity: String(visual.footerOpacity),
      loading: loadingColor,
      introVolume: String(introVolume),
      startupSound: showWhenReady ? startupSound : '',
    },
  });

  mainWindow = window;
  taskbarProgress.refresh();
  return window;
}

function createSplashWindow(
  language: string,
  startupSound: string,
  startupVolume: number,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    resizable: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: createSecureWebPreferences(join(__dirname, '..', 'preload', 'splash.js')),
  });
  secureWebContents(window);
  const presentation = new StartupSplashPresentation();
  splashPresentation = presentation;
  window.once('ready-to-show', () => {
    if (window.isDestroyed()) {
      return;
    }
    window.show();
    presentation.shown();
  });
  window.webContents.once('did-finish-load', () => {
    if (!window.isDestroyed()) {
      window.webContents.send(desktopChannels.startupProgress, startupProgress.snapshot());
    }
  });
  window.on('closed', () => {
    presentation.closed();
    if (splashWindow === window) {
      splashWindow = undefined;
    }
  });
  void window
    .loadFile(splashPath, {
      query: {
        lang: language,
        sound: startupSound,
        volume: String(startupVolume),
      },
    })
    .catch((error) => {
      presentation.closed();
      if (!window.isDestroyed()) {
        window.close();
      }
      console.warn(
        '[startup] Splash could not load:',
        error instanceof Error ? error.message : 'Load failed',
      );
    });
  splashWindow = window;
  return window;
}

function resolveMusicOverlay(): MusicOverlayDesktop {
  return (musicOverlay ??= new MusicOverlayDesktop({
    path: join(app.getPath('userData'), 'music-overlay.json'),
    rendererPath,
    webPreferences: createSecureWebPreferences(join(__dirname, '..', 'preload', 'index.js')),
    secure: secureWebContents,
    control: (command) => {
      if (musicControlTarget && !musicControlTarget.isDestroyed()) {
        musicControlTarget.send(desktopChannels.musicOverlayControl, command);
      }
    },
  }));
}

function updateMusicWindows(playback: MusicPlaybackState): void {
  if (musicOverlayEnabled) {
    resolveMusicOverlay().updatePlayback(playback);
    return;
  }
  if (!playback.title) {
    closeMusicWindow();
  }
  if (musicWindow && !musicWindow.isDestroyed()) {
    musicWindow.webContents.send(desktopChannels.musicPlaybackChanged, playback);
  }
}

function closeMusicWindow(): void {
  if (musicOverlayEnabled) {
    musicOverlay?.close();
    return;
  }
  const window = musicWindow;
  musicWindow = undefined;
  if (window && !window.isDestroyed()) {
    window.close();
  }
}

function showMusicWindow(): void {
  if (musicOverlayEnabled) {
    const overlay = resolveMusicOverlay();
    overlay.updatePlayback(musicPlaybackState);
    void overlay.ensureDefaultWidget().catch(() => {});
    return;
  }
  if (!musicPlaybackState.title) {
    return;
  }
  if (musicWindow && !musicWindow.isDestroyed()) {
    musicWindow.showInactive();
    musicWindow.webContents.send(desktopChannels.musicPlaybackChanged, musicPlaybackState);
    return;
  }
  const width = 380;
  const height = 160;
  const parentBounds = mainWindow?.getBounds();
  const display = parentBounds
    ? screen.getDisplayNearestPoint({
        x: parentBounds.x + Math.round(parentBounds.width / 2),
        y: parentBounds.y + Math.round(parentBounds.height / 2),
      })
    : screen.getPrimaryDisplay();
  const margin = 16;
  const window = new BrowserWindow({
    width,
    height,
    x: display.workArea.x + display.workArea.width - width - margin,
    y: display.workArea.y + display.workArea.height - height - margin,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: createSecureWebPreferences(join(__dirname, '..', 'preload', 'index.js')),
  });
  musicWindow = window;
  secureWebContents(window);
  window.on('closed', () => {
    if (musicWindow === window) {
      musicWindow = undefined;
    }
  });
  window.webContents.once('did-finish-load', () => {
    if (window.isDestroyed()) {
      return;
    }
    window.webContents.send(desktopChannels.musicPlaybackChanged, musicPlaybackState);
    window.showInactive();
  });
  void window.loadFile(rendererPath, { query: { window: 'music' } });
}

function registerBattlyProtocol(): void {
  for (const scheme of ['battlylauncher', discordLaunchScheme]) {
    if (process.platform === 'win32' && !packagedApplication && process.argv[1]) {
      app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(scheme);
    }
  }
}

registerBattlyProtocol();
app.on('open-url', (event, url) => {
  const action = battlyProtocolAction(url);
  if (action) {
    event.preventDefault();
    sendProtocolAction(action);
  }
});
const singleInstanceLock =
  (Reflect.get(globalThis, Symbol.for('battly.bootstrap.lock')) as boolean | undefined) ??
  app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  pendingMrpackPath = mrpackArgument(process.argv);
  pendingPlayRequest = directPlayArgument(process.argv);
  const initialProtocolUrl = battlyProtocolArgument(process.argv);
  if (initialProtocolUrl) {
    pendingProtocolAction = battlyProtocolAction(initialProtocolUrl);
  }
  app.on('second-instance', (_event, argv) => {
    if (maintenanceWindow.focus()) {
      return;
    }
    const protocolUrl = battlyProtocolArgument(argv);
    const protocolAction = protocolUrl ? battlyProtocolAction(protocolUrl) : undefined;
    if (protocolAction) {
      sendProtocolAction(protocolAction);
      return;
    }
    const playRequest = directPlayArgument(argv);
    if (playRequest) {
      sendDirectPlayRequest(playRequest);
      return;
    }
    const path = mrpackArgument(argv);
    if (path) {
      void installExternalMrpack(path);
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
  app.on('open-file', (event, path) => {
    event.preventDefault();
    if (!['.mrpack', '.bypack'].includes(extname(path).toLowerCase())) {
      return;
    }
    if (app.isReady()) {
      void installExternalMrpack(path);
    } else {
      pendingMrpackPath = path;
    }
  });
}

if (singleInstanceLock) {
  void app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.battlylauncher.launcher');
    }
    if (process.platform === 'linux') {
      app.setDesktopName('com.battlylauncher.launcher.desktop');
    }
    try {
      await initializePrivateStorage(
        app.getPath('userData'),
        [
          remakeStorePath(),
          visualPreferenceStorePath(),
          process.env.BATTLY_DIAGNOSTIC_LOG_PATH,
        ].filter((value): value is string => !!value),
        [process.env.BATTLY_LAUNCH_LOGS_PATH].filter((value): value is string => !!value),
        [legacyStorePath()],
      );
      await migrate301Profile({
        sourcePath: legacyStorePath(),
        targetPath: remakeStorePath(),
        userData: app.getPath('userData'),
        legacyContentRoot: join(
          process.platform === 'linux' ? app.getPath('home') : app.getPath('appData'),
          '.battly',
        ),
        readBrowser: () =>
          readLegacyBrowserStorage(
            dirname(legacyStorePath()),
            join(app.getPath('userData'), 'migration-work'),
          ),
      });
      migratingLegacyData = false;
      activeContentRootPath = (await battlyDataRootSnapshot()).currentPath;
      void sampleDesktopUsage().catch(() => undefined);
      setInterval(() => void sampleDesktopUsage().catch(() => undefined), 30_000).unref();
      await migrate301Servers(
        contentRootPath(),
        process.env.BATTLY_SERVERS_PATH ||
          join(contentRootPath(), 'battly', 'servers', 'battlyservers.net'),
        app.getPath('userData'),
        (await resolveSettingsStore().snapshot()).runtime.ramMaxGb * 1024,
      );
      await protectContentMetadata();
    } catch (error) {
      console.error('[startup] Could not unlock local storage:', error);
      const { dialog: startupDialog } = await import('electron');
      // The encrypted preferences cannot be read yet; use the system language.
      const translateStartup = await nativeTranslator(app.getLocale().split(/[-_]/)[0]);
      startupDialog.showErrorBox(
        translateStartup('Battly · Almacenamiento seguro'),
        translateStartup(
          error instanceof Error ? error.message : 'No se pudieron desbloquear los datos locales.',
        ),
      );
      app.exit(1);
      return;
    }
    let settings = await resolveSettingsStore().snapshot();
    const maintenance = await launcherMaintenance(() => resolveConfigClient().load());
    if (maintenance) {
      translateNative = await nativeTranslator(settings.visual.language);
      maintenanceWindow.show(maintenance.message, translateNative);
      return;
    }
    const loadingColor = await resolveSettingsStore().startupLoadingColorPreference();
    const storedStartupAudio = await resolveSettingsStore().startupSoundPreference();
    let premium = false;
    // Check the entitlement for Boost too, even when no premium media is selected.
    if (
      settings.runtime.launchBoostEnabled ||
      settings.runtime.startupSoundEnabled ||
      (settings.visual.backgroundUrl && !/\.(png|jpe?g)$/i.test(settings.visual.backgroundUrl))
    ) {
      premium = await startupPremium(
        async () => (await resolveThemeService().sounds(await selectedBattlyToken())).premium,
      );
    }
    const launchBoost = canSkipStartupSplash(settings.runtime.launchBoostEnabled, premium);
    if (!premium) {
      settings = {
        ...settings,
        visual: {
          ...settings.visual,
          backgroundUrl:
            settings.visual.backgroundUrl && /\.(png|jpe?g)$/i.test(settings.visual.backgroundUrl)
              ? settings.visual.backgroundUrl
              : null,
        },
        runtime: { ...settings.runtime, startupSoundEnabled: false },
      };
    }
    const startupAudio = {
      ...storedStartupAudio,
      volume: settings.runtime.startupSoundEnabled ? storedStartupAudio.volume : 0,
    };
    if (!launchBoost) {
      createSplashWindow(settings.visual.language, startupAudio.sound, startupAudio.volume);
    }
    protocol.handle('battly-audio', async (request) => {
      const url = new URL(request.url);
      const file =
        url.hostname === 'cache' && !url.search && !url.hash
          ? await resolveMusicAudioCache().file(url.pathname.slice(1))
          : null;
      if (!file) {
        return new Response(null, { status: 404 });
      }
      return cachedAudioResponse(file, request);
    });
    void registerBypackAssociation({
      executablePath: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      ...(!packagedApplication ? { appPath: app.getAppPath() } : {}),
      iconPath: packagedApplication
        ? join(process.resourcesPath, 'icon.ico')
        : join(app.getAppPath(), 'build-resources', 'icon.ico'),
    }).catch((error: unknown) => {
      console.warn(
        'No se pudo registrar la asociación .bypack:',
        error instanceof Error ? error.message : error,
      );
    });
    void resolveGoogleDriveSyncService()
      .state()
      .catch((error) =>
        resolveStructuredLogger().log('warn', 'google-drive.startup-refresh-failed', {
          message: error instanceof Error ? error.message : 'Refresh failed',
        }),
      );
    void syncWorldsOnGameClose();
    setInterval(() => {
      void syncWorldsOnGameClose();
    }, 5 * 60_000).unref();
    startupProgress.complete('profile', 'Preparando el perfil de Battly…');
    startupProgress.complete('settings', 'Cargando ajustes y preferencias…');
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        contents === mainWindow?.webContents &&
        permission === 'media' &&
        details.mediaType === 'audio' &&
        Date.now() < worldsMicAllowedUntil,
    );
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        callback(
          contents === mainWindow?.webContents &&
            permission === 'media' &&
            'mediaTypes' in details &&
            details.mediaTypes?.includes('audio') === true &&
            !details.mediaTypes?.includes('video') &&
            Date.now() < worldsMicAllowedUntil,
        );
      },
    );

    registerDesktopIpc();
    translateNative = await nativeTranslator(settings.visual.language);
    discordPresence.configure(settings.privacy);
    await refreshDiscordIdentity();
    accessMonitor = new AccessMonitor(
      join(app.getPath('userData'), 'access-restriction.json'),
      selectedBattlyToken,
      (ban) => {
        if (ban) {
          socialRealtimeService.stop();
          worldsDesktop?.stop();
          void worldsService?.stop();
          banWindow.show(ban, translateNative);
        } else {
          banWindow.lift();
          mainWindow?.show();
        }
      },
    );
    app.on('browser-window-created', (_event, created) => {
      created.on('show', () => {
        if (accessMonitor?.ban && !banWindow.owns(created)) {
          created.hide();
        }
      });
    });
    await accessMonitor.start();
    startupProgress.complete('services', 'Iniciando servicios de Battly…');
    const window = createMainWindow(
      launchBoost && !packagedApplication,
      settings.visual,
      loadingColor,
      startupAudio.volume,
      startupAudio.sound,
    );
    startupProgress.complete('window', 'Cargando la interfaz…');
    const incomingMrpack = pendingMrpackPath;
    pendingMrpackPath = undefined;
    if (incomingMrpack) {
      window.webContents.once('did-finish-load', () => void installExternalMrpack(incomingMrpack));
    }
    const incomingPlayRequest = pendingPlayRequest;
    pendingPlayRequest = undefined;
    if (incomingPlayRequest) {
      window.webContents.once('did-finish-load', () => {
        setTimeout(() => sendDirectPlayRequest(incomingPlayRequest), 350).unref();
      });
    }
    const incomingProtocolAction = pendingProtocolAction;
    pendingProtocolAction = undefined;
    if (incomingProtocolAction) {
      window.webContents.once('did-finish-load', () => {
        setTimeout(() => sendProtocolAction(incomingProtocolAction), 350).unref();
      });
    }
    await resolveStructuredLogger()
      .log('info', 'app.ready', {
        version: app.getVersion(),
        development,
      })
      .catch(() => undefined);
    void refreshLauncherAnalytics();
    if (musicOverlayEnabled) {
      await resolveMusicOverlay().start();
    }
    startPublicNotifications();
    const trayPath =
      process.platform === 'win32'
        ? packagedApplication
          ? join(process.resourcesPath, 'icon.ico')
          : join(app.getAppPath(), 'build-resources', 'icon.ico')
        : packagedApplication
          ? join(process.resourcesPath, 'icon.png')
          : join(app.getAppPath(), 'src/renderer/assets/icon.png');
    musicTray = new Tray(createTrayIcon(trayPath, process.platform, translateNative));
    updateMusicTray(emptyMusicPlaybackState, window.webContents);
    musicTray.on('click', revealLauncherFromTray);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

let worldsQuitReady = false;
let analyticsQuitReady = false;
let driveQuitReady = false;
let privateStorageQuitReady = false;
let noticesQuitReady = false;
let usageQuitReady = false;
let musicOverlayQuitReady = false;
app.on('before-quit', (event) => {
  if (rootMigrationActive || battlyDataRootService?.busy) {
    event.preventDefault();
    return;
  }
  if (musicOverlay && !musicOverlayQuitReady) {
    event.preventDefault();
    musicOverlayQuitReady = true;
    void musicOverlay.flush().finally(() => app.quit());
    return;
  }
  if (desktopUsageHistory && !usageQuitReady) {
    event.preventDefault();
    usageQuitReady = true;
    void desktopUsageHistory
      .finish()
      .catch(() => undefined)
      .finally(() => app.quit());
    return;
  }
  publicNotificationSocket?.disconnect();
  if (notificationService && !noticesQuitReady) {
    event.preventDefault();
    noticesQuitReady = true;
    void notificationService.flush().finally(() => app.quit());
    return;
  }
  accessMonitor?.stop();
  if (rendererPreferences && !privateStorageQuitReady) {
    event.preventDefault();
    privateStorageQuitReady = true;
    void rendererPreferences.flush().finally(() => app.quit());
    return;
  }
  if (googleDriveSyncService && !driveQuitReady) {
    event.preventDefault();
    void driveAutomaticQueue.finally(async () => {
      await googleDriveSyncService?.waitForIdle();
      driveQuitReady = true;
      app.quit();
    });
    return;
  }
  if (!analyticsQuitReady) {
    event.preventDefault();
    analyticsQuitReady = true;
    void launcherAnalytics.close().finally(() => app.quit());
    return;
  }
  windowBehaviorService?.beforeQuit();
  musicOverlay?.dispose();
  clientBridge?.close();
  discordPresence.dispose();
  worldsDesktop?.stop();
  if (worldsService && !worldsQuitReady) {
    event.preventDefault();
    void worldsService.stop().finally(() => {
      worldsQuitReady = true;
      app.quit();
    });
  }
});

app.on('window-all-closed', () => {
  if (migratingLegacyData) {
    return;
  }
  serverSharingService?.dispose();
  serverRuntimeService?.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
