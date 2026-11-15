import type { DriveTransferProgress as ImportedDriveTransferProgress } from './settings/drive-progress';
import type { ThemeSoundLibrary as ImportedThemeSoundLibrary } from './themes/theme-contract';
import type { ModBasketRequest, ModBasketResult, ModBasketProgress } from './mods/mod-basket';
import type { LocalModTarget } from './mods/mod-contract';
import type {
  BattlyClientBuild,
  BattlyClientUpdateNotice,
} from './minecraft/battly-client-contract';
import type { JavaRuntimeProvider } from './settings/java-runtime-contract';
import type { CapeLibrarySnapshot, CapeActionResult } from './skins/skin-contract';
import type { UpdateAction, UpdateSettings, UpdateSnapshot } from './updates';
import type { ServerSoftwareAvailability } from './servers/server-contract';
import type {
  WorldsEvent,
  WorldsPublicRoom,
  WorldsVoiceCommand,
  WorldsVoiceStatus,
} from './social/battly-worlds-contract';
import type { WorldsAction, WorldsSnapshot } from './social/battly-worlds-contract';
import type { DriveState } from './mybattly/mybattly-contract';
import type {
  MusicOverlaySnapshot,
  MusicOverlayPreferences,
  MusicOverlayCommand,
} from './music/music-overlay';
import type { BypackExportResult, BypackPreview } from './minecraft/bypack';
import type {
  InstanceContentAction,
  InstanceContentEntry,
  InstanceContentKind,
} from './minecraft/instance-content';
import type { AppInfo } from './app-info';
import type { BattlyProtocolAction } from './app-protocol';
import type { AccountCollection } from './accounts/account';
import type { AuthOutcome, AuthRequest } from './auth/auth-contract';
import type { VisualPreferences } from './preferences/visual-preferences';
import type { SettingsDraft, SettingsSnapshot } from './settings/settings-contract';
import type { JvmArgsConfig } from './settings/jvm-args-contract';
import type { BattlyDataRootSnapshot, DataRootProgress } from './settings/data-root-contract';
import type {
  ManagedJavaInstallProgress,
  ManagedJavaMajor,
  ManagedJavaSnapshot,
} from './settings/java-runtime-contract';
import type { DiagnosticSaveOutcome } from './diagnostics/diagnostics-contract';
import type {
  BattlyTheme,
  ThemeDraft,
  ThemeLibrarySnapshot,
  ThemeReviewResult,
  ThemeShareResult,
} from './themes/theme-contract';
import type { InstanceDraft, InstanceSummary } from './minecraft/instance';
import type { BattlyCustomClient } from './minecraft/custom-client-contract';
import type {
  PlayVersionLaunchRequest,
  PlayVersionSnapshot,
} from './minecraft/play-version-contract';
import type { DownloadCatalogSnapshot } from './minecraft/download-catalog-contract';
import type {
  LoaderBuildSnapshot,
  LoaderGameVersionSnapshot,
  MinecraftLoaderKind,
} from './minecraft/loader-build-contract';
import type {
  MinecraftInstanceLaunchRequest,
  MinecraftLaunchEvent,
  MinecraftLaunchOutcome,
} from './minecraft/launch-contract';
import type { HomeSnapshot } from './home/home-contract';
import type {
  LocalModCompatibilityFixResult,
  LocalModCompatibilityReport,
  LocalModSummary,
  ModInstallRequest,
  ModProjectDetail,
  ModProjectType,
  ModSearchRequest,
  ModSearchResult,
} from './mods/mod-contract';
import type { ModpackInstallProgress } from './mods/modpack-install-contract';
import type { NoticeSnapshot, NoticeSettings } from './notifications';
import type {
  MusicCollaborationInvite,
  MusicControlAction,
  MusicFavoriteDraft,
  MusicPlaybackState,
  MusicPlaylist,
  MusicPlaylistImport,
  MusicPlaylistActivity,
  MusicPlaylistCollaboration,
  MusicPlaylistShare,
  MusicPlaylistUpdateDraft,
  MusicQuality,
  MusicSong,
  MusicSnapshot,
} from './music/music-contract';
import type {
  ChatConversation,
  ChatMessage,
  SocialAction,
  SocialProfile,
  SocialRealtimeState,
  SocialServer,
  SocialSnapshot,
  ProfileCustomization,
  ProfileBackgroundSelection,
  RemoteLaunchRequest,
} from './social/social-contract';
import type {
  MyBattlyResourcePack,
  MyBattlySnapshot,
  MyBattlyWorld,
  WorldBackupSummary,
} from './mybattly/mybattly-contract';
import type { InitialLanguage, OnboardingState } from './onboarding/onboarding-contract';
import type {
  ServerDraft,
  ServerContentEntry,
  ServerContentKind,
  ServerFileContent,
  ServerFileEntry,
  ServerInstallProgress,
  ServerInviteDraft,
  ServerInvitation,
  ServerPlayerListMutation,
  ServerPlayerListsSnapshot,
  ServerProperties,
  ServerRuntimeEvent,
  ServerRuntimeSnapshot,
  ServerSoftwareKind,
  ServerSharingSnapshot,
  ServerSummary,
} from './servers/server-contract';
import type { SkinActionResult, SkinLibrarySnapshot } from './skins/skin-contract';
import type { LabyModVersion } from './minecraft/labymod-contract';
import type {
  MinecraftCrashRepairResult,
  MinecraftCrashRepairProgress,
  MinecraftCrashReport,
} from './minecraft/crash-report-contract';

export const desktopChannels = {
  analyticsPanel: 'analytics:panel',
  worldsEvent: 'worlds:event',
  worldsPublicRooms: 'worlds:public-rooms',
  worldsVoiceCommand: 'worlds:voice-command',
  worldsVoiceSignal: 'worlds:voice-signal',
  worldsVoiceState: 'worlds:voice-state',
  worldsVoiceActivity: 'worlds:voice-activity',
  worldsVoiceParty: 'worlds:voice-party',

  getWorldsSnapshot: 'worlds:snapshot',
  openWorldsSource: 'worlds:source',
  openWorldsGamePanel: 'worlds:open-game-panel',
  worldsAction: 'worlds:action',
  getAccounts: 'accounts:list',
  getAccountSkinUrl: 'accounts:skin',
  selectAccount: 'accounts:select',
  removeAccount: 'accounts:remove',
  removeAllAccounts: 'accounts:remove-all',
  startAuth: 'auth:start',
  cancelAuth: 'auth:cancel',
  getInstances: 'instances:list',
  createInstance: 'instances:create',
  updateInstance: 'instances:update',
  archiveInstance: 'instances:archive',
  openInstanceFolder: 'instances:open-folder',
  exportBypack: 'instances:export-bypack',
  exportServerBypack: 'servers:export-bypack',
  revealBypack: 'instances:reveal-bypack',
  getModVersionCatalog: 'mods:version-catalog',
  getMinecraftVersionList: 'mods:minecraft-version-list',
  getModDisableDependents: 'mods:disable-dependents',
  importBypack: 'instances:import-bypack',
  confirmBypack: 'instances:confirm-bypack',
  bypackOpenRequested: 'instances:bypack-open-requested',
  bypackProgress: 'instances:bypack-progress',
  getInstanceContent: 'instances:content-list',
  importInstanceContent: 'instances:content-import',
  actInstanceContent: 'instances:content-act',
  openInstanceContentFolder: 'instances:content-open-folder',
  getCustomClients: 'instances:custom-clients',
  getPlayVersions: 'minecraft:play-versions',
  getDownloadCatalog: 'minecraft:download-catalog',
  getLoaderBuilds: 'minecraft:loader-builds',
  getLoaderGameVersions: 'minecraft:loader-game-versions',
  installPlayClient: 'minecraft:install-play-client',
  getBattlyClientBuilds: 'minecraft:battly-client-builds',
  installBattlyClient: 'minecraft:install-battly-client',
  battlyClientUpdatePrompt: 'battly-client:update-prompt',
  battlyClientUpdateChoice: 'battly-client:update-choice',
  getLabyModVersions: 'minecraft:labymod-versions',
  installLabyMod: 'minecraft:install-labymod',
  startPlayVersion: 'minecraft:start-play-version',
  createPlayShortcut: 'minecraft:create-play-shortcut',
  directPlayRequested: 'minecraft:direct-play-requested',
  installCustomClient: 'instances:install-custom-client',
  startInstance: 'minecraft:start-instance',
  cancelLaunch: 'minecraft:cancel',
  launchEvent: 'minecraft:event',
  crashRepairProgress: 'minecraft:crash-repair-progress',
  crashReportEvent: 'minecraft:crash-report',
  applyCrashRepair: 'minecraft:crash-repair-apply',
  rollbackCrashRepair: 'minecraft:crash-repair-rollback',
  openLaunchLogs: 'minecraft:open-logs',
  listLaunchLogs: 'minecraft:list-logs',
  readLaunchLog: 'minecraft:read-log',
  getHome: 'home:get-snapshot',
  homeUpdated: 'home:updated',
  getNewsState: 'news:get-state',
  completeNews: 'news:complete',
  getMyBattly: 'mybattly:get-snapshot',
  archiveWorld: 'mybattly:archive-world',
  toggleResourcePack: 'mybattly:toggle-resource-pack',
  archiveResourcePack: 'mybattly:archive-resource-pack',
  getWorldBackups: 'mybattly:get-world-backups',
  restoreWorldBackup: 'mybattly:restore-world-backup',
  getBackupWorlds: 'mybattly:backup-worlds',
  createWorldBackup: 'mybattly:create-world-backup',
  archiveWorldBackup: 'mybattly:archive-world-backup',
  getOnboarding: 'onboarding:get-state',
  selectInitialLanguage: 'onboarding:select-language',
  completeWelcome: 'onboarding:complete-welcome',
  getServers: 'servers:list',
  getServerSoftwareAvailability: 'servers:software-availability',
  createServer: 'servers:create',
  updateServerProperties: 'servers:update-properties',
  archiveServer: 'servers:archive',
  getServerRuntime: 'servers:runtime-snapshot',
  startServerRuntime: 'servers:runtime-start',
  stopServerRuntime: 'servers:runtime-stop',
  restartServerRuntime: 'servers:runtime-restart',
  sendServerCommand: 'servers:runtime-command',
  serverRuntimeEvent: 'servers:runtime-event',
  installServer: 'servers:install',
  serverInstallProgress: 'servers:install-progress',
  getServerPlayerLists: 'servers:player-lists',
  mutateServerPlayerList: 'servers:player-list-mutate',
  listServerFiles: 'servers:files-list',
  readServerFile: 'servers:file-read',
  writeServerFile: 'servers:file-write',
  exportServerFile: 'servers:file-export',
  revealServerFile: 'servers:file-reveal',
  archiveServerFile: 'servers:file-archive',
  importServerWorld: 'servers:world-import',
  getServerContent: 'servers:content-list',
  importServerContent: 'servers:content-import',
  toggleServerContent: 'servers:content-toggle',
  archiveServerContent: 'servers:content-archive',
  openServerContentFolder: 'servers:content-open-folder',
  getServerSharing: 'servers:sharing-get',
  startServerTunnel: 'servers:tunnel-start',
  stopServerTunnel: 'servers:tunnel-stop',
  inviteServerFriend: 'servers:sharing-invite',
  revokeServerPermission: 'servers:sharing-revoke',
  getCapes: 'capes:get-library',
  uploadCape: 'capes:upload',
  setCape: 'capes:set',
  deleteCape: 'capes:delete',
  removeCape: 'capes:remove',
  getSkins: 'skins:get-library',
  uploadSkin: 'skins:upload',
  setSkin: 'skins:set',
  deleteSkin: 'skins:delete',
  searchMods: 'mods:search',
  getModProjectDetails: 'mods:get-project-details',
  installMod: 'mods:install',
  installModBasket: 'mods:basket-install',
  modBasketProgress: 'mods:basket-progress',
  openModrinthProject: 'mods:open-project',
  getLocalMods: 'mods:list-local',
  toggleLocalMod: 'mods:toggle-local',
  batchLocalMods: 'mods:batch-local',
  revealLocalMod: 'mods:reveal-local',
  openLocalMod: 'mods:open-local',
  archiveLocalMod: 'mods:archive-local',
  openModsFolder: 'mods:open-folder',
  analyzeLocalMods: 'mods:analyze-local',
  disableIncompatibleMods: 'mods:disable-incompatible',
  importMrpack: 'mods:import-mrpack',
  importDroppedMrpack: 'mods:import-dropped-mrpack',
  mrpackImportEvent: 'mods:mrpack-import-event',
  modpackInstallProgress: 'mods:modpack-install-progress',
  getMusic: 'music:get-snapshot',
  recordMusicPlay: 'music:record-play',
  resolveMusicSource: 'music:resolve-source',
  searchMusic: 'music:search',
  resolveMusicMetadata: 'music:resolve-metadata',
  rememberMusicDuration: 'music:remember-duration',
  getYouTubeMusicPlaylist: 'music:get-youtube-playlist',
  getSpotifyMusicPlaylist: 'music:get-spotify-playlist',
  spotifyMusicProgress: 'music:spotify-progress',
  getMusicFavorites: 'music:get-favorites',
  setMusicFavorite: 'music:set-favorite',
  createMusicPlaylist: 'music:create-playlist',
  updateMusicPlaylist: 'music:update-playlist',
  updateMusicPlaylistSongs: 'music:update-playlist-songs',
  deleteMusicPlaylist: 'music:delete-playlist',
  shareMusicPlaylist: 'music:share-playlist',
  importSharedMusicPlaylist: 'music:import-shared-playlist',
  getMusicInvites: 'music:get-invites',
  respondMusicInvite: 'music:respond-invite',
  getMusicPlaylistCollaboration: 'music:get-playlist-collaboration',
  inviteMusicPlaylistCollaborator: 'music:invite-playlist-collaborator',
  cancelMusicPlaylistInvite: 'music:cancel-playlist-invite',
  removeMusicPlaylistCollaborator: 'music:remove-playlist-collaborator',
  getMusicPlaylistActivity: 'music:get-playlist-activity',
  musicPlaybackState: 'music:playback-state',
  getMusicPlaybackState: 'music:playback-state-get',
  musicPlaybackChanged: 'music:playback-state-changed',
  musicOverlayGet: 'music:overlay-get',
  musicOverlayConfigure: 'music:overlay-configure',
  musicOverlayCommand: 'music:overlay-command',
  musicOverlayChanged: 'music:overlay-changed',
  musicOverlayControl: 'music:overlay-control',
  musicControl: 'music:control',
  sendMusicControl: 'music:control-send',
  getSocial: 'social:get-snapshot',
  searchSocialUsers: 'social:search-users',
  socialAction: 'social:action',
  getSocialProfile: 'social:get-profile',
  getOwnSocialProfile: 'social:get-own-profile',
  getChatConversations: 'social:chat-conversations',
  getChatMessages: 'social:chat-messages',
  sendChatMessage: 'social:chat-send',
  getSocialServers: 'social:get-servers',
  startSocialRealtime: 'social:realtime-start',
  stopSocialRealtime: 'social:realtime-stop',
  socialChanged: 'social:changed',
  notices: 'notifications:snapshot',
  noticeChanged: 'notifications:changed',
  noticeRead: 'notifications:read',
  noticeClear: 'notifications:clear',
  noticeSettings: 'notifications:settings',
  noticeLink: 'notifications:link',
  serverInvitation: 'servers:invitation',
  socialRealtimeState: 'social:realtime-state',
  supportConsentRequest: 'support:consent-request',
  supportConsentResponse: 'support:consent-response',
  remoteLaunchRequested: 'social:remote-launch',
  getAppInfo: 'app:get-info',
  discordPanel: 'discord:panel',
  launcherReady: 'app:launcher-ready',
  getUpdates: 'updates:snapshot',
  updateSettings: 'updates:settings',
  updateAction: 'updates:action',
  updateNotice: 'updates:notice',
  startupProgress: 'app:startup-progress',
  protocolAction: 'app:protocol-action',
  getVisualPreferences: 'preferences:get-visual',
  getSettings: 'settings:get',
  worldsDiagnostics: 'worlds:diagnostics',
  previewMinecraftWindow: 'settings:preview-minecraft-window',
  saveSettings: 'settings:save',
  visualPreferencesChanged: 'settings:visual-changed',
  getJvmArgs: 'settings:jvm-args-get',
  saveJvmArgs: 'settings:jvm-args-save',
  getManagedJava: 'settings:managed-java-get',
  installManagedJava: 'settings:managed-java-install',
  selectManagedJava: 'settings:managed-java-select',
  clearManagedJava: 'settings:managed-java-clear',
  managedJavaProgress: 'settings:managed-java-progress',
  selectJavaExecutable: 'settings:select-java',
  dataRootProgress: 'settings:data-root-progress',
  getBattlyDataRoot: 'settings:get-data-root',
  migrateBattlyDataRoot: 'settings:migrate-data-root',
  getDriveState: 'drive:state',
  disconnectDrive: 'drive:disconnect',
  openDriveFolder: 'drive:open-folder',
  openLocalBackups: 'drive:open-local-backups',
  driveProgress: 'drive:progress',
  syncGoogleDrive: 'settings:sync-google-drive',
  saveGoogleDriveCredentials: 'settings:save-google-drive-credentials',
  googleDriveAuthorization: 'drive:authorization',
  updateSocialProfile: 'settings:update-social-profile',
  selectSocialProfileBackground: 'settings:select-social-profile-background',
  removeSocialProfileBackground: 'settings:remove-social-profile-background',
  prepareErrorReport: 'diagnostics:prepare-error-report',
  submitErrorReport: 'diagnostics:submit-error-report',
  saveDiagnosticReport: 'diagnostics:save-report',
  getThemes: 'themes:list',
  getThemeMarketplace: 'themes:marketplace',
  saveTheme: 'themes:save',
  applyTheme: 'themes:apply',
  archiveTheme: 'themes:archive',
  installMarketplaceTheme: 'themes:install',
  shareTheme: 'themes:share',
  requestThemeReview: 'themes:request-review',
  getThemeReviewStatus: 'themes:review-status',
  unpublishTheme: 'themes:unpublish',
  openThemePage: 'themes:open-page',
  importTheme: 'themes:import',
  selectThemeBackground: 'themes:select-background',
  getThemeSounds: 'themes:sounds',
  selectThemeSound: 'themes:select-sound',
  themeApplied: 'themes:applied',
  minimizeWindow: 'window:minimize',
  toggleMaximizeWindow: 'window:toggle-maximize',
  closeWindow: 'window:close',
  openBattlyFolder: 'shell:open-battly-folder',
  openDiscord: 'shell:open-discord',
  openPasswordHelp: 'shell:open-password-help',
  openBattlyRegister: 'shell:open-battly-register',
  writeClipboardText: 'clipboard:write-text',
} as const;

export type MrpackImportEvent =
  | { readonly ok: true; readonly instance: InstanceSummary }
  | { readonly ok: false; readonly message: string };

export interface LaunchLogFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly version?: string;
  readonly instanceId?: string;
  readonly startedAt?: number;
}

export interface LaunchLogDocument extends LaunchLogFile {
  readonly content: string;
  readonly truncated: boolean;
}

export interface BattlyDesktopApi {
  migratePrivatePreferences(
    legacy: Readonly<Record<string, string>>,
  ): Promise<Record<string, string>>;
  setPrivatePreference(key: string, value: string | null): Promise<void>;
  trackAnalyticsPanel(panel: string): Promise<void>;
  onWorldsEvent(listener: (event: WorldsEvent) => void): () => void;
  getWorldsPublicRooms(page: number): Promise<WorldsPublicRoom[]>;
  worldsVoiceCommand(command: WorldsVoiceCommand): Promise<void>;
  worldsVoiceSignal(to: string, signal: Record<string, unknown>): Promise<void>;
  worldsVoiceActivity(speakers: readonly { userId: string; level: number }[]): Promise<void>;
  worldsVoiceState(status: WorldsVoiceStatus): Promise<void>;
  worldsVoiceParty(action: 'room' | 'join' | 'create', value?: string | string[]): Promise<void>;

  getWorldsSnapshot(): Promise<WorldsSnapshot>;
  openWorldsSource(): Promise<void>;
  openWorldsGamePanel(): Promise<void>;
  worldsAction(action: WorldsAction): Promise<WorldsSnapshot>;
  launcherReady(): Promise<void>;
  getUpdates(): Promise<UpdateSnapshot>;
  updateSettings(value: UpdateSettings): Promise<UpdateSnapshot>;
  updateAction(action: UpdateAction): Promise<UpdateSnapshot>;
  onUpdateNotice(listener: (action: 'open' | 'restart') => void): () => void;
  onStartupProgress(listener: (change: { progress: number; status: string }) => void): () => void;
  onProtocolAction(listener: (action: BattlyProtocolAction) => void): () => void;
  skinImageUrl(username: string): string;
  faceImageUrl(username: string): string;
  getAccounts(): Promise<AccountCollection>;
  getAccountSkinUrl(uuid: string): Promise<string | null>;
  selectAccount(uuid: string): Promise<AccountCollection>;
  removeAccount(uuid: string): Promise<AccountCollection>;
  removeAllAccounts(): Promise<AccountCollection>;
  startAuth(request: AuthRequest): Promise<AuthOutcome>;
  cancelAuth(): Promise<boolean>;
  getInstances(): Promise<readonly InstanceSummary[]>;
  createInstance(draft: InstanceDraft): Promise<readonly InstanceSummary[]>;
  updateInstance(id: string, draft: InstanceDraft): Promise<readonly InstanceSummary[]>;
  archiveInstance(id: string): Promise<readonly InstanceSummary[]>;
  openInstanceFolder(id: string): Promise<void>;
  exportBypack(id: string): Promise<BypackExportResult | null>;
  exportServerBypack(id: string): Promise<BypackExportResult | null>;
  revealBypack(path: string): Promise<void>;
  getMinecraftVersionList(): Promise<DownloadCatalogSnapshot['minecraft']>;
  getModDisableDependents(
    filename: string,
    instanceId?: string,
  ): Promise<readonly { filename: string; name: string }[]>;
  getModVersionCatalog(
    projectId: string,
  ): Promise<
    readonly { id: string; gameVersions: readonly string[]; loaders: readonly string[] }[]
  >;
  importBypack(source?: string | File): Promise<BypackPreview | null>;
  confirmBypack(token: string): Promise<InstanceSummary>;
  onBypackOpenRequested(listener: (path: string) => void): () => void;
  onBypackProgress(listener: (progress: ModpackInstallProgress) => void): () => void;
  getInstanceContent(
    id: string,
    kind: InstanceContentKind,
  ): Promise<readonly InstanceContentEntry[]>;
  importInstanceContent(
    id: string,
    kind: InstanceContentKind,
  ): Promise<readonly InstanceContentEntry[]>;
  actInstanceContent(
    id: string,
    kind: InstanceContentKind,
    name: string,
    action: InstanceContentAction,
  ): Promise<readonly InstanceContentEntry[]>;
  openInstanceContentFolder(
    id: string,
    kind: InstanceContentKind,
    archived?: boolean | 'backups',
  ): Promise<void>;
  getCustomClients(): Promise<readonly BattlyCustomClient[]>;
  getPlayVersions(): Promise<PlayVersionSnapshot>;
  getDownloadCatalog(): Promise<DownloadCatalogSnapshot>;
  getLoaderBuilds(
    loader: MinecraftLoaderKind,
    minecraftVersion: string,
  ): Promise<LoaderBuildSnapshot>;
  getLoaderGameVersions(loader: MinecraftLoaderKind): Promise<LoaderGameVersionSnapshot>;
  installPlayClient(id: string): Promise<void>;
  getBattlyClientBuilds(): Promise<readonly BattlyClientBuild[]>;
  installBattlyClient(id: string): Promise<{
    readonly customVersion: string;
    readonly minecraftVersion: string;
    readonly requiredJavaVersion: string;
  }>;
  getLabyModVersions(): Promise<readonly LabyModVersion[]>;
  installLabyMod(
    version: string,
  ): Promise<{ readonly customVersion: string; readonly minecraftVersion: string }>;
  startPlayVersion(request: PlayVersionLaunchRequest): Promise<MinecraftLaunchOutcome>;
  createPlayShortcut(request: PlayVersionLaunchRequest, label: string): Promise<string>;
  onDirectPlayRequested(listener: (request: PlayVersionLaunchRequest) => void): () => void;
  installCustomClient(id: string): Promise<readonly InstanceSummary[]>;
  startInstance(
    id: string,
    request?: MinecraftInstanceLaunchRequest,
  ): Promise<MinecraftLaunchOutcome>;
  cancelLaunch(): Promise<boolean>;
  openLaunchLogs(): Promise<void>;
  listLaunchLogs(): Promise<readonly LaunchLogFile[]>;
  readLaunchLog(id: string): Promise<LaunchLogDocument>;
  onLaunchEvent(listener: (event: MinecraftLaunchEvent) => void): () => void;
  onLabyUpdateChoice(listener: () => Promise<number>): () => void;
  onBattlyClientUpdateChoice(
    listener: (notice: BattlyClientUpdateNotice) => Promise<number>,
  ): () => void;
  onCrashRepairProgress(listener: (progress: MinecraftCrashRepairProgress) => void): () => void;
  onCrashReport(listener: (report: MinecraftCrashReport) => void): () => void;
  applyCrashRepair(reportId: string, repairId: string): Promise<MinecraftCrashRepairResult>;
  rollbackCrashRepair(repairId: string): Promise<MinecraftCrashRepairResult>;
  getHome(translateNews?: boolean): Promise<HomeSnapshot>;
  onHomeUpdated(listener: (snapshot: HomeSnapshot) => void): () => void;
  getNewsState(): Promise<{ readonly seen: boolean }>;
  completeNews(): Promise<{ readonly seen: true }>;
  getMyBattly(): Promise<MyBattlySnapshot>;
  archiveWorld(name: string): Promise<readonly MyBattlyWorld[]>;
  toggleResourcePack(name: string): Promise<readonly MyBattlyResourcePack[]>;
  archiveResourcePack(name: string): Promise<readonly MyBattlyResourcePack[]>;
  getWorldBackups(): Promise<readonly WorldBackupSummary[]>;
  restoreWorldBackup(id: string): Promise<string>;
  getBackupWorlds(): Promise<readonly { name: string; instanceId: string | null; label: string }[]>;
  createWorldBackup(worldName: string, instanceId?: string): Promise<readonly WorldBackupSummary[]>;
  archiveWorldBackup(id: string): Promise<readonly WorldBackupSummary[]>;
  getOnboarding(): Promise<OnboardingState>;
  selectInitialLanguage(language: InitialLanguage): Promise<OnboardingState>;
  completeWelcome(): Promise<OnboardingState>;
  getServers(): Promise<readonly ServerSummary[]>;
  getServerSoftwareAvailability(version: string): Promise<ServerSoftwareAvailability>;
  createServer(
    draft: ServerDraft,
    software?: ServerSoftwareKind,
  ): Promise<readonly ServerSummary[]>;
  updateServerProperties(
    id: string,
    properties: ServerProperties,
  ): Promise<readonly ServerSummary[]>;
  archiveServer(id: string): Promise<readonly ServerSummary[]>;
  getServerRuntime(id: string): Promise<ServerRuntimeSnapshot>;
  startServerRuntime(id: string): Promise<ServerRuntimeSnapshot>;
  stopServerRuntime(id: string): Promise<ServerRuntimeSnapshot>;
  restartServerRuntime(id: string): Promise<ServerRuntimeSnapshot>;
  sendServerCommand(id: string, command: string): Promise<void>;
  onServerRuntimeEvent(listener: (event: ServerRuntimeEvent) => void): () => void;
  installServer(
    id: string,
    software?: ServerSoftwareKind,
    acceptCompatiblePaper?: boolean,
  ): Promise<void>;
  onServerInstallProgress(listener: (progress: ServerInstallProgress) => void): () => void;
  getServerPlayerLists(id: string): Promise<ServerPlayerListsSnapshot>;
  mutateServerPlayerList(
    id: string,
    mutation: ServerPlayerListMutation,
  ): Promise<ServerPlayerListsSnapshot>;
  listServerFiles(id: string, path: string): Promise<readonly ServerFileEntry[]>;
  readServerFile(id: string, path: string): Promise<ServerFileContent>;
  writeServerFile(id: string, path: string, content: string): Promise<ServerFileContent>;
  exportServerFile(id: string, path: string): Promise<boolean>;
  revealServerFile(id: string, path: string): Promise<void>;
  archiveServerFile(id: string, path: string): Promise<void>;
  importServerWorld(id: string): Promise<boolean>;
  getServerContent(id: string, kind: ServerContentKind): Promise<readonly ServerContentEntry[]>;
  importServerContent(
    id: string,
    kind: ServerContentKind,
  ): Promise<readonly ServerContentEntry[] | null>;
  toggleServerContent(
    id: string,
    kind: ServerContentKind,
    name: string,
  ): Promise<readonly ServerContentEntry[]>;
  archiveServerContent(
    id: string,
    kind: ServerContentKind,
    name: string,
  ): Promise<readonly ServerContentEntry[]>;
  openServerContentFolder(id: string, kind: ServerContentKind): Promise<void>;
  getServerSharing(id: string): Promise<ServerSharingSnapshot>;
  startServerTunnel(id: string): Promise<ServerSharingSnapshot>;
  stopServerTunnel(id: string): Promise<ServerSharingSnapshot>;
  inviteServerFriend(id: string, draft: ServerInviteDraft): Promise<ServerSharingSnapshot>;
  revokeServerPermission(id: string, username: string): Promise<ServerSharingSnapshot>;
  getCapes(accountUuid?: string): Promise<CapeLibrarySnapshot>;
  uploadCape(accountUuid?: string): Promise<CapeActionResult | null>;
  setCape(id: string, accountUuid?: string): Promise<CapeActionResult>;
  deleteCape(id: string, accountUuid?: string): Promise<CapeActionResult>;
  removeCape(accountUuid?: string): Promise<CapeActionResult>;
  getSkins(accountUuid?: string): Promise<SkinLibrarySnapshot>;
  uploadSkin(accountUuid?: string): Promise<SkinActionResult | null>;
  setSkin(id: string, accountUuid?: string): Promise<SkinActionResult>;
  deleteSkin(id: string, accountUuid?: string): Promise<SkinActionResult>;
  installModBasket(request: ModBasketRequest): Promise<ModBasketResult>;
  onModBasketProgress(listener: (progress: ModBasketProgress) => void): () => void;
  searchMods(request: ModSearchRequest): Promise<ModSearchResult>;
  getModProjectDetails(request: ModInstallRequest): Promise<ModProjectDetail>;
  installMod(
    request: ModInstallRequest,
  ): Promise<{ readonly installed: readonly string[]; readonly instance?: InstanceSummary }>;
  openModrinthProject(id: string, projectType: ModProjectType): Promise<void>;
  getLocalMods(): Promise<readonly LocalModSummary[]>;
  toggleLocalMod(filename: string): Promise<readonly LocalModSummary[]>;
  batchLocalMods(
    action: 'enable' | 'disable' | 'archive',
    filenames: readonly string[],
  ): Promise<readonly string[]>;
  revealLocalMod(filename: string): Promise<void>;
  openLocalMod(filename: string): Promise<void>;
  archiveLocalMod(filename: string): Promise<readonly LocalModSummary[]>;
  openModsFolder(): Promise<boolean>;
  analyzeLocalMods(): Promise<LocalModCompatibilityReport>;
  disableIncompatibleMods(target?: LocalModTarget): Promise<LocalModCompatibilityFixResult>;
  importMrpack(): Promise<InstanceSummary | null>;
  importDroppedMrpack(file: File): Promise<InstanceSummary | null>;
  onMrpackImportEvent(listener: (event: MrpackImportEvent) => void): () => void;
  onModpackInstallProgress(listener: (progress: ModpackInstallProgress) => void): () => void;
  getMusic(): Promise<MusicSnapshot>;
  recordMusicPlay(id: string): Promise<void>;
  resolveMusicSource(
    id: string,
    quality?: MusicQuality,
    sourceUrl?: string | null,
    refresh?: boolean,
  ): Promise<string>;
  searchMusic(query: string): Promise<readonly MusicSong[]>;
  resolveMusicMetadata(ids: readonly string[]): Promise<readonly MusicSong[]>;
  rememberMusicDuration(id: string, durationSeconds: number): Promise<void>;
  getYouTubeMusicPlaylist(url: string): Promise<MusicPlaylistImport>;
  getSpotifyMusicPlaylist(url: string): Promise<MusicPlaylistImport>;
  onSpotifyMusicProgress(listener: (progress: number) => void): () => void;
  getMusicFavorites(): Promise<readonly MusicSong[]>;
  setMusicFavorite(favorite: MusicFavoriteDraft, enabled: boolean): Promise<readonly MusicSong[]>;
  createMusicPlaylist(draft: {
    readonly name: string;
    readonly description: string;
    readonly songs: readonly string[];
  }): Promise<MusicPlaylist>;
  updateMusicPlaylist(id: string, draft: MusicPlaylistUpdateDraft): Promise<MusicPlaylist>;
  updateMusicPlaylistSongs(id: string, songs: readonly string[]): Promise<MusicPlaylist>;
  deleteMusicPlaylist(id: string): Promise<void>;
  shareMusicPlaylist(id: string): Promise<MusicPlaylistShare>;
  importSharedMusicPlaylist(token: string): Promise<MusicPlaylist>;
  getMusicInvites(): Promise<readonly MusicCollaborationInvite[]>;
  respondMusicInvite(inviteId: string, action: 'accept' | 'reject'): Promise<void>;
  getMusicPlaylistCollaboration(id: string): Promise<MusicPlaylistCollaboration>;
  inviteMusicPlaylistCollaborator(id: string, username: string): Promise<void>;
  cancelMusicPlaylistInvite(id: string, inviteId: string): Promise<void>;
  removeMusicPlaylistCollaborator(id: string, collaboratorId: string): Promise<void>;
  getMusicPlaylistActivity(id: string): Promise<readonly MusicPlaylistActivity[]>;
  setMusicPlaybackState(state: MusicPlaybackState): Promise<void>;
  getMusicOverlay(): Promise<MusicOverlaySnapshot>;
  configureMusicOverlay(value: MusicOverlayPreferences): Promise<void>;
  musicOverlayCommand(value: MusicOverlayCommand): Promise<void>;
  onMusicOverlayChanged(listener: (value: MusicOverlaySnapshot) => void): () => void;
  onMusicOverlayControl(listener: (value: MusicOverlayCommand) => void): () => void;
  getMusicPlaybackState(): Promise<MusicPlaybackState>;
  sendMusicControl(action: MusicControlAction): Promise<void>;
  onMusicControl(listener: (action: MusicControlAction) => void): () => void;
  onMusicPlaybackChanged(listener: (state: MusicPlaybackState) => void): () => void;
  getSocial(): Promise<SocialSnapshot>;
  searchSocialUsers(query: string): Promise<readonly string[]>;
  socialAction(action: SocialAction, username: string): Promise<SocialSnapshot>;
  getSocialProfile(userId: string): Promise<SocialProfile>;
  getOwnSocialProfile(accountUuid?: string): Promise<SocialProfile>;
  getChatConversations(): Promise<readonly ChatConversation[]>;
  getChatMessages(conversationId: string): Promise<readonly ChatMessage[]>;
  sendChatMessage(recipientId: string, content: string): Promise<void>;
  getSocialServers(): Promise<readonly SocialServer[]>;
  startSocialRealtime(): Promise<void>;
  stopSocialRealtime(): Promise<void>;
  onSocialChanged(listener: () => void): () => void;
  getNotifications(): Promise<NoticeSnapshot>;
  onNotifications(listener: (state: NoticeSnapshot, openId?: string) => void): () => void;
  readNotification(id: string | null): Promise<NoticeSnapshot>;
  clearNotifications(): Promise<NoticeSnapshot>;
  setNotificationSettings(value: Partial<NoticeSettings>): Promise<NoticeSnapshot>;
  openNotificationLink(id: string, url: string): Promise<void>;
  onServerInvitation(listener: (invitation: ServerInvitation) => void): () => void;
  onSocialRealtimeState(listener: (state: SocialRealtimeState) => void): () => void;
  onSupportConsentRequest(
    listener: (request: { id: string; expiresAt: number }) => void,
  ): () => void;
  respondSupportConsent(id: string, accepted: boolean): Promise<void>;
  onRemoteLaunchRequested(listener: (request: RemoteLaunchRequest) => void): () => void;
  getAppInfo(): Promise<AppInfo>;
  updateDiscordPanel(panel: string): Promise<void>;
  getVisualPreferences(): Promise<VisualPreferences>;
  getSettings(): Promise<SettingsSnapshot>;
  saveSettings(draft: SettingsDraft): Promise<SettingsSnapshot>;
  onVisualPreferencesChanged(listener: (visual: VisualPreferences) => void): () => void;
  worldsDiagnostics(action: 'status' | 'test' | 'report' | 'reset-overlay'): Promise<string>;
  previewMinecraftWindow(size: {
    windowWidth: number;
    windowHeight: number;
    persist?: boolean;
  }): Promise<{ width: number; height: number } | null>;
  getJvmArgs(): Promise<JvmArgsConfig>;
  saveJvmArgs(config: JvmArgsConfig): Promise<JvmArgsConfig>;
  getManagedJava(): Promise<ManagedJavaSnapshot>;
  installManagedJava(
    major: ManagedJavaMajor,
    provider?: JavaRuntimeProvider,
  ): Promise<ManagedJavaSnapshot>;
  selectManagedJava(major: ManagedJavaMajor): Promise<ManagedJavaSnapshot>;
  clearManagedJava(): Promise<ManagedJavaSnapshot>;
  onManagedJavaProgress(listener: (progress: ManagedJavaInstallProgress) => void): () => void;
  selectJavaExecutable(): Promise<string | null>;
  onDataRootProgress(listener: (progress: DataRootProgress) => void): () => void;
  getBattlyDataRoot(): Promise<BattlyDataRootSnapshot>;
  migrateBattlyDataRoot(): Promise<BattlyDataRootSnapshot | null>;
  getDriveState(): Promise<DriveState>;
  disconnectDrive(): Promise<void>;
  openDriveFolder(): Promise<void>;
  openLocalBackups(): Promise<void>;
  onDriveProgress(
    listener: (
      message: string,
      automaticState?: 'progress' | 'complete' | 'error',
      detail?: ImportedDriveTransferProgress,
    ) => void,
  ): () => void;
  syncGoogleDrive(): Promise<{
    readonly success: boolean;
    readonly count: number;
    readonly reason?: string;
  }>;
  saveGoogleDriveCredentials(value: unknown): Promise<boolean>;
  onGoogleDriveAuthorization(listener: (credentials: unknown) => void): () => void;
  writeClipboardText(value: string): Promise<boolean>;
  updateSocialProfile(customization: ProfileCustomization, accountUuid?: string): Promise<void>;
  selectSocialProfileBackground(accountUuid?: string): Promise<ProfileBackgroundSelection | null>;
  removeSocialProfileBackground(accountUuid?: string): Promise<void>;
  prepareErrorReport(): Promise<string>;
  submitErrorReport(comment: string): Promise<void>;
  saveDiagnosticReport(): Promise<DiagnosticSaveOutcome>;
  getThemes(): Promise<ThemeLibrarySnapshot>;
  getThemeMarketplace(query: string, sort?: 'newest' | 'trending'): Promise<readonly BattlyTheme[]>;
  saveTheme(draft: ThemeDraft): Promise<ThemeLibrarySnapshot>;
  applyTheme(id: string): Promise<ThemeLibrarySnapshot>;
  archiveTheme(id: string): Promise<ThemeLibrarySnapshot>;
  installMarketplaceTheme(id: string): Promise<ThemeLibrarySnapshot>;
  shareTheme(id: string): Promise<ThemeShareResult>;
  requestThemeReview(id: string): Promise<ThemeLibrarySnapshot>;
  getThemeReviewStatus(id: string): Promise<ThemeReviewResult>;
  unpublishTheme(id: string): Promise<ThemeLibrarySnapshot>;
  openThemePage(id: string): Promise<boolean>;
  importTheme(value: {
    readonly code: string;
    readonly customName?: string;
  }): Promise<ThemeLibrarySnapshot>;
  selectThemeBackground(): Promise<string | null>;
  getThemeSounds(): Promise<ImportedThemeSoundLibrary>;
  selectThemeSound(): Promise<ImportedThemeSoundLibrary | null>;
  onThemeApplied(listener: (snapshot: ThemeLibrarySnapshot) => void): () => void;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  openBattlyFolder(): Promise<boolean>;
  openDiscord(): Promise<boolean>;
  openPasswordHelp(): Promise<boolean>;
  openBattlyRegister(): Promise<boolean>;
}
