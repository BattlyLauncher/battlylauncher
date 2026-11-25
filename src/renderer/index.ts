import { musicOverlayEnabled } from '../shared/music/music-features';
import { horizonArchive, horizonMinecraftVersion } from '../shared/minecraft/horizon';
import { bindMusicOverlayWindow } from './music/music-overlay-window';
import { filterInstanceLibrary } from './minecraft/instance-library-filters';
import { CoalescedRefresh } from '../shared/coalesced-refresh';
import { accentForeground } from './ui/accent-foreground';
import { DownloadPanelTransition } from './ui/download-panel-transition';
import { LoaderCatalogCache } from './minecraft/loader-catalog-cache';
import { duplicateModIssue } from './ui/duplicate-mod-issue';
import { emptyState, thinkingSteveImage } from './ui/empty-state';
import { bindFriendsDragScroll } from './ui/friends-drag-scroll';
import { modBasket } from './ui/mod-basket';
import {
  formatLoaderName,
  formatPlayVersion,
  comparePlayOptions,
} from '../shared/minecraft/play-version-presentation';
import { bindPlaySortPopover } from './ui/play-sort-popover';
import { renderLogLines } from './ui/log-lines';
import { minecraftNewsCard, translateMinecraftNews } from './ui/minecraft-news-article';
import { steveLoader } from './ui/steve-loader';
import { bindSystemMediaControls } from './music/system-media-controls';
import { MusicInviteRefresh } from './music/invite-refresh';
import { mountNotifications } from './ui/notifications';
import { prepareWorldsPlayRequest } from './social/worlds-launch';
import { mountSupportConsent } from './social/support-consent';
import { parseWorldsVersion } from '../shared/social/worlds-version';
import { formatPresenceServer, parseMinecraftPresence } from '../shared/social/presence-format';
import { showDataRootMigration } from './ui/data-root-migration';
import { LocalModControls } from './ui/local-mod-controls';
import {
  createCompatibilityReport,
  groupCompatibilityIssues,
} from '../shared/mods/compatibility-report';
import { privateStorage, initializePrivatePreferences } from './private-storage';
import { PlaySelectorCache } from './minecraft/play-selector-cache';
import { uiLocale } from './i18n/locale';
import { OgIntro, mountOgSetting, releaseStartupUi } from './ui/og-intro';
import { mountHistoryReplay, needsReleaseWelcome, ReleaseWelcome } from './ui/release-welcome';
import { showPatchNotes } from './ui/patch-notes';
import { resolveLauncherPanel } from '../shared/accounts/launcher-access';
import './styles/release-welcome.css';
import ogIntroUrl from './assets/videos/og/video_background.mp4?url';
import ogLoopUrl from './assets/videos/og/video_background_repeat.mp4?url';
import './styles/og-intro.css';

import {
  normalizeJavaRuntimeProvider,
  type JavaRuntimeProvider,
} from '../shared/settings/java-runtime-contract';
import {
  requires64BitMinecraft,
  minecraft32BitNotice,
  is32BitArchitecture,
} from '../shared/minecraft/platform-compatibility';
import {
  mountDisplaySettings,
  setDisplaySettings,
  readDisplaySettings,
} from './ui/display-settings';
import { mountWorldsSettings, setWorldsSettings, readWorldsSettings } from './ui/worlds-settings';
import { worldsShortcutConflict } from '../shared/social/worlds-shortcuts';
import { bindErrorReporter } from './ui/error-reporter';
import { mountProfileEditor } from './ui/profile-editor';
import { mountSettingsSubsections } from './ui/settings-subsections';
import { mountSettingsLogReader } from './ui/settings-log-reader';
import { MarketplaceMedia } from './ui/marketplace-media';
import { fitDownloadVersionLabels } from './ui/download-version-labels';
import { mountUpdates } from './ui/updates';
import { formatCount } from '../shared/format-count';
import { createSongMenu, toggleMusicSelection } from './music/song-menu';
import { createPlaylistMenu } from './music/playlist-menu';
import { toggleModWithDependents } from './ui/toggle-mod';
import { refreshRangeControls } from './ui/range-controls';
import { mountModVersionFilter } from './ui/mod-version-filter';
import { applyPremiumPresentation } from './ui/premium-presentation';
import { setLaunchBoostPreference } from './ui/launch-boost-presentation';
import { commitStartupFrame } from './ui/startup-frame';
import './styles/premium.css';
import { bindWorldsVoice } from './social/worlds-voice';
import { bindBattlyWorlds } from './social/battly-worlds-panel';
import Notify from 'simple-notify';
import 'simple-notify/dist/simple-notify.css';
import { userErrorMessage } from './ui/user-error';
import { authorizeGoogleDrive } from './ui/google-drive-auth';
import './styles/main.css';
import './styles/scrollbars.css';
import './styles/emoji.css';
import './styles/panels/onboarding.css';
import './styles/panels/servers.css';
import './legacy/assets/css/launcher.css';
import './legacy/assets/js/libs/normalize.min.css';
import './legacy/assets/js/libs/bulma.css';
import './legacy/assets/css/panels/skin_customizer.css';
import './styles/legacy-adapter.css';
import './styles/progress-modals.css';

import './styles/control-consistency.css';
import './styles/instance-library.css';
import './styles/theme-sharing.css';
import './styles/ui-refinements.css';
import './styles/play-panel.css';
import './styles/crash-report.css';
import './music/music-design.css';
import { bindActionTooltips } from './ui/action-tooltips';
import {
  appendPresentedChatMessage,
  renderChatEmpty,
  type ChatDeliveryState,
} from './social/chat-presentation';
import { mountChatSkinPreview } from './social/chat-skin-preview';

import legacyHomeMarkup from './legacy/panels/home.html?raw';
import legacyFriendsMarkup from './legacy/panels/friends.html?raw';
import legacyModsMarkup from './legacy/panels/mods.html?raw';
import legacyMusicMarkup from './legacy/panels/music.html?raw';
import legacySettingsMarkup from './legacy/panels/settings.html?raw';
import legacyLoginMarkup from './legacy/panels/login.html?raw';
import legacyWelcomeMarkup from './legacy/panels/welcome.html?raw';
import legacySelectLanguageMarkup from './legacy/panels/select-lang.html?raw';
import releaseNewsMarkup from './panels/news.html?raw';
import { bindReleaseNews } from './news/news-panel';
import { mountTesterCredits } from './news/tester-credits';

const testerFaces = import.meta.glob<string>('./assets/news/testers/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});
import './styles/panels/news.css';
import './styles/responsive.css';

import legacySpanishStrings from './legacy/assets/langs/strings.es.json';
import bundledEnglishStrings from './i18n/locales/en.json';
import bundledSpanishStrings from './i18n/locales/es.json';
import { UiTranslator, setUserText } from './i18n/ui-translator';
import {
  setUiText,
  plainLocaleText,
  translateUiText,
  catalogParagraphParts,
} from './i18n/dialog-text';
import battlyIconUrl from './assets/icon.png?url';
import defaultChatFaceUrl from './legacy/assets/images/default/setve.png?url';
import fabricInstanceBannerUrl from './assets/instance-banners/fabric.png?url';
import forgeInstanceBannerUrl from './assets/instance-banners/forge.png?url';
import neoforgeInstanceBannerUrl from './assets/instance-banners/neoforge.png?url';
import vanillaInstanceBannerUrl from './assets/instance-banners/vanilla.png?url';
import clickSoundUrl from './assets/click.mp3';
import { playAlertSound } from './ui/alert-sound';
import { renderAppTitle } from './ui/app-title';
import { bindModImageZoom } from './ui/mod-image-zoom';
import startSoundUrl from './assets/audio/start.mp3?url';
import start1SoundUrl from './assets/audio/start1.mp3?url';
import start2SoundUrl from './assets/audio/start2.mp3?url';
import start3SoundUrl from './assets/audio/start3.mp3?url';
import start4SoundUrl from './assets/audio/start4.mp3?url';
import start5SoundUrl from './assets/audio/start5.mp3?url';
import start6SoundUrl from './assets/audio/start6.mp3?url';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { mountMyBattlyPanel } from './panels/mybattly-panel';
import { openInstanceContent } from './panels/instance-content';
import { chooseInstanceExport, openInstanceCopy } from './panels/instance-actions';
import { openBypackImportFlow } from './panels/bypack-import';
import { mountOnboardingPanel } from './panels/onboarding-panel';
import { loadServersPanel, mountServersPanel } from './panels/servers-panel';
import { bindSkinCustomizer, setSkinCustomizerAccount } from './panels/skins-panel';
import { bindDetachedMusicWindow } from './music/detached-music-window';
import { mountHomeTutorial } from './home/home-tutorial';
import { mountGuidedTutorial, waitForTutorialElement } from './tutorial/guided-tutorial';
import { tutorialSession } from './tutorial/tutorial-session';
import { askBattly } from './ui/ask-modal';
import { chooseLabyUpdate, chooseBattlyClientUpdate } from './ui/laby-update-dialog';
import { showCrashRepairProgress } from './ui/crash-repair-progress';
import { formatCrashLog } from './crash-log-format';
import { Log4jLogDecoder } from '../shared/minecraft/log4j-log';
import { LanguageService, supportedLanguages, type LanguageStrings } from './i18n/language-service';

const startupVisualParameters = new URLSearchParams(window.location.search);
const startupColor = (name: string, fallback: string): string => {
  const value = startupVisualParameters.get(name) ?? '';
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value) ? value : fallback;
};
const startupOpacity = Number(startupVisualParameters.get('opacity'));
const startupRoot = document.documentElement;
startupRoot.style.setProperty('--blue', startupColor('theme', '#3e8ed0'));
startupRoot.style.setProperty('--theme-color', startupColor('theme', '#3e8ed0'));
startupRoot.style.setProperty(
  '--theme-on-accent',
  accentForeground(startupColor('theme', '#3e8ed0')),
);
startupRoot.style.setProperty(
  '--theme-on-accent-hover',
  accentForeground(startupColor('hover', '#2b74b0')),
);
startupRoot.style.setProperty('--button-hover', startupColor('hover', '#2b74b0'));
startupRoot.style.setProperty('--theme-color-hover', startupColor('hover', '#2b74b0'));
startupRoot.style.setProperty('--footer-color', startupColor('footer', '#0f1623'));
startupRoot.style.setProperty('--theme-color-bottom-bar', startupColor('footer', '#0f1623'));
startupRoot.style.setProperty('--loading-color', startupColor('loading', '#3e8ed0'));
startupRoot.style.setProperty('--friends-accent', startupColor('theme', '#3e8ed0'));
startupRoot.style.setProperty('--friends-accent-dark', startupColor('hover', '#2b74b0'));
if (Number.isFinite(startupOpacity) && startupOpacity >= 0 && startupOpacity <= 1) {
  startupRoot.style.setProperty('--footer-opacity', String(startupOpacity));
  startupRoot.style.setProperty('--theme-opacity-bottom-bar', String(startupOpacity));
}

function voidAsyncEvent<T extends Event>(handler: (event: T) => Promise<void>): (event: T) => void {
  return (event) => void handler(event);
}

type ToastStatus = 'error' | 'info' | 'success' | 'warning';

async function copyTextToClipboard(value: string): Promise<void> {
  try {
    await window.battly.writeClipboardText(value);
  } catch {
    await navigator.clipboard.writeText(value);
  }
}

let launcherNetworkOnline = navigator.onLine;
window.addEventListener('online', () => {
  launcherNetworkOnline = true;
});
window.addEventListener('offline', () => {
  launcherNetworkOnline = false;
});
function showToast(
  title: string,
  text = '',
  status: ToastStatus = 'info',
  timeout = 5_000,
): Notify | undefined {
  if (
    status === 'error' &&
    (!navigator.onLine || !launcherNetworkOnline) &&
    /BATTLY_OFFLINE(?!_)|ENETUNREACH|ENOTFOUND|ECONN|fetch failed|conexión|conectar|connection|network/i.test(
      text,
    )
  ) {
    return;
  }
  const safeText = document.createElement('span');
  safeText.textContent = status === 'error' ? userErrorMessage(text) : text;
  const notification = new Notify({
    status,
    title,
    text: safeText.innerHTML,
    effect: 'slide',
    speed: 300,
    showIcon: true,
    showCloseButton: false,
    autoclose: true,
    autotimeout: timeout,
    type: 'outline',
    position: 'top x-center',
  });
  const container = notification.container;
  const toastTitle = notification.wrapper.querySelector<HTMLElement>('.sn-notify-title');
  const toastText = notification.wrapper.querySelector<HTMLElement>('.sn-notify-text');
  if (toastTitle) {
    setUiText(toastTitle, title);
  }
  if (toastText) {
    setUiText(toastText, safeText.textContent ?? '');
  }
  container.setAttribute('popover', 'manual');
  notification.wrapper.setAttribute('role', status === 'error' ? 'alert' : 'status');
  try {
    if (container.matches(':popover-open')) {
      container.hidePopover();
    }
    container.showPopover();
  } catch {
    /* Fixed positioning remains available on older Chromium versions. */
  }
  playAlertSound();
  return notification;
}

class BattlyAlert {
  ShowAlert(
    info: {
      readonly autotimeout?: number;
      readonly icon?: string;
      readonly text?: string;
      readonly title?: string;
    } = {},
  ): Promise<void> {
    const status: ToastStatus =
      info.icon === 'success' || info.icon === 'error' || info.icon === 'warning'
        ? info.icon
        : 'info';
    showToast(info.title ?? '', info.text ?? '', status, info.autotimeout);
    return Promise.resolve();
  }
}

(globalThis as unknown as { Alert: typeof BattlyAlert }).Alert = BattlyAlert;
import {
  hasPlayableVersion,
  instanceLaunchLabel,
  launchHistoryStorageKey,
  parseRecentInstanceIds,
  recordRecentInstanceId,
} from './minecraft/launch-selection';
import {
  isInstallOnlyPhase,
  sampleTransfer,
  type TransferSampleState,
} from './minecraft/launch-telemetry';

import type { AccountCollection } from '../shared/accounts/account';
import type { AuthOutcome, AuthRequest } from '../shared/auth/auth-contract';
import type { InstanceDraft, InstanceSummary } from '../shared/minecraft/instance';
import { type MinecraftLaunchEvent } from '../shared/minecraft/launch-contract';
import type {
  MinecraftCrashIssue,
  MinecraftCrashReport,
  MinecraftCrashRepair,
} from '../shared/minecraft/crash-report-contract';
import type {
  InstalledPlayVersion,
  PlayRecentVersion,
  PlayVersionLaunchRequest,
  PlayVersionSnapshot,
} from '../shared/minecraft/play-version-contract';
import type { DownloadCatalogSnapshot } from '../shared/minecraft/download-catalog-contract';
import type { MinecraftLoaderKind } from '../shared/minecraft/loader-build-contract';
import type { HomeSnapshot } from '../shared/home/home-contract';
import type {
  LocalModCompatibilityIssue,
  LocalModInspection,
  LocalModCompatibilityReport,
  LocalModSummary,
  ModInstallRequest,
  ModProjectDetail,
  ModProjectSummary,
  ModProjectType,
  ModSearchRequest,
} from '../shared/mods/mod-contract';
import type { ModpackInstallProgress } from '../shared/mods/modpack-install-contract';
import { curseForgeProjectId } from '../shared/mods/mod-contract';
import { catalogImageUrl } from './ui/catalog-image';
import modrinthMark from './assets/modrinth-mark.svg';
import curseforgeMark from './assets/curseforge-mark.svg';
import { modpackInstallPercent } from '../shared/mods/modpack-install-contract';
import {
  buildGeneratedMusicCollections,
  type MusicPlaylist,
  type MusicPlaylistImport,
  type MusicQuality,
  type MusicSnapshot,
  type MusicSong,
} from '../shared/music/music-contract';
import type { SettingsSnapshot } from '../shared/settings/settings-contract';
import type { JvmArgsConfig } from '../shared/settings/jvm-args-contract';
import type {
  ManagedJavaInstallProgress,
  ManagedJavaMajor,
  ManagedJavaSnapshot,
} from '../shared/settings/java-runtime-contract';
import type {
  ChatConversation,
  ChatMessage,
  ProfileCustomization,
  SocialAction,
  SocialFriend,
  SocialProfile,
  SocialRealtimeState,
  SocialSnapshot,
} from '../shared/social/social-contract';
import { defaultProfileCustomization } from '../shared/social/social-contract';
import { SkinViewer, WalkingAnimation } from 'skinview3d';
import {
  defaultThemeDraft,
  normalizeThemeSound,
  type BattlyTheme,
  type ThemeDraft,
  type ThemeLibrarySnapshot,
  type ThemeReviewResult,
} from '../shared/themes/theme-contract';

const legacyImageUrls = import.meta.glob<string>('./legacy/assets/images/**/*', {
  eager: true,
  query: '?url',
  import: 'default',
});
const defaultMinecraftIconUrl = legacyImageUrls['./legacy/assets/images/icons/minecraft.png'] ?? '';
const optiFineIconUrl =
  legacyImageUrls['./legacy/assets/images/icons/optifine.png'] ?? defaultMinecraftIconUrl;

function resolveLegacyMarkupAssets(markup: string): string {
  return markup.replace(
    /(?:(?:\.\.\/|\.\/)?assets\/images\/)([^"')\s]+)/g,
    (source, relative: string) => {
      return legacyImageUrls[`./legacy/assets/images/${relative}`] ?? source;
    },
  );
}

const languageBundles = import.meta.glob<LanguageStrings>(
  ['./i18n/locales/*.json', '!./i18n/locales/es.json', '!./i18n/locales/en.json'],
  { import: 'default' },
);
const uiTranslator = new UiTranslator(bundledSpanishStrings);
function refreshLocalizedStyles(): void {
  document.documentElement.style.setProperty(
    '--music-added-label',
    JSON.stringify(translateUiText('Añadido por:') + ' '),
  );
  document.documentElement.style.setProperty(
    '--music-date-label',
    JSON.stringify(translateUiText('Fecha:') + ' '),
  );
}
let requestedLanguage = 'es';
let languageRequest = 0;
const languageService = new LanguageService({
  storage: privateStorage,
  bundledFallback: bundledEnglishStrings,
  bundledLanguages: {
    ...Object.fromEntries(
      supportedLanguages.map((code) => [code, languageBundles[`./i18n/locales/${code}.json`]]),
    ),
    es: () => Promise.resolve(bundledSpanishStrings),
    en: () => Promise.resolve(bundledEnglishStrings),
  },
  onUpdate: (language, strings) => {
    if (language !== requestedLanguage) {
      return;
    }
    activeLegacyStrings = strings;
    applyLegacyStrings(document);
    uiTranslator.setStrings(strings);
    refreshLocalizedStyles();
  },
});
window.addEventListener('focus', () => {
  void languageService.refresh(requestedLanguage);
});
let activeLegacyStrings: LanguageStrings = legacySpanishStrings;

function legacyString(path: string): string | undefined {
  for (const strings of [activeLegacyStrings, bundledSpanishStrings]) {
    let value: unknown = strings;
    for (const segment of path.split('.')) {
      if (!value || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = Object.getOwnPropertyDescriptor(value, segment)?.value;
    }
    if (typeof value === 'string') {
      return plainLocaleText(value);
    }
  }
  return undefined;
}

async function applyLanguage(language: string): Promise<void> {
  const request = ++languageRequest;
  requestedLanguage = supportedLanguages.includes(language as (typeof supportedLanguages)[number])
    ? language
    : 'es';
  const strings = await languageService.load(requestedLanguage);
  if (request !== languageRequest) {
    return;
  }
  activeLegacyStrings = strings;
  document.documentElement.lang = requestedLanguage;
  document.documentElement.dir = requestedLanguage === 'ar' ? 'rtl' : 'ltr';
  applyLegacyStrings(document);
  uiTranslator.setStrings(strings);
  refreshLocalizedStyles();
  window.dispatchEvent(new Event('battly:language-changed'));
  uiTranslator.start();
  void languageService.refresh(requestedLanguage);
}

function applyLegacyStrings(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-string-id]').forEach((element) => {
    if (element.closest('[data-i18n-dynamic], [translate="no"]')) {
      return;
    }
    const key = element.dataset.stringId;
    const value = key ? legacyString(key) : undefined;
    if (!value) {
      return;
    }
    const target = element.querySelector<HTMLElement>(':scope > [data-string-target]');
    if (target) {
      target.textContent = value;
      for (const node of [...element.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = '';
        }
      }
    } else if (element instanceof HTMLInputElement && element.hasAttribute('placeholder')) {
      element.placeholder = value;
    } else if (element.children.length) {
      const textNodes = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
      const firstText = textNodes[0];
      if (firstText) {
        firstText.textContent = `${value} `;
      } else {
        element.prepend(document.createTextNode(`${value} `));
      }
      for (const textNode of textNodes.slice(1)) {
        textNode.textContent = '';
      }
    } else {
      element.textContent = value;
    }
  });
  root.querySelectorAll<HTMLInputElement>('[data-string-id-placeholder]').forEach((element) => {
    const key = element.dataset.stringIdPlaceholder;
    const value = key ? legacyString(key) : undefined;
    if (value) {
      element.placeholder = value;
    }
  });
}

function legacyElement<T extends HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

function setLegacyBinding(root: ParentNode, selector: string, binding: string, value = ''): void {
  const element = legacyElement(root, selector);
  if (element) {
    element.setAttribute(binding, value);
  }
}

function removeLegacyInlineHandlers(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on')) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

function mountLegacyHomePanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-legacy-home]');
  if (!panel) {
    return;
  }
  panel.innerHTML = resolveLegacyMarkupAssets(
    legacyHomeMarkup.replace(
      'sandbox="allow-same-origin allow-scripts allow-popups allow-forms"',
      'sandbox=""',
    ),
  );
  panel.querySelectorAll('script').forEach((script) => script.remove());
  applyLegacyStrings(panel);
  const legacyBottomBar = panel.querySelector<HTMLElement>('.bottom_bar');
  legacyBottomBar?.classList.add('bottom-bar');
  if (legacyBottomBar) {
    const simpleModeExit = document.createElement('button');
    simpleModeExit.type = 'button';
    simpleModeExit.className = 'button is-info';
    simpleModeExit.dataset.simpleModeExit = '';
    simpleModeExit.hidden = true;
    simpleModeExit.innerHTML =
      '<span><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Salir modo simple</span>';
    legacyBottomBar.append(simpleModeExit);
  }
  const bindings: ReadonlyArray<readonly [string, string, string?]> = [
    ['.bottom_bar', 'data-bottom-bar'],
    ['#more-settings-btn', 'data-more-options'],
    ['.more-options', 'data-more-options-menu'],
    ['#mybattly-btn', 'data-panel', 'mybattly'],
    ['#settings-btn', 'data-panel', 'settings'],
    ['#btnShowNews', 'data-panel', 'news'],
    ['#openBattlyFolderButton', 'data-open-battly-folder'],
    ['#BotonUnirseServidorDiscord', 'data-open-discord'],
    ['#boton_abrir_mods', 'data-panel', 'mods'],
    ['#music-btn', 'data-panel', 'music'],
    ['#servers-btn', 'data-servers-options'],
    ['#instancias-btn', 'data-instances-open'],
    ['#download-btn', 'data-downloads-open'],
    ['#play-btn', 'data-play-open'],
    ['#friends-btn', 'data-panel', 'social'],
    ['.user-account-selector-container', 'data-account-selector'],
    ['#user-account-trigger', 'data-account-trigger'],
    ['#account-dropdown', 'data-account-dropdown'],
    ['#account-list', 'data-account-list'],
    ['#current-username', 'data-current-username'],
    ['#customize-skin-dropdown-btn', 'data-skin-open'],
    ['#battly-news-div', 'data-home-news-list'],
    ['#warning-status-message', 'data-home-warning'],
    ['#Battly_API_Desc .green', 'data-home-api-status'],
    ['#Battly_WEB_Desc .green', 'data-home-web-status'],
    ['#Miembros_Online', 'data-home-online-users'],
    ['.status-servers-playing-song', 'data-home-music-card'],
    ['.home-online-friends', 'data-home-friends'],
  ];
  bindings.forEach(([selector, binding, value]) =>
    setLegacyBinding(panel, selector, binding, value),
  );
  const friendsButton = panel.querySelector<HTMLButtonElement>('#friends-btn');
  if (friendsButton) {
    friendsButton.classList.add('home-friends-button');
    const badge = document.createElement('span');
    badge.className = 'badge-notification home-friends-notification';
    badge.dataset.homeRequestCount = '';
    badge.hidden = true;
    friendsButton.append(badge);
  }
  const homeMusicCard = panel.querySelector<HTMLElement>('[data-home-music-card]');
  if (homeMusicCard) {
    homeMusicCard.hidden = true;
    homeMusicCard
      .querySelectorAll('.status-servers-playing-song-title, .status-servers-playing-song-name')
      .forEach((element) => {
        element.removeAttribute('data-string-id');
        element.setAttribute('data-i18n-dynamic', '');
      });
  }
  panel
    .querySelectorAll<HTMLButtonElement>('.bottom_bar > button, .servers-dropdown > button')
    .forEach((button) => {
      button.classList.add('home-action-button');
      button.classList.add(button.id === 'play-btn' ? 'btn-primary' : 'btn-secondary');
    });
  const homeTooltips: ReadonlyArray<readonly [string, string]> = [
    [
      '#boton_abrir_mods',
      legacyString('tooltips.mods') ?? 'Descarga tus mods favoritos desde Battly',
    ],
    ['#music-btn', legacyString('tooltips.music') ?? 'Escucha tu música favorita cuando quieras'],
    ['#servers-btn', 'Gestiona tus servidores de Minecraft'],
    [
      '#instancias-btn',
      legacyString('tooltips.instances') ?? 'Separa tus mods y juega tus modpacks favoritos',
    ],
    ['#download-btn', legacyString('tooltips.download') ?? 'Descarga versiones de Minecraft'],
    ['#play-btn', legacyString('tooltips.play') ?? 'Juega las versiones descargadas'],
  ];
  for (const [selector, tooltip] of homeTooltips) {
    const button = legacyElement<HTMLButtonElement>(panel, selector);
    if (!button) {
      continue;
    }
    button.removeAttribute('title');
    button.setAttribute('aria-label', tooltip);
    button.removeAttribute('data-tooltip');
    let legacyTooltip = button.querySelector<HTMLElement>('.button-span, .play-button-span');
    if (!legacyTooltip) {
      legacyTooltip = document.createElement('span');
      legacyTooltip.className = button.id === 'play-btn' ? 'play-button-span' : 'button-span';
      button.append(legacyTooltip);
    }
    legacyTooltip.textContent = tooltip;
  }
  const moreButton = legacyElement(panel, '#more-settings-btn');
  moreButton?.setAttribute('aria-label', 'Más opciones');
  moreButton?.setAttribute('aria-expanded', 'false');
  const moreMenu = legacyElement(panel, '.more-options');
  if (moreMenu) {
    moreMenu.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      link.setAttribute('role', 'button');
      link.tabIndex = 0;
    });
    moreMenu.hidden = true;
  }
  const accountDropdown = legacyElement(panel, '#account-dropdown');
  if (accountDropdown) {
    accountDropdown.style.removeProperty('display');
    accountDropdown.hidden = true;
  }
  const homeAdvertisement = panel.querySelector<HTMLIFrameElement>('#ads');
  if (homeAdvertisement) {
    homeAdvertisement.src = 'about:blank';
    homeAdvertisement.setAttribute('sandbox', '');
  }
  legacyElement(panel, '#typeofnewsMain')?.classList.add('news-filter');
  legacyElement(panel, '#typeOfNews')?.setAttribute('aria-label', 'Tipo de noticias');
}

function mountLegacyFriendsPanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="social"]');
  if (!panel) {
    return;
  }
  panel.className = 'panel friends';
  panel.innerHTML = resolveLegacyMarkupAssets(legacyFriendsMarkup);
  panel.querySelectorAll('script').forEach((script) => script.remove());
  applyLegacyStrings(panel);

  const bindings: ReadonlyArray<readonly [string, string, string?]> = [
    ['#add-friends', 'data-social-add'],
    ['#add-friends-empty', 'data-social-add'],
    ['#solicitudes', 'data-social-requests'],
    ['#requests-badge', 'data-social-request-count'],
    ['#chat-btn', 'data-social-chat'],
    ['#friends-volver-btn', 'data-panel', 'home'],
    ['#friends-search-input', 'data-social-filter'],
    ['#lista-de-amigos', 'data-social-grid'],
    ['#friends-sort-select', 'data-social-sort'],
    ['#count-all', 'data-social-scope-count', 'all'],
    ['#count-online', 'data-social-scope-count', 'online'],
    ['#count-playing', 'data-social-scope-count', 'playing'],
    ['#count-offline', 'data-social-scope-count', 'offline'],
    ['#count-favorites', 'data-social-scope-count', 'favorites'],
  ];
  bindings.forEach(([selector, binding, value]) =>
    setLegacyBinding(panel, selector, binding, value),
  );
  panel.querySelectorAll<HTMLElement>('#friend-context-menu [data-action]').forEach((item) => {
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
  });
  panel.querySelectorAll<HTMLElement>('[data-filter]').forEach((button) => {
    const scope = button.dataset.filter;
    if (scope) {
      button.dataset.socialScope = scope;
    }
  });
  const status = document.createElement('span');
  status.hidden = true;
  status.dataset.socialStatus = '';
  status.setAttribute('role', 'status');
  panel.append(status);
}

function mountLegacyModsPanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="mods"]');
  if (!panel) {
    return;
  }
  panel.className = 'panel mods';
  panel.innerHTML = resolveLegacyMarkupAssets(legacyModsMarkup);
  panel.querySelectorAll('script').forEach((script) => script.remove());
  applyLegacyStrings(panel);

  const bindings: ReadonlyArray<readonly [string, string, string?]> = [
    ['#button_ver_mods', 'data-local-mods-open'],
    ['#button_instalar_modpack', 'data-mrpack-import'],
    ['#volver', 'data-panel', 'home'],
    ['#input_buscar_mods', 'data-mod-query'],
    ['#searchBtn', 'data-mod-search-submit'],
    ['#sort-select', 'data-mod-sort'],
    ['#loader-select', 'data-mod-loader'],
    ['#content-select', 'data-mod-project-type'],
    ['#results-count', 'data-mod-results-count'],
    ['#resetBtn', 'data-mod-reset'],
    ['#mod-grid', 'data-mod-grid'],
    ['#prevPage', 'data-mod-page', 'previous'],
    ['#pageInfo', 'data-mod-page-info'],
    ['#nextPage', 'data-mod-page', 'next'],
    ['#goToPageInput', 'data-mod-go-page-input'],
    ['#goToPageBtn', 'data-mod-go-page'],
  ];
  bindings.forEach(([selector, binding, value]) =>
    setLegacyBinding(panel, selector, binding, value),
  );
  panel.querySelectorAll<HTMLInputElement>('.b-mods-version-checkbox').forEach((checkbox) => {
    checkbox.dataset.modGameVersion = '';
  });
  legacyElement(panel, '#searchBtn')?.setAttribute('aria-label', 'Buscar');
  const status = document.createElement('span');
  status.hidden = true;
  status.dataset.modStatus = '';
  status.setAttribute('role', 'status');
  panel.append(status);
}

function mountLegacyMusicPanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="music"]');
  if (!panel) {
    return;
  }
  panel.className = 'panel music';
  panel.innerHTML = resolveLegacyMarkupAssets(legacyMusicMarkup);
  const brand = panel.querySelector<HTMLImageElement>('[data-music-brand-logo]');
  if (brand) {
    brand.src = battlyIconUrl;
  }
  const initialCover = panel.querySelector<HTMLImageElement>('#music-player-card-img');
  if (initialCover) {
    initialCover.src = battlyIconUrl;
  }
  const studio = panel.querySelector<HTMLElement>('.music-studio');
  const collapseToggle = panel.querySelector<HTMLButtonElement>('#music-player-collapse-toggle');
  const playerCollapsedKey = 'battly.music.player-collapsed';
  const setPlayerCollapsed = (collapsed: boolean): void => {
    if (studio) {
      studio.dataset.playerCollapsed = String(collapsed);
    }
    collapseToggle?.setAttribute('aria-expanded', String(!collapsed));
    collapseToggle?.setAttribute(
      'aria-label',
      collapsed ? 'Mostrar reproductor' : 'Plegar reproductor',
    );
    if (collapseToggle) {
      collapseToggle.title = collapsed ? 'Mostrar reproductor' : 'Plegar reproductor';
    }
    const icon = collapseToggle?.querySelector('i');
    if (icon) {
      icon.className = `fa-solid ${collapsed ? 'fa-expand' : 'fa-compress'}`;
    }
  };
  let playerCollapsed = false;
  try {
    playerCollapsed = privateStorage.getItem(playerCollapsedKey) === 'true';
  } catch {
    // El reproductor sigue disponible cuando el almacenamiento está deshabilitado.
  }
  setPlayerCollapsed(playerCollapsed);
  const searchInput = panel.querySelector<HTMLInputElement>('#top-search');
  if (searchInput) {
    searchInput.placeholder = 'Buscar canciones o artistas';
  }
  collapseToggle?.addEventListener('click', () => {
    playerCollapsed = !playerCollapsed;
    setPlayerCollapsed(playerCollapsed);
    try {
      privateStorage.setItem(playerCollapsedKey, String(playerCollapsed));
    } catch {
      // Mantener el cambio durante la sesión si no se puede guardar la preferencia.
    }
  });
  panel.querySelectorAll<HTMLElement>('[data-music-shortcut]').forEach((button) => {
    button.addEventListener('click', () => showLegacyMusicSection(button.dataset.musicShortcut!));
  });
  panel.querySelectorAll('script').forEach((script) => script.remove());
  applyLegacyStrings(panel);

  panel.querySelectorAll<HTMLElement>('[data-panel]').forEach((control) => {
    const section = control.dataset.panel;
    control.removeAttribute('data-panel');
    if (section) {
      control.dataset.musicSection = section;
      if (control.closest('.b-music-nav')) {
        control.setAttribute('role', 'button');
        control.tabIndex = 0;
      }
    }
  });
  const bindings: ReadonlyArray<readonly [string, string, string?]> = [
    ['[data-music-section="b-music-panel-inicio"]', 'data-music-featured'],
    ['[data-music-section="b-music-panel-biblioteca"]', 'data-music-favorites'],
    ['#b-music-show-playlists', 'data-music-playlists-open'],
    ['#b-music-invites-subnav', 'data-music-invites'],
    ['#b-music-collab-invites-badge', 'data-music-invites-count'],
    ['#b-music-collab-invites-list', 'data-music-invites-list'],
    ['#b-music-queue-panel-btn', 'data-music-queue-open'],
    ['#b-music-settings-btn', 'data-music-settings-open'],
    ['#b-music-import-playlists-btn', 'data-music-import'],
    ['#b-music-back-btn', 'data-panel', 'home'],
    ['#top-search', 'data-music-search-query'],
    ['#b-music-reproducir-btn', 'data-music-search-submit'],
    ['.b-music-panel-inicio h1', 'data-music-title'],
    ['.b-music-recent-row', 'data-music-tracks'],
    ['#library-liked-list', 'data-music-favorites-list'],
    ['.b-music-playlists-library-wrap .b-music-playlists-container', 'data-music-playlists'],
    ['.b-music-bottom_bar_music', 'data-music-mini'],
    ['.b-music-queue-list', 'data-music-queue'],
    ['#b-music-queue-panel-close', 'data-music-queue-close'],
    ['#music-player-card-img', 'data-music-mini-cover'],
    ['#no_song', 'data-music-mini-title'],
    ['#music-author', 'data-music-mini-artist'],
    ['#current-time', 'data-music-current-time'],
    ['#max-duration', 'data-music-duration'],
    ['#prev', 'data-music-previous'],
    ['#music-player-card-pause', 'data-music-play-pause'],
    ['#next', 'data-music-next'],
    ['#b-music-volumen', 'data-music-volume'],
    ['#music-panel-progress', 'data-music-progress'],
    ['.b-music-progress-bar', 'data-music-progress-bar'],
    ['#main-audio', 'data-music-audio'],
    ['#music-setting-quality', 'data-music-legacy-quality'],
    ['#music-setting-eq-enabled', 'data-music-legacy-eq-enabled'],
    ['#music-setting-eq-preset', 'data-music-legacy-eq-preset'],
    ['#music-setting-normalizer-enabled', 'data-music-legacy-normalization'],
    ['#music-setting-autoplay-similar', 'data-music-legacy-smart-playback'],
    ['#music-eq-reset-btn', 'data-music-legacy-eq-reset'],
    ['#b-music-save-playlist-btn', 'data-music-create'],
  ];
  bindings.forEach(([selector, binding, value]) =>
    setLegacyBinding(panel, selector, binding, value),
  );
  legacyElement(panel, '#b-music-import-playlists-btn')?.removeAttribute('data-music-section');
  legacyElement(panel, '#b-music-invites-subnav')?.classList.add('visible');
  const musicBack = legacyElement(panel, '#b-music-back-btn');
  musicBack?.setAttribute('role', 'button');
  if (musicBack) {
    musicBack.tabIndex = 0;
  }
  legacyElement(panel, '#music-setting-quality')?.setAttribute('aria-label', 'Calidad de audio');
  legacyElement(panel, '#music-setting-eq-enabled')?.setAttribute(
    'aria-label',
    'Activar ecualizador',
  );
  legacyElement(panel, '#music-setting-normalizer-enabled')?.setAttribute(
    'aria-label',
    'Normalización de volumen',
  );
  legacyElement(panel, '#music-setting-autoplay-similar')?.setAttribute(
    'aria-label',
    'Reproducir canciones similares',
  );
  legacyElement(panel, '#b-music-queue-panel-close')?.setAttribute('aria-label', 'Cerrar cola');
  const legacyProgress = legacyElement(panel, '#music-panel-progress');
  legacyProgress?.setAttribute('role', 'slider');
  legacyProgress?.setAttribute('aria-label', 'Posición de reproducción');
  legacyProgress?.setAttribute('aria-valuemin', '0');
  legacyProgress?.setAttribute('aria-valuemax', '100');
  const status =
    panel.querySelector<HTMLElement>('[data-music-status]') ?? document.createElement('span');
  status.hidden = false;
  status.dataset.musicStatus = '';
  status.setAttribute('role', 'status');
  if (!status.isConnected) {
    panel.append(status);
  }
  const cache =
    panel.querySelector<HTMLElement>('[data-music-cache]') ?? document.createElement('span');
  cache.hidden = false;
  cache.dataset.musicCache = '';
  if (!cache.isConnected) {
    panel.append(cache);
  }
}

function mountLegacySettingsPanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="settings"]');
  if (!panel) {
    return;
  }
  panel.className = 'panel settings';
  panel.innerHTML = resolveLegacyMarkupAssets(legacySettingsMarkup);
  mountUpdates(panel);
  mountSettingsSubsections(panel);
  mountProfileEditor(panel);
  panel.querySelectorAll('script').forEach((script) => script.remove());
  applyLegacyStrings(panel);
  const initialSettingsPanel = panel.querySelector<HTMLElement>('#b-settings-panel-cuentas');
  if (initialSettingsPanel) {
    initialSettingsPanel.style.display = 'block';
  }

  const editor = panel.querySelector<HTMLElement>('.pc2-editor-wrap');
  if (editor) {
    const form = document.createElement('form');
    form.className = editor.className;
    form.dataset.profileCustomizationForm = '';
    while (editor.firstChild) {
      form.append(editor.firstChild);
    }
    editor.replaceWith(form);
    const profileBindings: ReadonlyArray<readonly [string, string]> = [
      ['#border-color-picker', 'borderColor'],
      ['#border-style-select', 'borderStyle'],
      ['#border-width-slider', 'borderWidth'],
      ['#name-color-picker', 'nameColor'],
      ['#bg-color-picker', 'backgroundColor'],
    ];
    profileBindings.forEach(([selector, name]) => {
      const control = form.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (control) {
        control.name = name;
      }
    });
    const background = document.createElement('input');
    background.type = 'hidden';
    background.name = 'backgroundImage';
    background.dataset.profileBackgroundValue = '';
    const status = document.createElement('span');
    status.dataset.profileCustomizationStatus = '';
    status.setAttribute('role', 'status');
    form.append(background, status);
    form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.type = button.id === 'save-customization-btn' ? 'submit' : 'button';
    });
  }

  const bindings: ReadonlyArray<readonly [string, string, string?]> = [
    ['#b-settings-title', 'data-settings-heading'],
    ['#accounts', 'data-settings-account-list'],
    ['#accounts-btn', 'data-settings-tab', 'accounts'],
    ['#java-btn', 'data-settings-tab', 'java'],
    ['#ram-btn', 'data-settings-tab', 'ram'],
    ['#launcher-btn', 'data-settings-tab', 'launcher'],
    ['#theme-btn', 'data-settings-tab', 'appearance'],
    ['#b-settings-panel-cuentas', 'data-settings-view', 'accounts'],
    ['#b-settings-panel-java', 'data-settings-view', 'java'],
    ['#b-settings-panel-ram', 'data-settings-view', 'ram'],
    ['#b-settings-panel-launcher', 'data-settings-view', 'launcher'],
    ['#b-settings-panel-tema', 'data-settings-view', 'appearance'],
    ['#save-btn', 'data-settings-save'],
    ['#ruta-java-input', 'data-setting', 'javaPath'],
    ['#open-explorer-java-path', 'data-java-select'],
    ['#java-path-reset', 'data-java-automatic'],
    ['#b-java-list', 'data-managed-java-list'],
    ['#b-java-clear', 'data-managed-java-clear'],
    ['#b-java-progress', 'data-managed-java-progress'],
    ['#b-java-progress-text', 'data-managed-java-status'],
    ['#b-auto-ram-toggle', 'data-setting', 'autoRamEnabled'],
    ['#b-auto-ram-status', 'data-auto-ram-status'],
    ['#launcher-close', 'data-setting', 'hideLauncherOnGameStart'],
    ['#music-open', 'data-setting', 'showMusicOnGameStart'],
    ['#app-close-background', 'data-setting', 'closeToBackground'],
    ['#download-multiple-preset', 'data-setting', 'downloadConcurrency'],
    ['#launcher-simple-mode', 'data-setting', 'simpleMode'],
    ['#launchboost', 'data-setting', 'launchBoostEnabled'],
    ['#auto-sync-enabled', 'data-setting', 'autoSyncEnabled'],
    ['#privacy-presence-status-enabled', 'data-setting', 'presenceShareStatus'],
    ['#privacy-presence-server-enabled', 'data-setting', 'presenceShareServer'],
    ['#privacy-discord-status-enabled', 'data-setting', 'discordShareStatus'],
    ['#privacy-discord-server-enabled', 'data-setting', 'discordShareServer'],
    ['#battly-path-display', 'data-battly-data-root'],
    ['#change-battly-path-btn', 'data-battly-data-root-change'],
    ['#migration-status-text', 'data-battly-data-root-status'],
    ['#language-selector', 'data-setting', 'language'],
    ['#themeModeMy', 'data-theme-mode', 'library'],
    ['#themeModeMarketplace', 'data-theme-mode', 'marketplace'],
    ['#themeList', 'data-theme-list'],
    ['#themeMarketplacePanel', 'data-theme-marketplace'],
    ['#themeMarketplaceSearch', 'data-theme-marketplace-search-input'],
    ['#themeMarketplaceList', 'data-theme-marketplace-list'],
    ['#createBtn', 'data-theme-create'],
    ['#shareBtn', 'data-theme-import-open'],
    ['#b-settings-skin', 'data-skin-open'],
  ];
  bindings.forEach(([selector, binding, value]) =>
    setLegacyBinding(panel, selector, binding, value),
  );
  const languageSelect = panel.querySelector<HTMLSelectElement>('#language-selector');
  if (languageSelect) {
    const labels: Record<string, string> = {
      ar: 'العربية',
      de: 'Deutsch',
      en: 'English',
      es: 'Español',
      fr: 'Français',
      it: 'Italiano',
      ja: '日本語',
      pt: 'Português',
      ru: 'Русский',
      zh: '简体中文',
    };
    languageSelect.replaceChildren(
      ...supportedLanguages.map((language) => {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = labels[language];
        return option;
      }),
    );
  }
  panel.querySelector('#createBtn')?.parentElement?.setAttribute('data-theme-library-actions', '');

  setLegacyBinding(panel, '#add-account-btn', 'data-panel', 'login');
  const addAccount = panel.querySelector<HTMLElement>('#add-account-btn');
  if (addAccount) {
    addAccount.setAttribute('role', 'button');
    addAccount.setAttribute('aria-label', 'Añadir cuenta');
    addAccount.tabIndex = 0;
  }
  const soundRadios = panel.querySelectorAll<HTMLInputElement>('input[name="sound"]');
  soundRadios[0]?.setAttribute('data-setting', 'clickSounds');
  soundRadios[0]?.setAttribute('aria-label', 'Activar sonido de clic');
  soundRadios[1]?.setAttribute('aria-label', 'Desactivar sonido de clic');
  setLegacyBinding(panel, '#b-profile-customization-modal', 'data-profile-customization-modal');
  setLegacyBinding(panel, '#preview-card', 'data-profile-preview');
  setLegacyBinding(panel, '#preview-username', 'data-profile-preview-name');
  setLegacyBinding(panel, '#preview-avatar', 'data-profile-preview-skin');
  setLegacyBinding(panel, '#current-bg-preview', 'data-profile-preview-background');
  setLegacyBinding(panel, '#bg-image-label', 'data-profile-background-select');
  setLegacyBinding(panel, '#remove-bg-btn', 'data-profile-background-remove');
  panel.querySelectorAll<HTMLElement>('.preset-card[data-preset]').forEach((preset) => {
    preset.setAttribute('data-profile-preset', preset.dataset.preset ?? '');
    preset.tabIndex = 0;
    preset.setAttribute('role', 'button');
  });

  const hiddenControls = document.createElement('div');
  hiddenControls.hidden = true;
  hiddenControls.innerHTML = /* HTML */ ` <input
      data-setting="buttonColor"
      value="#3e8ed0"
    />
    <input
      data-setting="buttonHoverColor"
      value="#5fa3e0"
    />
    <input
      data-setting="footerColor"
      value="#171b22"
    />
    <input
      data-setting="footerOpacity"
      value="1"
    />
    <input
      data-setting="backgroundUrl"
      value=""
    />
    <input
      data-setting="ramMinGb"
      value="1"
    />
    <input
      data-setting="ramMaxGb"
      value="4"
    />
    <button
      type="button"
      data-accounts-remove-all
    ></button>
    <strong data-drive-connection></strong>
    <button
      type="button"
      data-drive-sync
    ></button>
    <span
      data-drive-status
      role="status"
    ></span>
    <button
      type="button"
      data-diagnostic-save
    ></button>
    <span
      data-diagnostic-status
      role="status"
    ></span>
    <span
      data-theme-status
      role="status"
    ></span>
    <span
      data-settings-status
      role="status"
    ></span>
    <span
      data-java-status
      role="status"
    ></span>`;
  panel.append(hiddenControls);
  const screenSettings = document.createElement('section');
  screenSettings.className = 'minecraft-window-settings';
  panel.querySelector('[data-settings-group="Pantalla"]')?.append(screenSettings);
  mountDisplaySettings(screenSettings);
  const generalSettings = panel.querySelector('[data-settings-group="General"]');
  const audioSettings = panel.querySelector('[data-settings-group="Audio"]');
  if (audioSettings) {
    const startupSound = document.createElement('label');
    startupSound.className = 'launcher-setting-row';
    startupSound.innerHTML =
      '<span>Reproducir sonido al iniciar Battly</span><input type="checkbox" data-setting="startupSoundEnabled">';
    audioSettings.append(startupSound);
  }
  if (generalSettings) {
    mountOgSetting(generalSettings);
    mountHistoryReplay(generalSettings);
  }
  const worldsSettings = panel.querySelector<HTMLElement>('[data-settings-group="Battly Worlds"]');
  if (worldsSettings) {
    mountWorldsSettings(worldsSettings);
  }
  const backupSettings = panel.querySelector('[data-settings-group="Mundos"]');
  if (backupSettings) {
    const preferences = document.createElement('div');
    preferences.className = 'launcher-backup-settings';
    preferences.innerHTML = /* HTML */ `
      <label class="launcher-setting-row"
        ><span>Incluir mundos generales</span
        ><input
          type="checkbox"
          data-setting="backupSharedWorlds"
      /></label>
      <label class="launcher-setting-row"
        ><span>Incluir mundos de instancias</span
        ><input
          type="checkbox"
          data-setting="backupInstances"
      /></label>
      <label class="launcher-setting-row"
        ><span>Intervalo mínimo entre copias (minutos)</span
        ><input
          type="number"
          min="0"
          max="1440"
          step="1"
          data-setting="backupIntervalMinutes"
      /></label>
      <p>0 para copiar cada vez que cierras Minecraft. Solo afecta a las copias automáticas.</p>
    `;
    backupSettings.append(preferences);
  }
}

function mountLegacyOnboardingPanels(): void {
  const language = document.querySelector<HTMLElement>('[data-panel-view="language"]');
  if (language) {
    language.className = 'panel';
    // The legacy fragment contains remote stylesheets that are already bundled
    // locally by the launcher. Strip them before parsing so Chromium never
    // attempts a CSP-blocked request during first-run mounting.
    const localLanguageMarkup = legacySelectLanguageMarkup.replace(
      /<link\b[^>]*\bhref=["']https:\/\/(?:cdn\.jsdelivr\.net|fonts\.googleapis\.com)[^>]*>/gi,
      '',
    );
    language.innerHTML = resolveLegacyMarkupAssets(localLanguageMarkup);
    language
      .querySelectorAll('script, link[rel="stylesheet"]')
      .forEach((element) => element.remove());
    document
      .querySelectorAll<HTMLLinkElement>(
        'link[href^="https://cdn.jsdelivr.net"], link[href^="https://fonts.googleapis.com"]',
      )
      .forEach((element) => element.remove());
    const video = language.querySelector<HTMLVideoElement>('#video');
    if (video) {
      video.dataset.languageVideo = '';
    }
    language
      .querySelectorAll<HTMLButtonElement>('.button-divs .button[value]')
      .forEach((button) => {
        button.dataset.initialLanguage = button.value;
        const flag = button.querySelector<HTMLImageElement>('img');
        if (flag && (button.value === 'es' || button.value === 'en')) {
          flag.dataset.languageFlag = button.value;
        }
      });
    const status = document.createElement('p');
    status.hidden = true;
    status.dataset.languageStatus = '';
    status.setAttribute('role', 'status');
    language.append(status);
  }

  const welcome = document.querySelector<HTMLElement>('[data-panel-view="welcome"]');
  if (welcome) {
    welcome.className = 'welcome-panel panel login-content';
    welcome.innerHTML = resolveLegacyMarkupAssets(legacyWelcomeMarkup);
    welcome.querySelectorAll('script').forEach((script) => script.remove());
    applyLegacyStrings(welcome);
    setLegacyBinding(welcome, '#bienvenido_1', 'data-welcome-step', 'intro');
    setLegacyBinding(welcome, '#bienvenido_2', 'data-welcome-step', 'account');
    setLegacyBinding(welcome, '#bienvenido_1_boton', 'data-welcome-next');
    setLegacyBinding(welcome, '#bienvenido_1 img', 'data-welcome-logo');
    setLegacyBinding(welcome, '#battly_login_btn', 'data-welcome-auth', 'battly');
    welcome.querySelector('#bienvenido_2 .mojang')?.remove();
    setLegacyBinding(welcome, '#bienvenido_2 .microsoft', 'data-welcome-auth', 'microsoft');
    welcome.querySelectorAll<HTMLElement>('.login-card .store').forEach((heading) => {
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '1');
    });
    const intro = welcome.querySelector<HTMLElement>('[data-welcome-step="intro"]');
    const account = welcome.querySelector<HTMLElement>('[data-welcome-step="account"]');
    if (intro) {
      intro.hidden = false;
    }
    if (account) {
      account.hidden = true;
    }
    for (const step of [intro, account]) {
      if (!step) {
        continue;
      }
      const status = document.createElement('p');
      status.hidden = true;
      status.dataset.welcomeStatus = '';
      status.setAttribute('role', 'status');
      step.append(status);
    }
  }

  const login = document.querySelector<HTMLElement>('[data-panel-view="login"]');
  if (login) {
    login.className = 'panel';
    login.innerHTML = resolveLegacyMarkupAssets(legacyLoginMarkup);
    login.querySelectorAll('script').forEach((script) => script.remove());
    applyLegacyStrings(login);
    const form = login.querySelector<HTMLFormElement>('#login-form');
    if (form) {
      form.dataset.loginForm = '';
    }
    const username = login.querySelector<HTMLInputElement>('#username_text');
    const password = login.querySelector<HTMLInputElement>('#password_text');
    if (username) {
      username.name = 'username';
      username.autocomplete = 'username';
      username.setAttribute('aria-label', 'Nombre de usuario');
    }
    if (password) {
      password.name = 'password';
      password.autocomplete = 'current-password';
      password.setAttribute('aria-label', 'Contraseña');
    }
    setLegacyBinding(login, '#cancelar-btn-login', 'data-login-back');
    setLegacyBinding(login, '#info-login', 'data-login-status');
    // Authentication feedback is shown by Battly's popup notification.
    const loginStatus = login.querySelector<HTMLElement>('[data-login-status]');
    if (form && loginStatus) {
      loginStatus.textContent = '';
      loginStatus.hidden = true;
    }
    setLegacyBinding(login, '#code-login-panel', 'data-legacy-two-factor');
    setLegacyBinding(login, '#code-text', 'data-legacy-two-factor-code');
    setLegacyBinding(login, '#code-login-text', 'data-legacy-two-factor-status');
    const legacyTwoFactor = login.querySelector<HTMLElement>('#code-login-panel');
    legacyTwoFactor?.setAttribute('role', 'dialog');
    legacyTwoFactor?.setAttribute('aria-label', 'Autenticación de varios factores');
    login
      .querySelector<HTMLInputElement>('#code-text')
      ?.setAttribute('aria-label', 'Código de autenticación de 6 dígitos');
    const verifyCode = login.querySelector<HTMLButtonElement>('#code-btn');
    const cancelCode = login.querySelector<HTMLButtonElement>('#cancel-code-btn');
    if (verifyCode) {
      verifyCode.textContent = 'Verificar';
    }
    if (cancelCode) {
      cancelCode.textContent = 'Cancelar';
    }
    setLegacyBinding(login, '#google-button', 'data-auth-method', 'battly-google');
    setLegacyBinding(login, '#microsoft-button', 'data-auth-method', 'microsoft');
    login.querySelectorAll<HTMLElement>('[data-auth-method]').forEach((method) => {
      method.setAttribute('role', 'button');
      method.tabIndex = 0;
    });
    const forgot = login.querySelector<HTMLAnchorElement>('.forgot-password');
    if (forgot) {
      forgot.dataset.passwordHelp = '';
      forgot.removeAttribute('href');
      forgot.setAttribute('role', 'link');
      forgot.tabIndex = 0;
    }
    const register = login.querySelector<HTMLAnchorElement>('.right-panel p a');
    if (register) {
      register.dataset.battlyRegister = '';
      register.removeAttribute('href');
      register.setAttribute('role', 'link');
      register.tabIndex = 0;
    }
    const cancel = document.createElement('button');
    cancel.hidden = true;
    cancel.type = 'button';
    cancel.dataset.authCancel = '';
    login.append(cancel);
  }
}

const panelNames: Record<string, string> = {
  home: 'Inicio',
  login: 'Inicio de sesión',
  mods: 'Battly Mods',
  music: 'Battly Music',
  settings: 'Ajustes',
  social: 'Amigos',
  mybattly: 'MyBattly',
  news: 'Novedades',
  servers: 'Battly Servers',
  chat: 'Battly Chat',
  language: 'Idioma',
  welcome: 'Bienvenida',
};

let rendererHasAccount = false;
function setActivePanel(panelId: string): void {
  panelId = resolveLauncherPanel(panelId, rendererHasAccount);
  document.body.dataset.panel = panelId;
  updateDiscordUiContext();
  document.querySelectorAll<HTMLElement>('[data-panel-view]').forEach((panel) => {
    const active = panel.dataset.panelView === panelId;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((button) => {
    const active = button.dataset.panel === panelId;
    button.classList.toggle('is-active', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
    } else {
      button.removeAttribute('aria-current');
    }
  });
  const bottomBar = document.querySelector<HTMLElement>('[data-backend-bottom-bar]');
  bottomBar?.querySelectorAll<HTMLButtonElement>(':scope > button').forEach((button) => {
    const directMatch = button.dataset.panel === panelId;
    const overflowMatch =
      button.hasAttribute('data-more-options') &&
      ['mybattly', 'settings', 'news'].includes(panelId);
    const active = directMatch || overflowMatch;
    button.classList.toggle('is-selected-panel', active);
    if (active) {
      button.setAttribute('aria-current', 'page');
    } else if (!button.dataset.panel) {
      button.removeAttribute('aria-current');
    }
  });
}

function updateDiscordUiContext(): void {
  const contexts: readonly [string, string][] = [
    ['[data-instances-dialog]', 'instances'],
    ['[data-download-dialog]', 'downloads'],
    ['[data-local-mods-dialog], [data-mod-detail-dialog]', 'mods'],
    [
      '[data-theme-editor-dialog], [data-theme-import-dialog], [data-theme-sound-dialog]',
      'settings',
    ],
    ['.minecraft-news-reader', 'news'],
  ];
  let panel = document.body.dataset.panel ?? 'home';
  for (const [selector, context] of contexts) {
    if (
      [...document.querySelectorAll<HTMLElement>(selector)].some((node) =>
        node instanceof HTMLDialogElement
          ? node.open
          : !node.hidden && getComputedStyle(node).display !== 'none',
      )
    ) {
      panel = context;
    }
  }
  void window.battly.updateDiscordPanel(panel).catch(() => undefined);
}

function notifyPanelEntered(target: HTMLElement, panelId: string): void {
  target.dispatchEvent(
    new CustomEvent('battly:panel-enter', {
      bubbles: false,
      detail: { panelId },
    }),
  );
}

async function activatePanel(panelId: string, animate = true): Promise<void> {
  panelId = resolveLauncherPanel(panelId, rendererHasAccount);
  const target = document.querySelector<HTMLElement>(`[data-panel-view="${panelId}"]`);
  if (!target) {
    return;
  }
  void window.battly.trackAnalyticsPanel(panelId).catch(() => undefined);
  const current = document.querySelector<HTMLElement>('[data-panel-view].is-active');
  if (current === target) {
    notifyPanelEntered(target, panelId);
    return;
  }
  const loader = document.querySelector<HTMLElement>('[data-panel-loader]');
  const loaderText = document.querySelector<HTMLElement>('[data-panel-loader-text]');
  const shouldAnimate = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!loader || !shouldAnimate) {
    setActivePanel(panelId);
    notifyPanelEntered(target, panelId);
    target.querySelector<HTMLElement>('h1, button, input, select')?.focus({ preventScroll: true });
    return;
  }

  if (panelId !== 'settings') {
    await restoreThemePreview();
  }
  loader.classList.remove('hide', 'inert');
  loader.hidden = false;
  loader.setAttribute('aria-busy', 'true');
  if (loaderText) {
    loaderText.textContent = `Cargando ${panelNames[panelId] ?? panelId}`;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  setActivePanel(panelId);
  notifyPanelEntered(target, panelId);
  loader.classList.add('hide');
  await new Promise<void>((resolve) => setTimeout(resolve, 820));
  loader.hidden = true;
  loader.classList.remove('hide');
  loader.classList.add('inert');
  loader.setAttribute('aria-busy', 'false');
  target.querySelector<HTMLElement>('h1, button, input, select')?.focus({ preventScroll: true });
}

function bindShellControls(): void {
  const serversButtons = document.querySelectorAll<HTMLButtonElement>('[data-servers-options]');
  const closeServersMenus = (): void => {
    serversButtons.forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
      const menu = button.parentElement?.querySelector<HTMLElement>('[data-servers-options-menu]');
      if (menu) {
        menu.hidden = true;
        menu.classList.remove('active');
      }
    });
  };
  serversButtons.forEach((button) => {
    const menu = button.parentElement?.querySelector<HTMLElement>('[data-servers-options-menu]');
    button.addEventListener('click', () => {
      if (!menu) {
        return;
      }
      const opening = menu.hidden === true;
      closeServersMenus();
      closeMoreMenu();
      menu.hidden = !opening;
      menu.classList.toggle('active', opening);
      button.setAttribute('aria-expanded', String(opening));
    });
    menu?.addEventListener('click', closeServersMenus);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target as Element).closest('.servers-dropdown')) {
      closeServersMenus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    const opened = [...serversButtons].find(
      (button) => button.getAttribute('aria-expanded') === 'true',
    );
    closeServersMenus();
    opened?.focus();
  });
  const moreButton = document.querySelector<HTMLButtonElement>('[data-more-options]');
  const moreMenu = document.querySelector<HTMLElement>('[data-more-options-menu]');
  const closeMoreMenu = (): void => {
    if (!moreButton || !moreMenu) {
      return;
    }
    moreMenu.hidden = true;
    moreMenu.classList.remove('active');
    moreButton.setAttribute('aria-expanded', 'false');
  };
  moreButton?.addEventListener('click', () => {
    closeServersMenus();
    if (!moreMenu) {
      return;
    }
    moreMenu.hidden = !moreMenu.hidden;
    moreMenu.classList.toggle('active', !moreMenu.hidden);
    moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden));
  });
  moreMenu?.addEventListener('click', closeMoreMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMoreMenu();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!moreMenu || moreMenu.hidden || moreMenu.contains(event.target as Node)) {
      return;
    }
    if (event.target !== moreButton && !moreButton?.contains(event.target as Node)) {
      closeMoreMenu();
    }
  });

  const musicToggle = document.querySelector<HTMLButtonElement>('[data-background-music-toggle]');
  const backgroundVideo = document.querySelector<HTMLVideoElement>('#video-background');
  musicToggle?.addEventListener('click', () => {
    const disabled = musicToggle.getAttribute('aria-pressed') !== 'true';
    musicToggle.setAttribute('aria-pressed', String(disabled));
    musicToggle.setAttribute(
      'aria-label',
      disabled ? 'Activar audio ambiental' : 'Desactivar audio ambiental',
    );
    musicToggle.textContent = disabled ? 'Activar música de fondo' : 'Desactivar música de fondo';
    if (backgroundVideo) {
      backgroundVideo.muted = disabled;
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-open-battly-folder]').forEach((button) => {
    button.addEventListener('click', () => {
      void window.battly.openBattlyFolder();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-open-discord]').forEach((button) => {
    button.addEventListener('click', () => {
      void window.battly.openDiscord();
    });
  });
}

function mountNewsPanel(): void {
  const mount = document.querySelector<HTMLElement>('[data-news-mount]');
  if (!mount) {
    return;
  }
  mount.className = 'news-panel panel';
  mount.innerHTML = releaseNewsMarkup;
  const logo = mount.querySelector<HTMLImageElement>('[data-news-logo]');
  const banner = mount.querySelector<HTMLImageElement>('[data-news-banner]');
  if (logo) {
    logo.src = battlyIconUrl;
  }
  if (banner) {
    banner.src = vanillaInstanceBannerUrl;
  }
  mountTesterCredits(mount, (username) => testerFaces[`./assets/news/testers/${username}.png`]);
}

function bindNewsPanel(): void {
  const panel = document.querySelector<HTMLElement>('[data-panel-view="news"]');
  if (!panel) {
    return;
  }
  bindReleaseNews(panel, async () => {
    await window.battly.completeNews();
    await activatePanel(rendererHasAccount ? 'home' : 'login');
  });
}

async function selectInitialPanel(): Promise<void> {
  try {
    const [accounts, news] = await Promise.all([
      window.battly.getAccounts(),
      window.battly.getNewsState().catch(() => ({ seen: false })),
    ]);
    renderAccountCollection(accounts);
    document.body.dataset.accounts = 'ready';
    if (!news.seen) {
      return activatePanel('news', false);
    }
    return activatePanel(rendererHasAccount ? 'home' : 'login', false);
  } catch {
    document.body.dataset.accounts = 'error';
    await activatePanel('login', false);
  }
}

function bindWindowControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-window-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.windowAction;
      if (action === 'minimize') {
        void window.battly.minimizeWindow();
      }
      if (action === 'maximize') {
        void window.battly.toggleMaximizeWindow();
      }
      if (action === 'close') {
        void window.battly.closeWindow();
      }
    });
  });
}

async function renderAppInfo(): Promise<void> {
  const title = document.querySelector<HTMLElement>('[data-app-info]');
  if (!title) {
    return;
  }
  try {
    const info = await window.battly.getAppInfo();
    title.dataset.version = info.version;
    renderAppTitle();
    void window.battly
      .getUpdates()
      .then((snapshot) => {
        title.dataset.build = String(snapshot.build);
        renderAppTitle();
      })
      .catch(() => undefined);
    launcherNetworkOnline = info.online ?? navigator.onLine;
    title.dataset.state = 'ready';
    title.setAttribute('aria-label', `${info.name} · ${info.version} · ${info.platform}`);
  } catch {
    title.dataset.state = 'error';
    title.setAttribute('aria-label', 'No se pudo leer la información de Battly');
  }
}

async function decodeImageWithTimeout(image: HTMLImageElement): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Background image timeout')), 5_000);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

window.battly.onVisualPreferencesChanged((visual) => {
  if (currentSettingsSnapshot) {
    currentSettingsSnapshot = { ...currentSettingsSnapshot, visual };
  }
  void applyVisualPreferences(visual, false).catch(() => {
    document.body.dataset.visualPreferences = 'fallback';
  });
});

async function renderVisualPreferences(): Promise<void> {
  try {
    const preferences = await window.battly.getVisualPreferences();
    await applyVisualPreferences(preferences, false);
    document.body.dataset.visualPreferences = 'ready';
  } catch {
    // The stylesheet already contains the original Battly defaults.
    document.body.dataset.visualPreferences = 'fallback';
  }
}

let visualBackgroundRevision = 0;
async function applyVisualPreferences(
  preferences: SettingsSnapshot['visual'],
  waitForBackground = true,
): Promise<void> {
  const revision = ++visualBackgroundRevision;
  const root = document.documentElement;
  root.style.setProperty('--blue', preferences.buttonColor);
  root.style.setProperty('--button-color', preferences.buttonColor);
  root.style.setProperty(
    '--button-hover',
    `color-mix(in srgb, ${preferences.buttonColor} 85%, black)`,
  );
  root.style.setProperty('--footer-color', preferences.footerColor);
  root.style.setProperty('--footer-opacity', String(preferences.footerOpacity));
  root.style.setProperty('--theme-color', preferences.buttonColor);
  root.style.setProperty('--theme-on-accent', accentForeground(preferences.buttonColor));
  root.style.setProperty(
    '--theme-on-accent-hover',
    accentForeground(preferences.buttonColor, 0.85),
  );
  root.style.setProperty(
    '--theme-color-hover',
    `color-mix(in srgb, ${preferences.buttonColor} 85%, black)`,
  );
  root.style.setProperty('--theme-color-bottom-bar', preferences.footerColor);
  root.style.setProperty('--theme-opacity-bottom-bar', String(preferences.footerOpacity));
  root.style.setProperty('--friends-accent', preferences.buttonColor);
  root.style.setProperty('--friends-accent-dark', preferences.buttonHoverColor);
  await applyLanguage(preferences.language);
  document.querySelector('#theme-background-video')?.remove();
  if (!preferences.backgroundUrl) {
    document.body.style.removeProperty('background-image');
    return;
  }
  if (/\.(mp4|webm)(?:[?#]|$)/i.test(preferences.backgroundUrl)) {
    const video = document.createElement('video');
    video.id = 'theme-background-video';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('No se pudo cargar el fondo animado.')),
        8000,
      );
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('No se pudo cargar el fondo animado.'));
        },
        { once: true },
      );
    })
      .then(async () => {
        if (revision !== visualBackgroundRevision) {
          video.removeAttribute('src');
          video.load();
          return;
        }
        document.body.prepend(video);
        document.body.style.removeProperty('background-image');
        await video.play();
      })
      .catch((error) => {
        video.removeAttribute('src');
        video.load();
        video.remove();
        throw error;
      });
    video.src = preferences.backgroundUrl;
    if (waitForBackground) {
      await loaded;
    } else {
      void loaded.catch(() => undefined);
    }
    return;
  }
  const background = new Image();
  background.src = preferences.backgroundUrl;
  const decoded = decodeImageWithTimeout(background).then(() => {
    if (revision === visualBackgroundRevision) {
      document.body.style.backgroundImage = `linear-gradient(#0004, #0004), url(${JSON.stringify(preferences.backgroundUrl)})`;
    }
  });
  if (waitForBackground) {
    await decoded;
  } else {
    void decoded.catch(() => undefined);
  }
}

function settingElement<T extends HTMLInputElement | HTMLSelectElement>(name: string): T | null {
  return document.querySelector<T>(`[data-setting="${name}"]`);
}

function setChecked(name: string, checked: boolean): void {
  const input = settingElement<HTMLInputElement>(name);
  if (input && name === 'launchBoostEnabled') {
    setLaunchBoostPreference(input, checked);
    return;
  }
  if (input) {
    input.checked = checked;
  }
}

function applySimpleMode(enabled: boolean): void {
  if (enabled) {
    document.body.dataset.simpleMode = 'true';
  } else {
    delete document.body.dataset.simpleMode;
  }
  const exit = document.querySelector<HTMLButtonElement>('[data-simple-mode-exit]');
  if (exit) {
    exit.hidden = !enabled;
  }
}

let currentSettingsSnapshot: SettingsSnapshot | null = null;
let ogIntro: OgIntro | undefined;
let clickSoundsEnabled = false;

function renderAutoRamStatus(snapshot: SettingsSnapshot, enabled: boolean): void {
  const status = document.querySelector<HTMLElement>('[data-auto-ram-status]');
  if (!status) {
    return;
  }
  const recommendation = snapshot.autoRamRecommendation;
  setUiText(
    status,
    enabled
      ? `Automático activo · Libre ${recommendation.freeGb}/${recommendation.totalGb} GB · Asignación ${recommendation.minimumGb}–${recommendation.maximumGb} GB (objetivo ${recommendation.targetPercent} %)`
      : `Recomendación actual: ${recommendation.minimumGb}–${recommendation.maximumGb} GB de ${recommendation.totalGb} GB instalados.`,
  );
}

function renderLegacyRamSlider(snapshot: SettingsSnapshot): void {
  const recommendation = snapshot.autoRamRecommendation;
  const total = document.querySelector<HTMLElement>('#total-ram');
  const free = document.querySelector<HTMLElement>('#free-ram');
  if (total) {
    total.textContent = `${recommendation.totalGb} GB`;
  }
  if (free) {
    free.textContent = `${recommendation.freeGb} GB`;
  }
  const slider = document.querySelector<HTMLElement>('.memory-slider');
  const left = slider?.querySelector<HTMLElement>('.slider-touch-left');
  const right = slider?.querySelector<HTMLElement>('.slider-touch-right');
  const range = slider?.querySelector<HTMLElement>('.slider-line span');
  if (!slider || !left || !right || !range) {
    return;
  }
  const minimum = 0.5;
  const maximum = Math.max(minimum, Math.floor(recommendation.totalGb));
  slider.dataset.minimum = String(minimum);
  slider.dataset.maximum = String(maximum);
  slider.setAttribute('min', String(minimum));
  slider.setAttribute('max', String(maximum));
  slider.setAttribute('step', '0.5');
  const width = slider.getBoundingClientRect().width || 540;
  const usable = Math.max(1, width - 36);
  const position = (value: number): number =>
    18 +
    ((Math.min(maximum, Math.max(minimum, value)) - minimum) / (maximum - minimum || 1)) * usable;
  const leftPosition = position(snapshot.runtime.ramMinGb);
  const rightPosition = position(snapshot.runtime.ramMaxGb);
  left.style.left = `${leftPosition}px`;
  right.style.left = `${rightPosition}px`;
  range.style.marginLeft = `${leftPosition}px`;
  range.style.width = `${Math.max(0, rightPosition - leftPosition)}px`;
  left.querySelector('span')?.setAttribute('value', `${snapshot.runtime.ramMinGb} GB`);
  right.querySelector('span')?.setAttribute('value', `${snapshot.runtime.ramMaxGb} GB`);
  slider.classList.toggle('is-ram-auto', snapshot.runtime.autoRamEnabled);
}

function renderLegacyLauncherControls(snapshot: SettingsSnapshot): void {
  const setRadio = (selector: string, checked: boolean): void => {
    const radio = document.querySelector<HTMLInputElement>(selector);
    if (radio) {
      radio.checked = checked;
    }
  };
  setRadio('#launcher-open', !snapshot.runtime.hideLauncherOnGameStart);
  setRadio('#music-close', !snapshot.runtime.showMusicOnGameStart);
  setRadio('#app-close-full', !snapshot.runtime.closeToBackground);
  const soundRadios = document.querySelectorAll<HTMLInputElement>('input[name="sound"]');
  if (soundRadios[1]) {
    soundRadios[1].checked = !snapshot.runtime.clickSounds;
  }
  const preset = document.querySelector<HTMLSelectElement>('#download-multiple-preset');
  const custom = document.querySelector<HTMLInputElement>('#download-multiple-custom');
  if (preset && custom) {
    const value = snapshot.runtime.downloadConcurrency;
    const presetValues = new Set([25, 50, 100, 250, 500]);
    preset.value = presetValues.has(value) ? String(value) : 'custom';
    custom.value = String(value);
    custom.style.display = preset.value === 'custom' ? '' : 'none';
  }
}

function renderSettings(snapshot: SettingsSnapshot): void {
  currentSettingsSnapshot = snapshot;
  clickSoundsEnabled = snapshot.runtime.clickSounds;
  queueMicrotask(refreshRangeControls);
  document.body.dataset.clickSounds = clickSoundsEnabled ? 'enabled' : 'disabled';
  const setValue = (name: string, value: string): void => {
    const input = settingElement<HTMLInputElement | HTMLSelectElement>(name);
    if (input) {
      input.value = value;
    }
  };
  setValue('buttonColor', snapshot.visual.buttonColor.slice(0, 7));
  setValue('buttonHoverColor', snapshot.visual.buttonHoverColor.slice(0, 7));
  setValue('footerColor', snapshot.visual.footerColor.slice(0, 7));
  setValue('footerOpacity', String(snapshot.visual.footerOpacity));
  setValue('backgroundUrl', snapshot.visual.backgroundUrl ?? '');
  setValue('language', snapshot.visual.language);
  setChecked('presenceShareStatus', snapshot.privacy.presenceShareStatus);
  setChecked('presenceShareServer', snapshot.privacy.presenceShareServer);
  setChecked('discordShareStatus', snapshot.privacy.discordShareStatus);
  setChecked('discordShareServer', snapshot.privacy.discordShareServer);
  setChecked('autoSyncEnabled', snapshot.autoSyncEnabled);
  const automaticDriveSync = settingElement<HTMLInputElement>('autoSyncEnabled');
  if (automaticDriveSync) {
    automaticDriveSync.disabled = !snapshot.googleDriveConnected;
  }
  setValue('javaPath', snapshot.runtime.javaPath);
  setValue('ramMinGb', String(snapshot.runtime.ramMinGb));
  setValue('ramMaxGb', String(snapshot.runtime.ramMaxGb));
  setDisplaySettings(snapshot.runtime);
  setWorldsSettings(snapshot.runtime.worlds);
  setValue('downloadConcurrency', String(snapshot.runtime.downloadConcurrency));
  setChecked('autoRamEnabled', snapshot.runtime.autoRamEnabled);
  setChecked('hideLauncherOnGameStart', snapshot.runtime.hideLauncherOnGameStart);
  setChecked('minimizeWhilePreparing', snapshot.runtime.minimizeWhilePreparing);
  setChecked('showMusicOnGameStart', snapshot.runtime.showMusicOnGameStart);
  setChecked('closeToBackground', snapshot.runtime.closeToBackground);
  setChecked('simpleMode', snapshot.runtime.simpleMode);
  applySimpleMode(snapshot.runtime.simpleMode);
  setChecked('clickSounds', snapshot.runtime.clickSounds);
  setChecked('startupSoundEnabled', snapshot.runtime.startupSoundEnabled);
  setChecked('backupSharedWorlds', snapshot.runtime.backupSharedWorlds);
  setChecked('backupInstances', snapshot.runtime.backupInstances);
  setValue('backupIntervalMinutes', String(snapshot.runtime.backupIntervalMinutes));
  setChecked('ogIntroEnabled', snapshot.runtime.ogIntroEnabled);
  if (!snapshot.runtime.ogIntroEnabled) {
    ogIntro?.stop();
    releaseStartupUi();
  }
  setChecked('launchBoostEnabled', snapshot.runtime.launchBoostEnabled);
  setRamInputsDisabled(snapshot.runtime.autoRamEnabled);
  renderAutoRamStatus(snapshot, snapshot.runtime.autoRamEnabled);
  renderLegacyRamSlider(snapshot);
  renderLegacyLauncherControls(snapshot);
  const drive = document.querySelector<HTMLElement>('[data-drive-connection]');
  if (drive) {
    drive.textContent = snapshot.googleDriveConnected
      ? 'Google Drive conectado'
      : 'Google Drive no está conectado';
  }
  const driveButton = document.querySelector<HTMLButtonElement>('[data-drive-sync]');
  if (driveButton) {
    driveButton.textContent = snapshot.googleDriveConnected
      ? 'Sincronizar ahora'
      : 'Conectar con Google Drive';
  }
  const presenceServer = settingElement<HTMLInputElement>('presenceShareServer');
  if (presenceServer) {
    presenceServer.disabled = !snapshot.privacy.presenceShareStatus;
  }
  const discordServer = settingElement<HTMLInputElement>('discordShareServer');
  if (discordServer) {
    discordServer.disabled = !snapshot.privacy.discordShareStatus;
  }
}

function bindClickSounds(): void {
  let lastPlayedAt = -Infinity;
  const play = (): void => {
    if (!clickSoundsEnabled) {
      return;
    }
    const now = performance.now();
    if (now - lastPlayedAt < 60) {
      return;
    }
    lastPlayedAt = now;
    const audio = new Audio(clickSoundUrl);
    audio.volume = 0.5;
    void audio.play().catch(() => undefined);
  };
  document.addEventListener('click', play, true);
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement) ||
      !input.matches('[data-setting="clickSounds"], input[name="sound"]')
    ) {
      return;
    }
    const wasEnabled = clickSoundsEnabled;
    clickSoundsEnabled = settingElement<HTMLInputElement>('clickSounds')?.checked ?? false;
    document.body.dataset.clickSounds = clickSoundsEnabled ? 'enabled' : 'disabled';
    if (clickSoundsEnabled && !wasEnabled) {
      play();
    }
  });
}

function settingsDraft() {
  const checked = (name: string): boolean =>
    settingElement<HTMLInputElement>(name)?.checked ?? false;
  const value = (name: string): string => settingElement(name)?.value ?? '';
  const downloadPreset = value('downloadConcurrency');
  const downloadConcurrency =
    downloadPreset === 'custom'
      ? Number(document.querySelector<HTMLInputElement>('#download-multiple-custom')?.value ?? 50)
      : Number(downloadPreset);
  return {
    visual: {
      buttonColor: value('buttonColor'),
      buttonHoverColor: value('buttonHoverColor'),
      footerColor: value('footerColor'),
      footerOpacity: Number(value('footerOpacity')),
      backgroundUrl: value('backgroundUrl') || null,
      language: value('language'),
    },
    privacy: {
      telemetryEnabled: true,
      analyticsLogsEnabled: true,
      presenceShareStatus: checked('presenceShareStatus'),
      presenceShareServer: checked('presenceShareServer'),
      discordShareStatus: checked('discordShareStatus'),
      discordShareServer: checked('discordShareServer'),
    },
    autoSyncEnabled: checked('autoSyncEnabled'),
    runtime: {
      javaPath: value('javaPath'),
      ramMinGb: Number(value('ramMinGb')),
      ramMaxGb: Number(value('ramMaxGb')),
      autoRamEnabled: checked('autoRamEnabled'),
      ...readDisplaySettings(),
      worlds: readWorldsSettings(),
      hideLauncherOnGameStart: checked('hideLauncherOnGameStart'),
      minimizeWhilePreparing: checked('minimizeWhilePreparing'),
      showMusicOnGameStart: checked('showMusicOnGameStart'),
      closeToBackground: checked('closeToBackground'),
      downloadConcurrency,
      simpleMode: checked('simpleMode'),
      clickSounds: checked('clickSounds'),
      startupSoundEnabled: checked('startupSoundEnabled'),
      ogIntroEnabled: checked('ogIntroEnabled'),
      launchBoostEnabled: checked('launchBoostEnabled'),
      backupSharedWorlds: checked('backupSharedWorlds'),
      backupInstances: checked('backupInstances'),
      backupIntervalMinutes: Number(value('backupIntervalMinutes')),
    },
  };
}

function setRamInputsDisabled(disabled: boolean): void {
  for (const name of ['ramMinGb', 'ramMaxGb']) {
    const control = settingElement<HTMLInputElement>(name);
    if (control) {
      control.disabled = disabled;
    }
  }
}

let pendingManagedJavaMajor: ManagedJavaMajor | null = null;

function openManagedJavaDialog(major: ManagedJavaMajor): void {
  const dialog = document.querySelector<HTMLElement>('#b-java-download-modal');
  const text = dialog?.querySelector<HTMLElement>('#b-java-modal-text');
  const progress = dialog?.querySelector<HTMLElement>('#b-java-progress-wrap');
  const warning = dialog?.querySelector<HTMLElement>('#b-java-warning');
  const bar = dialog?.querySelector<HTMLProgressElement>('#b-java-progress');
  const download = dialog?.querySelector<HTMLButtonElement>('#b-java-modal-download');
  pendingManagedJavaMajor = major;
  if (text) {
    text.removeAttribute('data-string-id');
    text.textContent = `Descargar Java ${major}. Elige el proveedor que quieres utilizar.`;
  }
  if (progress) {
    progress.style.display = 'none';
  }
  if (warning) {
    warning.style.display = 'none';
  }
  if (bar) {
    bar.value = 0;
  }
  if (download) {
    download.disabled = false;
  }
  const cancel = dialog?.querySelector<HTMLButtonElement>('#b-java-modal-cancel');
  if (cancel) {
    cancel.disabled = false;
  }
  showLegacyModal(dialog);
}

function installAndSelectManagedJava(
  major: ManagedJavaMajor,
  provider: JavaRuntimeProvider = 'mojang',
): Promise<ManagedJavaSnapshot> {
  return window.battly
    .installManagedJava(major, provider)
    .then(() => window.battly.selectManagedJava(major));
}

function renderManagedJava(snapshot: ManagedJavaSnapshot): void {
  const list = document.querySelector<HTMLElement>('[data-managed-java-list]');
  if (!list) {
    return;
  }
  list.replaceChildren();
  for (const runtime of snapshot.runtimes) {
    const card = document.createElement('div');
    card.className = 'managed-java-runtime';
    card.id = `b-java-item-${runtime.major}`;
    card.dataset.version = String(runtime.major);
    card.dataset.installed = String(runtime.installed);
    card.dataset.selected = String(runtime.selected);
    const information = document.createElement('div');
    information.className = 'b-java-left';
    const dot = document.createElement('span');
    dot.className = `b-java-dot ${runtime.installed ? 'b-ok' : 'b-missing'}`;
    const copy = document.createElement('div');
    copy.className = 'b-java-info';
    const title = document.createElement('strong');
    title.className = 'b-java-title';
    title.textContent = `Java ${runtime.major}`;
    const detail = document.createElement('span');
    detail.className = `b-java-status ${runtime.installed ? 'b-ok' : 'b-missing'}`;
    if (runtime.version) {
      const version = document.createElement('span');
      version.translate = false;
      version.textContent = `${runtime.version} · `;
      detail.append(version);
    }
    const installed = document.createElement('span');
    setUiText(installed, runtime.installed ? 'Instalado' : 'No instalado');
    detail.append(installed);
    copy.append(title, detail);
    information.append(dot, copy);
    const actions = document.createElement('div');
    actions.className = 'b-java-actions';
    const action = document.createElement('button');
    action.type = 'button';
    action.disabled = runtime.selected;
    action.setAttribute('aria-pressed', String(runtime.selected));
    action.className = `b-java-action ${runtime.installed ? 'b-use' : 'b-download'}`;
    setUiText(action, runtime.selected ? 'En uso' : runtime.installed ? 'Usar' : 'Descargar');
    actions.append(action);
    card.append(information, actions);
    action.addEventListener('click', () => {
      if (runtime.selected) {
        return;
      }
      const status = document.querySelector<HTMLElement>('[data-managed-java-status]');
      action.disabled = true;
      if (status) {
        status.textContent = runtime.installed
          ? `Seleccionando Java ${runtime.major}…`
          : `Preparando Java ${runtime.major}…`;
      }
      if (!runtime.installed) {
        action.disabled = false;
        openManagedJavaDialog(runtime.major);
        return;
      }
      const request = window.battly.selectManagedJava(runtime.major);
      void request
        .then((next) => {
          renderManagedJava(next);
          const selected = next.runtimes.find(({ selected }) => selected);
          if (selected?.path) {
            const input = settingElement<HTMLInputElement>('javaPath');
            if (input) {
              input.value = selected.path;
            }
          }
          if (status) {
            status.textContent = `Java ${runtime.major} instalado y seleccionado`;
          }
        })
        .catch((error: unknown) => {
          if (status) {
            status.textContent =
              error instanceof Error ? error.message : `No se pudo preparar Java ${runtime.major}`;
          }
          action.disabled = false;
        });
    });
    list.append(card);
    if (runtime.installed) {
      const providerButton = document.createElement('button');
      providerButton.type = 'button';
      providerButton.className = 'managed-java-provider';
      setUiText(providerButton, 'Proveedor');
      providerButton.addEventListener('click', () => openManagedJavaDialog(runtime.major));
      actions.append(providerButton);
    }
  }
}

function renderManagedJavaProgress(progress: ManagedJavaInstallProgress): void {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100))
      : 0;
  const text =
    progress.phase === 'complete'
      ? `Java ${progress.major} instalado correctamente`
      : progress.phase === 'extracting'
        ? `Extrayendo Java ${progress.major}…`
        : progress.phase === 'resolving'
          ? `Preparando Java ${progress.major}…`
          : `Descargando Java ${progress.major}… ${percent}%`;
  const status = document.querySelector<HTMLElement>('[data-managed-java-status]');
  if (status) {
    setUiText(status, text);
  }
  const dialog = document.querySelector<HTMLElement>('#b-java-download-modal');
  const bars = [document.querySelector<HTMLProgressElement>('[data-managed-java-progress]')];
  if (dialog?.classList.contains('is-active') && pendingManagedJavaMajor === progress.major) {
    const wrap = dialog.querySelector<HTMLElement>('#b-java-progress-wrap');
    if (wrap) {
      wrap.style.display = 'block';
    }
    const label = dialog.querySelector<HTMLElement>('#b-java-progress-text');
    if (label) {
      label.removeAttribute('data-string-id');
      setUiText(label, text);
    }
    bars.push(dialog.querySelector<HTMLProgressElement>('#b-java-progress'));
  }
  for (const bar of bars) {
    if (!bar) {
      continue;
    }
    bar.hidden = false;
    if (progress.phase === 'resolving' || progress.phase === 'extracting') {
      bar.removeAttribute('value');
    } else {
      bar.value = progress.phase === 'complete' ? 100 : percent;
    }
  }
}

function loadSettings(): void {
  const status = document.querySelector<HTMLElement>('[data-settings-status]');
  document.querySelector<HTMLButtonElement>('[data-settings-tab="accounts"]')?.click();
  if (status) {
    status.textContent = 'Cargando ajustes…';
  }
  void window.battly
    .getSettings()
    .then((snapshot) => {
      renderSettings(snapshot);
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudieron cargar los ajustes';
      }
    });
  void window.battly
    .getManagedJava()
    .then(renderManagedJava)
    .catch(() => {
      const status = document.querySelector<HTMLElement>('[data-managed-java-status]');
      if (status) {
        status.textContent = 'No se pudo leer el catálogo local de Java';
      }
    });
  void window.battly
    .getBattlyDataRoot()
    .then((snapshot) => {
      const input = document.querySelector<HTMLInputElement>('[data-battly-data-root]');
      const button = document.querySelector<HTMLButtonElement>('[data-battly-data-root-change]');
      const rootStatus = document.querySelector<HTMLElement>('[data-battly-data-root-status]');
      if (input) {
        input.value = snapshot.currentPath;
      }
      if (button) {
        button.disabled = !snapshot.configurable;
      }
      if (snapshot.recoveryPath && rootStatus) {
        setUiText(
          rootStatus,
          'Se recuperó la ubicación original después de un traslado interrumpido.',
        );
        rootStatus.append(
          document.createElement('br'),
          document.createTextNode(snapshot.recoveryPath),
        );
        rootStatus.parentElement!.style.display = 'block';
        return;
      }
      if (rootStatus) {
        rootStatus.textContent = snapshot.configurable
          ? 'Al migrar se conservará la ubicación anterior como copia de respaldo.'
          : 'La ruta está fijada por la configuración de este entorno.';
      }
    })
    .catch(() => undefined);
}

let currentThemeLibrary: ThemeLibrarySnapshot = { activeThemeId: null, themes: [] };
let marketplaceThemes: readonly BattlyTheme[] = [];
let marketplaceRequestRevision = 0;
let marketplaceVisibleCount = 24;
let marketplacePremium = false;
const marketplaceMedia = new MarketplaceMedia();
const libraryThemeMedia = new MarketplaceMedia();
const marketplacePending = new Map<string, Promise<readonly BattlyTheme[]>>();
let marketplaceSearchTimer: ReturnType<typeof setTimeout> | null = null;
let marketplacePreviewThemeId: string | null = null;
let marketplacePreviewOriginal: SettingsSnapshot['visual'] | null = null;

function themeStatus(message: string): void {
  const status = document.querySelector<HTMLElement>('[data-theme-status]');
  if (status) {
    status.textContent = message;
  }
  const marketStatus = document.querySelector<HTMLElement>('[data-market-status]');
  if (marketStatus) {
    setUiText(marketStatus, message);
  }
}

function themeButton(label: string, action: string, id: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'small-action';
  button.textContent = label;
  button.dataset.themeAction = action;
  button.dataset.themeId = id;
  return button;
}

function themeActionIcon(
  icon: string,
  label: string,
  action: string,
  id: string,
  extraClass = '',
): HTMLElement {
  const element = document.createElement('i');
  element.className = `fa-solid ${icon} ${extraClass}`.trim();
  element.dataset.themeAction = action;
  element.dataset.themeId = id;
  element.setAttribute('aria-label', label);
  element.setAttribute('role', 'button');
  element.tabIndex = 0;
  element.title = label;
  return element;
}

function renderThemeCards(items: readonly BattlyTheme[], marketplace: boolean): void {
  const list = document.querySelector<HTMLElement>(
    marketplace ? '[data-theme-marketplace-list]' : '[data-theme-list]',
  );
  if (!list) {
    return;
  }
  if (marketplace) {
    marketplaceMedia.reset(list.closest<HTMLElement>('[data-theme-marketplace]') ?? list);
  } else {
    libraryThemeMedia.reset(list);
  }
  list.replaceChildren();
  const more = document.querySelector<HTMLButtonElement>('[data-market-more]');
  if (marketplace && more) {
    more.hidden = items.length <= marketplaceVisibleCount;
  }
  if (!items.length) {
    if (!marketplace) {
      return;
    }
    list.append(emptyState('No se encontraron temas en el marketplace.'));
    return;
  }
  for (const theme of marketplace ? items.slice(0, marketplaceVisibleCount) : items) {
    const card = document.createElement('div');
    card.dataset.themeId = theme.id;
    if (marketplace) {
      card.className = `market-theme-card${theme.visual.backgroundUrl ? ' has-bg' : ''}`;
      card.style.setProperty('--market-btn', theme.visual.buttonColor);
      card.style.setProperty('--market-loading', theme.loadingColor);
      card.style.setProperty('--market-footer', theme.visual.footerColor);
      const cover = document.createElement('div');
      cover.className = 'market-theme-cover';
      const animated = /\.(gif|webp|mp4|webm)(?:[?#]|$)/i.test(theme.visual.backgroundUrl ?? '');
      if (theme.visual.backgroundUrl && !animated) {
        const image = document.createElement('img');
        image.loading = 'lazy';
        image.decoding = 'async';
        image.alt = '';
        image.src = theme.visual.backgroundUrl;
        image.addEventListener('error', () => image.remove(), { once: true });
        cover.append(image);
      }
      if (animated) {
        marketplaceMedia.add(cover, theme.visual.backgroundUrl!, marketplacePremium, true);
        const badge = document.createElement('span');
        badge.className = 'market-theme-badge';
        badge.textContent = 'Animados · Battly+';
        cover.append(badge);
      }
      const header = document.createElement('div');
      header.style.cssText =
        'display:flex;justify-content:space-between;gap:12px;align-items:flex-start';
      const information = document.createElement('div');
      information.style.cssText = 'flex:1;min-width:0';
      const title = document.createElement('span');
      title.className = 'market-theme-title';
      title.title = theme.name;
      setUserText(title, theme.name);
      const meta = document.createElement('div');
      meta.className = 'market-theme-meta';
      setUiText(meta, theme.ownerName ? `Por @${theme.ownerName}` : 'Desconocido');
      const stats = document.createElement('div');
      stats.className = 'market-theme-stats';
      stats.innerHTML = /* HTML */ `<span
          ><i class="fa-solid fa-download"></i>${formatCount(theme.downloads)}</span
        ><span><i class="fa-solid fa-heart"></i>${formatCount(theme.likes)}</span
        ><span><i class="fa-solid fa-comment"></i>${formatCount(theme.comments)}</span>`;
      information.append(title, meta, stats);
      header.append(information);
      const footer = document.createElement('div');
      footer.className = 'market-theme-actions';
      const palette = document.createElement('div');
      palette.className = 'market-theme-palette';
      for (const color of [theme.visual.buttonColor, theme.visual.footerColor]) {
        const dot = document.createElement('span');
        dot.className = 'market-theme-dot';
        dot.style.background = color;
        palette.append(dot);
      }
      const install = themeButton('Instalar', 'install', theme.id);
      install.className = 'button is-small is-info market-install-btn btn-dont-change notchange';
      install.innerHTML = '<i class="fa-solid fa-download"></i><span>Instalar</span>';
      const previewing = marketplacePreviewThemeId === theme.id;
      const preview = themeButton(previewing ? 'Restaurar' : 'Vista previa', 'preview', theme.id);
      preview.className = 'button is-small is-info is-outlined market-preview-btn notchange';
      preview.innerHTML = previewing
        ? '<i class="fa-solid fa-rotate-left"></i><span>Restaurar</span>'
        : '<i class="fa-solid fa-eye"></i><span>Vista previa</span>';
      footer.append(palette, preview, install);
      card.append(cover, header, footer);
      list.append(card);
      continue;
    }

    card.className = `theme-card${currentThemeLibrary.activeThemeId === theme.id ? ' active' : ''}`;
    card.dataset.themeAction = 'apply';
    card.setAttribute('aria-label', `Aplicar ${theme.name}`);
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.style.setProperty('--btn-color', theme.visual.buttonColor);
    card.style.setProperty('--footer-color', theme.visual.footerColor);
    card.style.setProperty('--loading-color', theme.loadingColor);
    if (theme.visual.backgroundUrl) {
      card.dataset.hasBg = 'true';
      if (/\.(gif|webp|mp4|webm)(?:[?#]|$)/i.test(theme.visual.backgroundUrl)) {
        card.dataset.stillCover = '';
        const cover = document.createElement('div');
        cover.className = 'library-theme-cover';
        libraryThemeMedia.add(cover, theme.visual.backgroundUrl, false);
        card.append(cover);
      } else {
        card.style.setProperty('--thumb', `url("${theme.visual.backgroundUrl}")`);
      }
    }
    const title = document.createElement('span');
    title.className = 'theme-card-title';
    title.textContent = `${theme.name}${theme.isDefault ? ' (Sistema)' : ''}`;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    if (theme.isDefault) {
      const system = document.createElement('i');
      system.className = 'fa-solid fa-shield-halved';
      system.style.color = '#28a745';
      system.title = 'Tema del sistema';
      actions.append(system);
    } else {
      actions.append(
        themeActionIcon('fa-pen-to-square', 'Editar', 'edit', theme.id, 'edit'),
        themeActionIcon('fa-trash', 'Eliminar', 'archive', theme.id, 'delete'),
        themeActionIcon('fa-share', 'Compartir', 'share', theme.id, 'share-theme'),
      );
      const reviewLabel = theme.isPublic
        ? 'Publicado'
        : theme.reviewStatus === 'pending' || theme.reviewStatus === 'requested'
          ? 'En revisión'
          : theme.reviewStatus === 'rejected'
            ? 'Rechazado'
            : 'Enviar a revisión';
      actions.append(
        themeActionIcon(
          theme.isPublic
            ? 'fa-eye'
            : theme.reviewStatus === 'pending' || theme.reviewStatus === 'requested'
              ? 'fa-circle-info'
              : theme.reviewStatus === 'rejected'
                ? 'fa-triangle-exclamation'
                : 'fa-paper-plane',
          reviewLabel,
          'review',
          theme.id,
          'publish',
        ),
      );
    }
    card.append(title, actions);
    list.append(card);
  }
}

async function restoreThemePreview(): Promise<void> {
  document.querySelector('[data-market-dialog]')?.classList.remove('is-previewing');
  document.body.classList.remove('theme-market-preview');
  if (!marketplacePreviewOriginal) {
    return;
  }
  const original = marketplacePreviewOriginal;
  marketplacePreviewOriginal = null;
  marketplacePreviewThemeId = null;
  await applyVisualPreferences(original);
  document.querySelector('.battly-market-filters')?.dispatchEvent(new Event('filters-redraw'));
  themeStatus('Vista previa cerrada. Se ha restaurado tu tema original.');
}

async function previewMarketplaceTheme(theme: BattlyTheme): Promise<void> {
  if (!(await window.battly.getThemeSounds()).premium) {
    theme = {
      ...theme,
      startupVolume: 0,
      visual: {
        ...theme.visual,
        backgroundUrl: /\.(png|jpe?g)$/i.test(theme.visual.backgroundUrl ?? '')
          ? theme.visual.backgroundUrl
          : null,
      },
    };
  }
  if (marketplacePreviewThemeId === theme.id) {
    await restoreThemePreview();
    return;
  }
  marketplacePreviewOriginal ??= await window.battly.getVisualPreferences();
  marketplacePreviewThemeId = theme.id;
  await applyVisualPreferences({
    ...theme.visual,
    language: marketplacePreviewOriginal.language,
  });
  document.querySelector('[data-market-dialog]')?.classList.add('is-previewing');
  document.body.classList.add('theme-market-preview');
  const previewName = document.querySelector<HTMLElement>('[data-market-preview-name]');
  if (previewName) {
    setUserText(previewName, theme.name);
  }
  document.querySelector('.battly-market-filters')?.dispatchEvent(new Event('filters-redraw'));
  themeStatus(`Vista previa de ${theme.name}. No se guardará en tu cuenta.`);
  marketplaceMedia.stop();
}

async function reflectActiveTheme(snapshot: ThemeLibrarySnapshot): Promise<void> {
  const theme = snapshot.themes.find((candidate) => candidate.id === snapshot.activeThemeId);
  if (!theme) {
    return;
  }
  const setValue = (name: string, value: string): void => {
    const input = settingElement<HTMLInputElement>(name);
    if (input) {
      input.value = value;
    }
  };
  setValue('buttonColor', theme.visual.buttonColor.slice(0, 7));
  setValue('buttonHoverColor', theme.visual.buttonHoverColor.slice(0, 7));
  setValue('footerColor', theme.visual.footerColor.slice(0, 7));
  setValue('footerOpacity', String(theme.visual.footerOpacity));
  setValue('backgroundUrl', theme.visual.backgroundUrl ?? '');
  await applyVisualPreferences({
    ...theme.visual,
    language: currentSettingsSnapshot?.visual.language ?? document.documentElement.lang,
  });
}

function setThemeMode(mode: 'library' | 'marketplace'): void {
  if (mode === 'library' && marketplacePreviewOriginal) {
    void restoreThemePreview();
  }
  document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]').forEach((button) => {
    const active = button.dataset.themeMode === mode;
    button.classList.toggle('is-outlined', !active);
  });
  const list = document.querySelector<HTMLElement>('[data-theme-list]');
  const marketplace = document.querySelector<HTMLElement>('[data-theme-marketplace]');
  const actions = document.querySelector<HTMLElement>('[data-theme-library-actions]');
  if (list) {
    list.style.display = '';
  }
  if (marketplace) {
    marketplace.style.display = mode === 'marketplace' ? 'block' : 'none';
  }
  if (actions) {
    actions.hidden = false;
  }
  renderThemeCards(
    mode === 'library' ? currentThemeLibrary.themes : marketplaceThemes,
    mode === 'marketplace',
  );
}

async function loadThemeLibrary(): Promise<void> {
  themeStatus('Cargando tus temas…');
  try {
    currentThemeLibrary = await window.battly.getThemes();
    setThemeMode('library');
    themeStatus(`${currentThemeLibrary.themes.length} temas disponibles.`);
  } catch {
    currentThemeLibrary = { activeThemeId: null, themes: [] };
    setThemeMode('library');
    themeStatus('Selecciona una cuenta Battly o comprueba la conexión para gestionar temas.');
  }
}

async function loadThemeMarketplace(query = ''): Promise<void> {
  const revision = ++marketplaceRequestRevision;
  const dialog = document.querySelector<HTMLDialogElement>('[data-market-dialog]');
  setThemeMode('marketplace');
  if (dialog && !dialog.open) {
    dialog.showModal();
  }
  themeStatus('Cargando marketplace…');
  if (!marketplaceThemes.length) {
    const list = document.querySelector<HTMLElement>('[data-theme-marketplace-list]');
    list?.replaceChildren(steveLoader('Cargando marketplace…'));
  }
  dialog?.setAttribute('aria-busy', 'true');
  const sort =
    document.querySelector<HTMLSelectElement>('[data-market-order]')?.value === 'trending'
      ? 'trending'
      : 'newest';
  const key = JSON.stringify([query.trim(), sort]);
  try {
    let request = marketplacePending.get(key);
    if (!request) {
      request = window.battly.getThemeMarketplace(query.trim(), sort);
      marketplacePending.set(key, request);
      void request
        .finally(() => {
          if (marketplacePending.get(key) === request) {
            marketplacePending.delete(key);
          }
        })
        .catch(() => undefined);
    }
    const [themes, sounds] = await Promise.all([
      request,
      window.battly.getThemeSounds().catch(() => ({ premium: false })),
    ]);
    if (revision !== marketplaceRequestRevision || !dialog?.open) {
      return;
    }
    marketplacePremium = sounds.premium;
    marketplaceThemes = themes;
    marketplaceVisibleCount = 24;
    dialog?.querySelector('.battly-market-filters')?.dispatchEvent(new Event('filters-redraw'));
    themeStatus(`${marketplaceThemes.length} temas encontrados.`);
  } catch {
    if (revision !== marketplaceRequestRevision || !dialog?.open) {
      return;
    }
    marketplaceThemes = [];
    renderThemeCards([], true);
    themeStatus('No se pudo cargar el marketplace.');
  } finally {
    if (revision === marketplaceRequestRevision) {
      dialog?.setAttribute('aria-busy', 'false');
    }
  }
}

function openThemeEditor(theme?: BattlyTheme): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-theme-editor-dialog]');
  const form = document.querySelector<HTMLFormElement>('[data-theme-editor-form]');
  if (!dialog || !form) {
    return;
  }
  form.reset();
  const idInput = form.elements.namedItem('id');
  if (idInput instanceof HTMLInputElement) {
    idInput.value = '';
  }
  const draft = theme
    ? {
        id: theme.id,
        name: theme.name,
        buttonColor: theme.visual.buttonColor,
        buttonHoverColor: theme.visual.buttonHoverColor,
        footerColor: theme.visual.footerColor,
        footerOpacity: theme.visual.footerOpacity,
        loadingColor: theme.loadingColor,
        backgroundUrl: theme.visual.backgroundUrl,
        startupSound: theme.startupSound,
        startupVolume: theme.startupVolume,
      }
    : defaultThemeDraft;
  for (const [name, value] of Object.entries(draft)) {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement) {
      input.value = value === null ? '' : String(value);
    }
  }
  const title = dialog.querySelector<HTMLElement>('[data-theme-editor-title]');
  if (title) {
    title.textContent = theme ? 'Editar tema' : 'Nuevo tema';
  }
  const status = dialog.querySelector<HTMLElement>('[data-theme-editor-status]');
  if (status) {
    status.textContent = '';
  }
  const soundLabel = dialog.querySelector<HTMLElement>('[data-theme-sound-label]');
  if (soundLabel) {
    soundLabel.textContent = themeSoundName(draft.startupSound);
  }
  const backgroundName = dialog.querySelector<HTMLElement>('[data-theme-background-name]');
  if (backgroundName) {
    backgroundName.textContent = draft.backgroundUrl
      ? 'Fondo actual del tema'
      : 'Sin imagen seleccionada';
  }
  dialog.showModal();
}

const themeSounds = [
  ['start', 'Retro'],
  ['start1', 'Fulgor'],
  ['start2', 'Neón'],
  ['start3', 'Centella'],
  ['start4', 'Aventura'],
  ['start5', 'Batalla'],
  ['start6', 'Moderno'],
] as const;

const themeSoundUrls: Readonly<Record<string, string>> = {
  start: startSoundUrl,
  start1: start1SoundUrl,
  start2: start2SoundUrl,
  start3: start3SoundUrl,
  start4: start4SoundUrl,
  start5: start5SoundUrl,
  start6: start6SoundUrl,
};

function themeSoundName(value: string): string {
  return themeSounds.find(([id]) => id === value)?.[1] ?? 'Sonido personalizado';
}

let themePreviewAudio: HTMLAudioElement | undefined;
let themePreviewRevision = 0;
let themePreviewSound = '';
function stopThemeSoundPreview(): void {
  themePreviewRevision++;
  themePreviewAudio?.pause();
  themePreviewAudio = undefined;
  themePreviewSound = '';
  document.querySelectorAll<HTMLButtonElement>('.theme-sound-preview').forEach((button) => {
    button.textContent = '▶';
    button.setAttribute('aria-pressed', 'false');
  });
}

async function previewThemeSound(value: string, volume: number): Promise<void> {
  stopThemeSoundPreview();
  const revision = themePreviewRevision;
  value = normalizeThemeSound(value);
  themePreviewSound = value;
  const builtin = themeSoundUrls[value];
  try {
    if (!builtin && !(await window.battly.getThemeSounds()).premium) {
      if (revision === themePreviewRevision) {
        stopThemeSoundPreview();
      }
      themeStatus('Los sonidos de temas requieren Battly+');
      return;
    }
  } catch {
    if (revision === themePreviewRevision) {
      stopThemeSoundPreview();
    }
    return;
  }
  if (revision !== themePreviewRevision) {
    return;
  }
  try {
    const custom = new URL(builtin || value, location.href);
    if (
      builtin ||
      custom.protocol === 'https:' ||
      custom.protocol === 'data:' ||
      custom.protocol === 'blob:'
    ) {
      const audio = new Audio(custom.href);
      themePreviewAudio = audio;
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.addEventListener(
        'ended',
        () => {
          if (themePreviewAudio === audio) {
            stopThemeSoundPreview();
          }
        },
        { once: true },
      );
      await audio.play();
    }
  } catch {
    if (revision === themePreviewRevision) {
      stopThemeSoundPreview();
    }
  }
}

function themeDraftFromForm(form: HTMLFormElement): ThemeDraft {
  const data = new FormData(form);
  const value = (name: string): string => {
    const entry = data.get(name);
    return typeof entry === 'string' ? entry.trim() : '';
  };
  return {
    ...(value('id') ? { id: value('id') } : {}),
    name: value('name'),
    buttonColor: value('buttonColor'),
    buttonHoverColor: value('buttonHoverColor'),
    footerColor: value('footerColor'),
    footerOpacity: Number(value('footerOpacity')),
    loadingColor: value('loadingColor'),
    backgroundUrl: value('backgroundUrl') || null,
    startupSound: value('startupSound'),
    startupVolume: Number(value('startupVolume')),
  };
}

function openThemeReviewModal(theme: BattlyTheme, result: ThemeReviewResult): void {
  document.querySelector('#reviewStateModal')?.remove();
  const activeIndex =
    result.status === 'requested' || result.status === 'draft'
      ? 0
      : result.status === 'pending'
        ? 1
        : 2;
  const wrap = document.createElement('div');
  wrap.id = 'reviewStateModal';
  wrap.className = 'theme-review-dialog';
  wrap.dataset.reviewState = result.status;
  wrap.innerHTML = /* HTML */ ` <div class="modal is-active">
    <div
      class="modal-background"
      data-theme-review-close
    ></div>
    <div
      class="modal-card glass"
      style="width:620px"
    >
      <header class="modal-card-head">
        <p class="modal-card-title">
          <i class="fa-solid fa-circle-info mr-2"></i>Estado de publicación
        </p>
        <button
          class="delete"
          type="button"
          aria-label="Cerrar"
          data-theme-review-close
        ></button>
      </header>
      <section
        class="modal-card-body"
        style="background:#0f1623"
      >
        <div class="timeline">
          <div class="step active"><small>Solicitud enviada</small></div>
          <div class="step${activeIndex >= 1 ? ' active' : ''}"><small>En revisión</small></div>
          <div class="step${activeIndex >= 2 ? ' active' : ''}">
            <small>${result.status === 'rejected' ? 'Rechazado' : 'Publicado'}</small>
          </div>
        </div>
        ${result.status === 'pending' || result.status === 'requested' ? '<p class="b-themes-status-theme-text">Tu tema está siendo revisado.</p>' : ''}
        ${result.status === 'approved' ? '<p class="has-text-success b-themes-status-theme-text">¡Enhorabuena! Tu tema está publicado.</p>' : ''}
      </section>
      <footer
        class="modal-card-foot"
        style="justify-content:flex-end"
      >
        ${result.status === 'rejected' || result.status === 'draft' ? '<button class="button is-info is-outlined" type="button" data-theme-review-resubmit><i class="fa-solid fa-paper-plane mr-1"></i>Reenviar a revisión</button>' : ''}
        ${result.status === 'approved' ? '<button class="button is-info is-outlined" type="button" data-theme-review-open><i class="fa-solid fa-eye mr-1"></i>Ver página del tema</button>' : ''}
        <button
          class="button cancel is-danger is-outlined"
          type="button"
          data-theme-review-unpublish
        >
          Despublicar
        </button>
        <button
          class="button"
          type="button"
          data-theme-review-close
        >
          Cerrar
        </button>
      </footer>
    </div>
  </div>`;
  const themeName = document.createElement('p');
  themeName.className = 'theme-review-name';
  themeName.textContent = theme.name;
  wrap.querySelector('.modal-card-body')?.prepend(themeName);
  if (result.status === 'rejected') {
    const body = wrap.querySelector<HTMLElement>('.modal-card-body');
    const warning = document.createElement('article');
    warning.className = 'message is-warning publish-message-warning mt-4';
    const message = document.createElement('div');
    message.className = 'message-body';
    const title = document.createElement('strong');
    title.textContent = 'Motivo del rechazo';
    message.append(title, document.createElement('br'), result.reason || 'No especificado');
    warning.append(message);
    body?.append(warning);
  }
  const close = (): void => wrap.remove();
  wrap
    .querySelectorAll<HTMLElement>('[data-theme-review-close]')
    .forEach((element) => element.addEventListener('click', close));
  wrap
    .querySelector<HTMLButtonElement>('[data-theme-review-resubmit]')
    ?.addEventListener('click', () => {
      themeStatus('Reenviando tema…');
      void window.battly
        .requestThemeReview(theme.id)
        .then((snapshot) => {
          currentThemeLibrary = snapshot;
          setThemeMode('library');
          themeStatus('Tema reenviado a revisión correctamente.');
          close();
        })
        .catch(() => themeStatus('No se pudo reenviar el tema a revisión.'));
    });
  wrap
    .querySelector<HTMLButtonElement>('[data-theme-review-open]')
    ?.addEventListener('click', () => void window.battly.openThemePage(theme.id));
  wrap.querySelector<HTMLButtonElement>('[data-theme-review-unpublish]')?.addEventListener(
    'click',
    voidAsyncEvent(async () => {
      if (!(await askBattly({ text: '¿Seguro que quieres despublicar este tema?' }))) {
        return;
      }
      themeStatus('Despublicando tema…');
      void window.battly
        .unpublishTheme(theme.id)
        .then((snapshot) => {
          currentThemeLibrary = snapshot;
          setThemeMode('library');
          themeStatus('Tema despublicado correctamente.');
          close();
        })
        .catch(() => themeStatus('No se pudo despublicar el tema.'));
    }),
  );
  document.body.append(wrap);
}

function renderThemeShareModal(): void {
  const list = document.querySelector<HTMLElement>('[data-theme-share-list]');
  const stats = document.querySelector<HTMLElement>('[data-theme-share-stats]');
  const themes = currentThemeLibrary.themes.filter((theme) => !theme.isDefault);
  list?.replaceChildren();
  stats?.replaceChildren();
  if (!themes.length) {
    const empty = document.createElement('div');
    empty.className = 'theme-sharing-empty';
    empty.innerHTML = /* HTML */ `<i
        class="fa-solid fa-palette"
        aria-hidden="true"
      ></i
      ><strong>Tu estilo empieza aquí</strong
      ><span>Crea un tema en tu colección y podrás compartirlo con un enlace.</span>`;
    list?.append(empty);
    const statsEmpty = empty.cloneNode(true) as HTMLElement;
    statsEmpty.innerHTML = /* HTML */ `<i
        class="fa-solid fa-chart-simple"
        aria-hidden="true"
      ></i
      ><strong>Aún no hay actividad</strong
      ><span>Las estadísticas de tus temas aparecerán aquí.</span>`;
    stats?.append(statsEmpty);
    return;
  }
  for (const theme of themes) {
    const item = document.createElement('div');
    item.className = 'theme-share-item';
    const copy = document.createElement('div');
    copy.className = 'theme-share-copy';
    const name = document.createElement('strong');
    setUserText(name, theme.name);
    name.title = theme.name;
    const colors = document.createElement('div');
    colors.className = 'theme-share-palette';
    colors.setAttribute('aria-hidden', 'true');
    for (const color of [theme.visual.buttonColor, theme.visual.footerColor]) {
      const swatch = document.createElement('span');
      swatch.style.backgroundColor = color;
      colors.append(swatch);
    }
    const hint = document.createElement('small');
    hint.textContent = 'Comparte este tema con un enlace';
    copy.append(name, hint);
    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'theme-share-button';
    share.setAttribute('aria-label', `Compartir ${theme.name}`);
    share.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i> Compartir';
    share.addEventListener('click', () => {
      share.disabled = true;
      void window.battly
        .shareTheme(theme.id)
        .then(async (result) => {
          await copyTextToClipboard(result.shareUrl);
          const status = document.querySelector<HTMLElement>('[data-theme-import-status]');
          if (status) {
            status.textContent = result.expiresAt
              ? `Enlace copiado. Expira el ${new Date(result.expiresAt).toLocaleDateString(uiLocale())}.`
              : 'Enlace copiado al portapapeles.';
          }
        })
        .catch(() => {
          const status = document.querySelector<HTMLElement>('[data-theme-import-status]');
          if (status) {
            status.textContent = 'No se pudo compartir o copiar el enlace. Inténtalo de nuevo.';
          }
        })
        .finally(() => {
          share.disabled = false;
        });
    });
    item.append(colors, copy, share);
    list?.append(item);

    const stat = document.createElement('div');
    stat.className = 'share-stat-item';
    const statName = document.createElement('strong');
    setUserText(statName, theme.name);
    const counters = document.createElement('div');
    counters.className = 'theme-share-counters';
    for (const [label, count] of [
      ['Instalaciones', theme.downloads],
      ['Me gusta', theme.likes],
      ['Comentarios', theme.comments],
    ] as const) {
      const metric = document.createElement('span');
      const value = document.createElement('b');
      value.textContent = formatCount(count);
      metric.append(value, label);
      counters.append(metric);
    }
    stat.append(statName, counters);
    stats?.append(stat);
  }
}

function selectThemeShareTab(target: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-theme-share-tab]').forEach((tab) => {
    const active = tab.dataset.themeShareTab === target;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>('[data-theme-share-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.themeSharePanel !== target;
  });
  const status = document.querySelector<HTMLElement>('[data-theme-import-status]');
  if (status) {
    status.textContent = '';
  }
}

function mountThemeMarketplace(): void {
  if (document.querySelector('[data-market-dialog]')) {
    return;
  }
  const panel = document.querySelector<HTMLElement>('[data-theme-marketplace]');
  if (!panel) {
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'battly-market-dialog';
  dialog.dataset.marketDialog = '';
  dialog.setAttribute('aria-labelledby', 'battly-market-title');
  const header = document.createElement('header');
  header.innerHTML = /* HTML */ `<div>
      <h2>Marketplace de temas</h2>
      <p>Encuentra un fondo y unos colores que vayan contigo.</p>
    </div>
    <button
      type="button"
      aria-label="Cerrar marketplace"
    >
      ×
    </button>`;
  header.querySelector('button')!.addEventListener('click', () => dialog.close());
  header.querySelector('h2')!.id = 'battly-market-title';
  const filters = document.createElement('div');
  filters.className = 'battly-market-filters';
  filters.innerHTML = /* HTML */ `<label
      >Descubrir<select data-market-order>
        <option value="personal">Para ti</option>
        <option value="trending">Trending</option>
        <option value="newest">Más recientes</option>
        <option value="name">Nombre</option>
      </select></label
    ><label
      >Fondo<select data-market-background>
        <option value="">Todos</option>
        <option value="static">Estáticos</option>
        <option value="animated">Animados · Battly+</option>
      </select></label
    >`;
  const search = panel.querySelector<HTMLInputElement>('[data-theme-marketplace-search-input]');
  if (search) {
    const searchField = document.createElement('label');
    searchField.className = 'battly-market-search';
    const label = document.createElement('span');
    label.textContent = 'Buscar';
    search.setAttribute('aria-label', 'Buscar');
    const oldField = search.closest('.field');
    searchField.append(label, search);
    filters.prepend(searchField);
    oldField?.remove();
  }
  const footer = document.createElement('footer');
  footer.className = 'battly-market-footer';
  const status = document.createElement('span');
  status.dataset.marketStatus = '';
  status.setAttribute('role', 'status');
  const more = document.createElement('button');
  more.type = 'button';
  more.dataset.marketMore = '';
  more.textContent = 'Mostrar más';
  more.hidden = true;
  footer.append(status, more);
  const previewToolbar = document.createElement('div');
  previewToolbar.className = 'market-preview-toolbar';
  const previewName = document.createElement('span');
  previewName.dataset.marketPreviewName = '';
  const restore = document.createElement('button');
  restore.type = 'button';
  setUiText(restore, 'Restaurar');
  restore.addEventListener('click', () => {
    void restoreThemePreview();
  });
  previewToolbar.append(previewName, restore);
  dialog.addEventListener('cancel', (event) => {
    if (marketplacePreviewOriginal) {
      event.preventDefault();
      void restoreThemePreview();
    }
  });
  const redraw = (): void => {
    const order = filters.querySelector<HTMLSelectElement>('[data-market-order]')!.value;
    const type = filters.querySelector<HTMLSelectElement>('[data-market-background]')!.value;
    const active = currentThemeLibrary.themes.find(
      (theme) => theme.id === currentThemeLibrary.activeThemeId,
    );
    const themes = marketplaceThemes.filter(
      (theme) =>
        !type ||
        (type === 'animated') ===
          /\.(gif|webp|mp4|webm)(?:[?#]|$)/i.test(theme.visual.backgroundUrl ?? ''),
    );
    if (order === 'name') {
      themes.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (order === 'personal' && active) {
      themes.sort(
        (a, b) =>
          Number(b.visual.buttonColor === active.visual.buttonColor) -
            Number(a.visual.buttonColor === active.visual.buttonColor) || b.downloads - a.downloads,
      );
    }
    renderThemeCards(themes, true);
  };
  filters.addEventListener('change', () => {
    marketplaceVisibleCount = 24;
    panel.scrollTop = 0;
    redraw();
  });
  filters.addEventListener('filters-redraw', redraw);
  more.addEventListener('click', () => {
    marketplaceVisibleCount += 24;
    redraw();
  });
  filters.querySelector('[data-market-order]')?.addEventListener('change', () => {
    void loadThemeMarketplace(search?.value ?? '');
  });
  dialog.addEventListener('close', () => {
    marketplaceMedia.stop();
    marketplaceRequestRevision++;
    if (marketplaceSearchTimer) {
      clearTimeout(marketplaceSearchTimer);
    }
    marketplaceSearchTimer = null;
    marketplacePending.clear();
    void restoreThemePreview();
    setThemeMode('library');
  });
  dialog.append(header, filters, panel, footer, previewToolbar);
  document.body.append(dialog);
}

function bindThemes(): void {
  mountThemeMarketplace();
  document.querySelectorAll<HTMLButtonElement>('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.themeMode === 'marketplace') {
        void loadThemeMarketplace();
      } else {
        setThemeMode('library');
      }
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-theme-create]')
    ?.addEventListener('click', () => openThemeEditor());
  const search = document.querySelector<HTMLInputElement>('[data-theme-marketplace-search-input]');
  search?.addEventListener('input', () => {
    if (marketplaceSearchTimer) {
      clearTimeout(marketplaceSearchTimer);
    }
    marketplaceSearchTimer = setTimeout(() => void loadThemeMarketplace(search.value), 250);
  });
  document
    .querySelectorAll<HTMLElement>('[data-theme-list], [data-theme-marketplace-list]')
    .forEach((themeList) =>
      themeList.addEventListener(
        'click',
        voidAsyncEvent(async (event) => {
          const button = (event.target as Element).closest<HTMLButtonElement>(
            '[data-theme-action]',
          );
          const id = button?.dataset.themeId;
          const action = button?.dataset.themeAction;
          if (!button || !id || !action) {
            return;
          }
          button.disabled = true;
          if (action === 'preview') {
            const theme = marketplaceThemes.find((candidate) => candidate.id === id);
            if (theme) {
              await previewMarketplaceTheme(theme);
            }
            button.disabled = false;
            return;
          }
          if (action === 'edit') {
            const theme = currentThemeLibrary.themes.find((candidate) => candidate.id === id);
            if (theme) {
              openThemeEditor(theme);
            }
            button.disabled = false;
            return;
          }
          if (
            action === 'archive' &&
            !(await askBattly({ text: '¿Eliminar este tema de tu colección?' }))
          ) {
            button.disabled = false;
            return;
          }
          themeStatus('Procesando tema…');
          const operation =
            action === 'apply'
              ? window.battly.applyTheme(id)
              : action === 'archive'
                ? window.battly.archiveTheme(id)
                : action === 'install'
                  ? window.battly.installMarketplaceTheme(id)
                  : action === 'share'
                    ? window.battly.shareTheme(id)
                    : action === 'review'
                      ? (() => {
                          const theme = currentThemeLibrary.themes.find(
                            (candidate) => candidate.id === id,
                          );
                          return !theme || theme.reviewStatus === 'draft'
                            ? window.battly.requestThemeReview(id)
                            : window.battly.getThemeReviewStatus(id);
                        })()
                      : Promise.reject(new Error('Acción no disponible'));
          void operation
            .then(async (result) => {
              if ('status' in result) {
                const labels = {
                  draft: 'Borrador',
                  requested: 'Solicitud enviada',
                  pending: 'Tema en revisión',
                  approved: 'Tema publicado',
                  rejected: 'Tema rechazado',
                } as const;
                themeStatus(
                  `${labels[result.status]}${result.reason ? `: ${result.reason}` : '.'}`,
                );
                currentThemeLibrary = await window.battly.getThemes();
                renderThemeCards(currentThemeLibrary.themes, false);
                const theme = currentThemeLibrary.themes.find((candidate) => candidate.id === id);
                if (theme) {
                  openThemeReviewModal(theme, result);
                }
              } else if ('themes' in result) {
                currentThemeLibrary = result;
                setThemeMode('library');
                await reflectActiveTheme(result);
                themeStatus(
                  action === 'review'
                    ? 'Tema enviado a revisión correctamente.'
                    : 'Tema actualizado correctamente.',
                );
              } else {
                await copyTextToClipboard(result.shareUrl);
                showToast(
                  'Enlace copiado',
                  'El enlace del tema está en el portapapeles.',
                  'success',
                );
                themeStatus('Enlace copiado al portapapeles.');
              }
            })
            .catch((error: unknown) =>
              themeStatus(
                error instanceof Error
                  ? error.message
                  : 'No se pudo completar la operación del tema.',
              ),
            )
            .finally(() => {
              button.disabled = false;
            });
        }),
      ),
    );
  const editor = document.querySelector<HTMLDialogElement>('[data-theme-editor-dialog]');
  document.querySelectorAll<HTMLButtonElement>('[data-theme-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => editor?.close());
  });
  document
    .querySelector<HTMLFormElement>('[data-theme-editor-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const status = form.querySelector<HTMLElement>('[data-theme-editor-status]');
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit?.disabled) {
        return;
      }
      if (submit) {
        submit.disabled = true;
      }
      if (status) {
        status.textContent = 'Validando y guardando el tema…';
      }
      void window.battly
        .saveTheme(themeDraftFromForm(form))
        .then((snapshot) => {
          currentThemeLibrary = snapshot;
          renderThemeCards(snapshot.themes, false);
          void reflectActiveTheme(snapshot);
          editor?.close();
          themeStatus('Tema guardado.');
        })
        .catch((error: unknown) => {
          if (status) {
            status.textContent = userErrorMessage(error, 'No se pudo guardar el tema.');
          }
        })
        .finally(() => {
          if (submit) {
            submit.disabled = false;
          }
        });
    });
  const editorForm = document.querySelector<HTMLFormElement>('[data-theme-editor-form]');
  const soundDialog = document.querySelector<HTMLDialogElement>('[data-theme-sound-dialog]');
  const soundLibrary = document.querySelector<HTMLElement>('[data-theme-sound-library]');
  const soundVolume = document.querySelector<HTMLInputElement>('[data-theme-sound-volume]');
  const soundVolumeLabel = document.querySelector<HTMLElement>('[data-theme-sound-volume-label]');
  let uploadedSounds: Awaited<ReturnType<typeof window.battly.getThemeSounds>> = {
    premium: false,
    sounds: [],
  };
  const soundStatus = document.querySelector<HTMLElement>('[data-theme-sound-status]');
  const uploadSoundButton = document.querySelector<HTMLButtonElement>('[data-theme-sound-upload]');
  const renderSounds = (): void => {
    if (!soundLibrary || !editorForm) {
      return;
    }
    const selected = editorForm.elements.namedItem('startupSound');
    const current = selected instanceof HTMLInputElement ? selected.value : 'start';
    soundLibrary.replaceChildren(
      ...[
        ...themeSounds.map(([id, name]) => ({ id, name, custom: false })),
        ...uploadedSounds.sounds.map((sound) => ({
          id: sound.url,
          name: sound.name,
          custom: true,
        })),
        ...(!themeSounds.some(([id]) => id === current) &&
        !uploadedSounds.sounds.some((sound) => sound.url === current)
          ? [{ id: current, name: 'Sonido del tema', custom: true }]
          : []),
      ].map(({ id, name, custom }) => {
        const row = document.createElement('div');
        row.className = 'theme-sound-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theme-sound-item${id === current ? ' is-active' : ''}`;
        button.disabled = !uploadedSounds.premium;
        if (!uploadedSounds.premium) {
          button.title = 'Los sonidos de temas requieren Battly+';
        }
        button.innerHTML = /* HTML */ `<i
            class="fa-solid fa-music"
            aria-hidden="true"
          ></i
          ><span><strong></strong><small></small></span
          ><i
            class="fa-solid fa-check"
            aria-hidden="true"
          ></i>`;
        button.querySelector('strong')!.textContent = name;
        button.querySelector('small')!.textContent = custom
          ? 'Tu sonido · Battly+'
          : 'Predeterminado';
        button.addEventListener('click', () => {
          if (selected instanceof HTMLInputElement) {
            selected.value = id;
          }
          const label = editorForm.querySelector<HTMLElement>('[data-theme-sound-label]');
          if (label) {
            label.textContent = name;
          }
          renderSounds();
        });
        const preview = document.createElement('button');
        preview.type = 'button';
        preview.className = 'theme-sound-preview';
        preview.textContent = themePreviewSound === id ? '■' : '▶';
        preview.title = translateUiText('Reproducir');
        preview.setAttribute('aria-label', `${translateUiText('Reproducir')}: ${name}`);
        preview.setAttribute('aria-pressed', String(themePreviewSound === id));
        preview.addEventListener('click', () => {
          if (themePreviewSound === id) {
            stopThemeSoundPreview();
            return;
          }
          void previewThemeSound(id, Number(soundVolume?.value ?? 0.8)).finally(() => {
            if (themePreviewSound !== id) {
              preview.textContent = '▶';
              preview.setAttribute('aria-pressed', 'false');
            }
          });
          preview.textContent = '■';
          preview.setAttribute('aria-pressed', 'true');
        });
        row.append(button, preview);
        return row;
      }),
    );
  };
  soundDialog?.addEventListener('close', stopThemeSoundPreview);
  window.addEventListener('battly:account-changed', stopThemeSoundPreview);
  editorForm
    ?.querySelector<HTMLButtonElement>('[data-theme-sound-open]')
    ?.addEventListener('click', () => {
      const volume = editorForm.elements.namedItem('startupVolume');
      if (soundVolume && volume instanceof HTMLInputElement) {
        soundVolume.value = volume.value;
      }
      renderSounds();
      soundDialog?.showModal();
      if (soundVolumeLabel && soundVolume) {
        soundVolumeLabel.textContent = `${Math.round(Number(soundVolume.value) * 100)}%`;
      }
      if (uploadSoundButton) {
        uploadSoundButton.hidden = false;
        uploadSoundButton.disabled = true;
      }
      if (soundStatus) {
        soundStatus.textContent = 'Cargando tus sonidos…';
      }
      void window.battly
        .getThemeSounds()
        .then((library) => {
          uploadedSounds = library;
          renderSounds();
          if (uploadSoundButton) {
            uploadSoundButton.disabled = !library.premium;
          }
          if (soundStatus) {
            soundStatus.textContent = library.premium
              ? 'MP3, WAV, OGG, M4A o AAC · máximo 10 segundos y 5 MB.'
              : 'Los sonidos de temas requieren Battly+.';
          }
        })
        .catch(() => {
          if (soundStatus) {
            soundStatus.textContent =
              'No se pudieron cargar tus sonidos. Cierra y vuelve a abrir este panel para reintentar.';
          }
        });
    });
  uploadSoundButton?.addEventListener('click', () => {
    uploadSoundButton.disabled = true;
    if (soundStatus) {
      soundStatus.textContent = 'Subiendo sonido…';
    }
    void window.battly
      .selectThemeSound()
      .then((library) => {
        if (!library) {
          if (soundStatus) {
            soundStatus.textContent = '';
          }
          return;
        }
        uploadedSounds = library;
        const latest = library.sounds[0];
        const selected = editorForm?.elements.namedItem('startupSound');
        if (latest && selected instanceof HTMLInputElement) {
          selected.value = latest.url;
          const label = editorForm?.querySelector<HTMLElement>('[data-theme-sound-label]');
          if (label) {
            label.textContent = latest.name;
          }
        }
        renderSounds();
        if (soundStatus) {
          soundStatus.textContent = 'Sonido subido. Guarda el tema para conservarlo.';
        }
      })
      .catch((error: unknown) => {
        if (soundStatus) {
          soundStatus.textContent =
            error instanceof Error
              ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
              : 'No se pudo subir el sonido.';
        }
      })
      .finally(() => {
        uploadSoundButton.disabled = !uploadedSounds.premium;
      });
  });
  document
    .querySelectorAll<HTMLButtonElement>('[data-theme-sound-close]')
    .forEach((button) => button.addEventListener('click', () => soundDialog?.close()));
  soundVolume?.addEventListener('input', () => {
    if (soundVolumeLabel) {
      soundVolumeLabel.textContent = `${Math.round(Number(soundVolume.value) * 100)}%`;
    }
    const input = editorForm?.elements.namedItem('startupVolume');
    if (input instanceof HTMLInputElement) {
      input.value = soundVolume.value;
    }
  });
  editorForm
    ?.querySelector<HTMLButtonElement>('[data-theme-sound-play]')
    ?.addEventListener('click', () => {
      const sound = editorForm.elements.namedItem('startupSound');
      const volume = editorForm.elements.namedItem('startupVolume');
      void previewThemeSound(
        sound instanceof HTMLInputElement ? sound.value : 'start',
        volume instanceof HTMLInputElement ? Number(volume.value) : 0.8,
      );
    });
  editorForm
    ?.querySelector<HTMLButtonElement>('[data-theme-background-select]')
    ?.addEventListener('click', () => {
      const status = editorForm.querySelector<HTMLElement>('[data-theme-editor-status]');
      if (status) {
        status.textContent = 'Selecciona un fondo. Se validará antes de subirlo…';
      }
      void window.battly
        .selectThemeBackground()
        .then((url) => {
          if (!url) {
            if (status) {
              status.textContent = '';
            }
            return;
          }
          const input = editorForm.elements.namedItem('backgroundUrl');
          if (input instanceof HTMLInputElement) {
            input.value = url;
          }
          const name = editorForm.querySelector<HTMLElement>('[data-theme-background-name]');
          if (name) {
            name.textContent = 'Fondo preparado';
          }
          if (status) {
            status.textContent = 'Fondo subido. Guarda el tema para aplicarlo.';
          }
        })
        .catch((error: unknown) => {
          if (status) {
            status.textContent = userErrorMessage(error, 'No se pudo subir el fondo.');
          }
        });
    });
  const importDialog = document.querySelector<HTMLDialogElement>('[data-theme-import-dialog]');
  document
    .querySelector<HTMLButtonElement>('[data-theme-import-open]')
    ?.addEventListener('click', () => {
      const open = (): void => {
        renderThemeShareModal();
        selectThemeShareTab('import');
        importDialog?.showModal();
      };
      if (currentThemeLibrary.themes.length) {
        open();
      } else {
        void window.battly
          .getThemes()
          .then((snapshot) => {
            currentThemeLibrary = snapshot;
            open();
          })
          .catch(open);
      }
    });
  document.querySelectorAll<HTMLButtonElement>('[data-theme-share-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      selectThemeShareTab(tab.dataset.themeShareTab ?? 'share');
    });
    tab.addEventListener('keydown', (event) => {
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-theme-share-tab]')];
      const index = tabs.indexOf(tab);
      const next =
        event.key === 'ArrowRight'
          ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft'
            ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : -1;
      if (next < 0) {
        return;
      }
      event.preventDefault();
      tabs[next].click();
      tabs[next].focus();
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-theme-import-close]').forEach((button) => {
    button.addEventListener('click', () => importDialog?.close());
  });
  document
    .querySelector<HTMLFormElement>('[data-theme-import-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const code = data.get('code');
      const customName = data.get('customName');
      const status = form.querySelector<HTMLElement>('[data-theme-import-status]');
      const submit = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (
        submit?.disabled ||
        form.querySelector<HTMLElement>('[data-theme-share-panel="import"]')?.hidden
      ) {
        return;
      }
      if (typeof code !== 'string' || !code.trim()) {
        if (status) {
          status.textContent = 'Pega un código o enlace para importar el tema.';
        }
        form.querySelector<HTMLInputElement>('[name="code"]')?.focus();
        return;
      }
      if (submit) {
        submit.disabled = true;
      }
      form.setAttribute('aria-busy', 'true');
      if (status) {
        status.textContent = 'Importando…';
      }
      void window.battly
        .importTheme({
          code: code.trim(),
          customName: typeof customName === 'string' ? customName : '',
        })
        .then((snapshot) => {
          currentThemeLibrary = snapshot;
          setThemeMode('library');
          importDialog?.close();
          form.reset();
          themeStatus('Tema importado a tu colección.');
        })
        .catch(() => {
          if (status) {
            status.textContent = 'El código o enlace no se pudo importar.';
          }
        })
        .finally(() => {
          if (submit) {
            submit.disabled = false;
          }
          form.removeAttribute('aria-busy');
        });
    });
}

const profilePresets: Readonly<Record<string, Omit<ProfileCustomization, 'backgroundImage'>>> = {
  default: {
    borderColor: '#7289da',
    borderStyle: 'solid',
    borderWidth: 3,
    nameColor: '#ffffff',
    backgroundColor: '#2c2f33',
  },
  classic: {
    borderColor: '#ffffff',
    borderStyle: 'solid',
    borderWidth: 2,
    nameColor: '#ffffff',
    backgroundColor: '#36393f',
  },
  neon: {
    borderColor: '#00ff88',
    borderStyle: 'solid',
    borderWidth: 3,
    nameColor: '#ff0080',
    backgroundColor: '#0a0a0a',
  },
  fire: {
    borderColor: '#ff4500',
    borderStyle: 'solid',
    borderWidth: 4,
    nameColor: '#ffd700',
    backgroundColor: '#2f1b14',
  },
  ice: {
    borderColor: '#00bfff',
    borderStyle: 'solid',
    borderWidth: 3,
    nameColor: '#e0ffff',
    backgroundColor: '#1e3a5f',
  },
};

let ownSocialProfile: SocialProfile | null = null;
let profileBackgroundPreviewUrl: string | null = null;

function profileCustomizationForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>('[data-profile-customization-form]');
}

function profileCustomizationDraft(): ProfileCustomization {
  const form = profileCustomizationForm();
  if (!form) {
    const value = (selector: string, fallback: string): string =>
      document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? fallback;
    return {
      borderColor: value('#border-color-picker', defaultProfileCustomization.borderColor),
      borderStyle: value(
        '#border-style-select',
        defaultProfileCustomization.borderStyle,
      ) as ProfileCustomization['borderStyle'],
      borderWidth: Number(
        value('#border-width-slider', String(defaultProfileCustomization.borderWidth)),
      ),
      nameColor: value('#name-color-picker', defaultProfileCustomization.nameColor),
      backgroundColor: value('#bg-color-picker', defaultProfileCustomization.backgroundColor),
      backgroundImage: value('[data-profile-background-value]', '') || null,
    };
  }
  const data = new FormData(form);
  const text = (name: string): string => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    borderColor: text('borderColor'),
    borderStyle: text('borderStyle') as ProfileCustomization['borderStyle'],
    borderWidth: Number(text('borderWidth')),
    nameColor: text('nameColor'),
    backgroundColor: text('backgroundColor'),
    backgroundImage: text('backgroundImage') || null,
  };
}

function setProfileCustomizationForm(customization: ProfileCustomization): void {
  const form = profileCustomizationForm();
  if (!form) {
    const setValue = (selector: string, value: string): void => {
      const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      if (control) {
        control.value = value;
      }
    };
    setValue('#border-color-picker', customization.borderColor);
    setValue('#border-color-text', customization.borderColor);
    setValue('#border-style-select', customization.borderStyle);
    setValue('#border-width-slider', String(customization.borderWidth));
    const borderWidth = document.querySelector<HTMLElement>('#border-width-value');
    if (borderWidth) {
      borderWidth.textContent = String(customization.borderWidth);
    }
    setValue('#name-color-picker', customization.nameColor);
    setValue('#name-color-text', customization.nameColor);
    setValue('#bg-color-picker', customization.backgroundColor);
    setValue('#bg-color-text', customization.backgroundColor);
    setValue('[data-profile-background-value]', customization.backgroundImage ?? '');
    return;
  }
  const width = form.querySelector<HTMLElement>('#border-width-value');
  if (width) {
    width.textContent = String(customization.borderWidth);
  }
  for (const [name, value] of Object.entries(customization)) {
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.value = value === null ? '' : String(value);
    }
  }
}

function renderProfilePreview(): void {
  const profile = ownSocialProfile;
  const customization = profileCustomizationDraft();
  const card = document.querySelector<HTMLElement>('[data-profile-preview]');
  const background = document.querySelector<HTMLElement>('[data-profile-preview-background]');
  const name = document.querySelector<HTMLElement>('[data-profile-preview-name]');
  const skin = document.querySelector<HTMLElement>('[data-profile-preview-skin]');
  const tier = document.querySelector<HTMLElement>('[data-profile-preview-tier]');
  if (card) {
    card.style.border = `${customization.borderWidth}px ${customization.borderStyle} ${customization.borderColor}`;
    card.style.boxShadow = `0 0 22px ${customization.borderColor}55`;
    card.style.backgroundColor = customization.backgroundColor;
    card.style.backgroundImage = profileBackgroundPreviewUrl
      ? `linear-gradient(rgb(5 9 15 / 45%), rgb(5 9 15 / 45%)), url(${JSON.stringify(profileBackgroundPreviewUrl)})`
      : '';
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  if (background) {
    background.style.backgroundColor = '';
  }
  if (!profileCustomizationForm() && card) {
    card.style.backgroundColor = customization.backgroundColor;
    card.style.backgroundImage = profileBackgroundPreviewUrl
      ? `url(${JSON.stringify(profileBackgroundPreviewUrl)})`
      : '';
    card.style.backgroundSize = 'cover';
    card.style.backgroundPosition = 'center';
  }
  if (name) {
    name.textContent = profile?.username ?? 'Jugador';
    name.style.color = customization.nameColor;
    name.style.textShadow = `0 0 10px ${customization.nameColor}66`;
  }
  if (skin) {
    const skinUrl = profile?.skinUrl ?? battlyIconUrl;
    if (skin instanceof HTMLImageElement) {
      skin.src = skinUrl;
      skin.alt = profile ? `Skin de ${profile.username}` : '';
    } else {
      skin.style.backgroundImage = `url(${JSON.stringify(skinUrl)})`;
    }
    skin.style.border = `${customization.borderWidth}px ${customization.borderStyle} ${customization.borderColor}`;
  }
  if (tier) {
    tier.textContent = profile?.premium ? 'Battly+ · cosméticos activos' : 'Battly';
  }
  const imageName = document.querySelector<HTMLElement>('[data-profile-background-name]');
  if (imageName) {
    imageName.textContent = customization.backgroundImage
      ? 'Imagen de fondo seleccionada'
      : 'Sin imagen de fondo';
  }
  const currentBackground = document.querySelector<HTMLElement>('#current-bg-preview');
  const currentBackgroundImage = document.querySelector<HTMLImageElement>('#current-bg-img');
  const hasBackground = Boolean(customization.backgroundImage || profileBackgroundPreviewUrl);
  if (currentBackground) {
    currentBackground.hidden = !hasBackground;
    currentBackground.style.display = hasBackground ? 'flex' : 'none';
  }
  if (currentBackgroundImage) {
    currentBackgroundImage.src = profileBackgroundPreviewUrl ?? '';
  }
  const remove = document.querySelector<HTMLButtonElement>('[data-profile-background-remove]');
  if (remove) {
    remove.disabled = !hasBackground;
  }
}

function renderOwnSocialProfile(profile: SocialProfile): void {
  ownSocialProfile = profile;
  profileBackgroundPreviewUrl = profile.backgroundImageUrl;
  setProfileCustomizationForm(profile.customization);
  const upload = document.querySelector<HTMLButtonElement>('[data-profile-background-select]');
  const note = document.querySelector<HTMLElement>('[data-profile-premium-note]');
  if (upload) {
    upload.disabled = !profile.premium;
  }
  if (note) {
    setUiText(
      note,
      profile.premium
        ? 'Battly+ activo: puedes usar fondos PNG, JPG o GIF de hasta 5 MB.'
        : 'Las imágenes animadas o personalizadas requieren Battly+.',
    );
  }
  renderProfilePreview();
}

let profileLoadGeneration = 0;
let editableProfileUuid: string | null = null;
let profileAccounts: AccountCollection['accounts'] = [];
function loadOwnSocialProfile(): void {
  if (!editableProfileUuid) {
    return;
  }
  const generation = ++profileLoadGeneration;
  ownSocialProfile = null;
  profileBackgroundPreviewUrl = null;
  setProfileCustomizationForm(defaultProfileCustomization);
  renderProfilePreview();
  const form = profileCustomizationForm();
  const save = form?.querySelector<HTMLButtonElement>('[type="submit"]');
  if (save) {
    save.disabled = true;
  }
  form?.querySelectorAll('fieldset').forEach((field) => {
    field.disabled = true;
  });
  const status = document.querySelector<HTMLElement>('[data-profile-customization-status]');
  if (status) {
    status.textContent = 'Cargando tu perfil…';
  }
  void window.battly
    .getOwnSocialProfile(editableProfileUuid ?? undefined)
    .then((profile) => {
      if (generation !== profileLoadGeneration) {
        return;
      }
      renderOwnSocialProfile(profile);
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      if (generation !== profileLoadGeneration) {
        return;
      }
      ownSocialProfile = null;
      profileBackgroundPreviewUrl = null;
      setProfileCustomizationForm(defaultProfileCustomization);
      renderProfilePreview();
      if (status) {
        status.textContent = 'Selecciona una cuenta Battly para editar el perfil';
      }
    })
    .finally(() => {
      if (generation !== profileLoadGeneration) {
        return;
      }
      if (save) {
        save.disabled = !ownSocialProfile;
      }
      form?.querySelectorAll('fieldset').forEach((field) => {
        field.disabled = !ownSocialProfile;
      });
    });
}

let currentJvmArgsConfig: JvmArgsConfig = { byVersion: {} };

function renderJvmVersionEntries(): void {
  const list = document.querySelector<HTMLElement>('#jvm-version-args-list');
  if (!list) {
    return;
  }
  list.replaceChildren();
  const entries = Object.entries(currentJvmArgsConfig.byVersion).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  for (const [version, args] of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'b-settings-btn outline jvm-version-entry';
    const label = document.createElement('strong');
    label.textContent = version;
    const detail = document.createElement('small');
    detail.textContent = args;
    button.append(label, detail);
    button.addEventListener('click', () => {
      const versionInput = document.querySelector<HTMLInputElement>('#jvm-version-id-input');
      const argsInput = document.querySelector<HTMLTextAreaElement>('#jvm-version-args-input');
      if (versionInput) {
        versionInput.value = version;
      }
      if (argsInput) {
        argsInput.value = args;
      }
    });
    list.append(button);
  }
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'jvm-empty-state';
    empty.textContent = 'No hay argumentos personalizados por versión.';
    list.append(empty);
  }
}

async function loadJvmVersionHelpers(): Promise<void> {
  const list = document.querySelector<HTMLElement>('#jvm-version-helper-list');
  if (!list) {
    return;
  }
  list.textContent = 'Detectando versiones instaladas…';
  try {
    const snapshot = await window.battly.getPlayVersions();
    const keys = new Map<string, string>();
    for (const entry of snapshot.installed) {
      const key = entry.custom
        ? entry.id
        : `${entry.version}${entry.loader === 'vanilla' ? '' : `-${entry.loader}`}`;
      keys.set(
        key,
        playVersionLabel(entry.version, entry.loader, entry.loaderVersion, entry.custom),
      );
    }
    list.replaceChildren();
    for (const [key, label] of [...keys].sort(([left], [right]) =>
      right.localeCompare(left, undefined, { numeric: true }),
    )) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'b-settings-btn outline jvm-version-helper-item';
      const text = document.createElement('span');
      text.textContent = label;
      const tag = document.createElement('span');
      tag.textContent = key;
      button.append(text, tag);
      button.addEventListener('click', () => {
        const versionInput = document.querySelector<HTMLInputElement>('#jvm-version-id-input');
        const argsInput = document.querySelector<HTMLTextAreaElement>('#jvm-version-args-input');
        if (versionInput) {
          versionInput.value = key;
        }
        if (argsInput) {
          argsInput.value = currentJvmArgsConfig.byVersion[key] ?? '';
        }
      });
      list.append(button);
    }
    if (!keys.size) {
      list.textContent = 'No hay versiones instaladas.';
    }
  } catch {
    list.textContent = 'No se pudieron detectar las versiones instaladas.';
  }
}

async function renderInstanceJvmManager(): Promise<void> {
  const list = document.querySelector<HTMLElement>('#jvm-instance-list');
  if (!list) {
    return;
  }
  list.textContent = 'Cargando instancias…';
  try {
    const instances = await window.battly.getInstances();
    knownInstances = instances;
    list.replaceChildren();
    if (!instances.length) {
      list.textContent = 'No hay instancias creadas todavía.';
      return;
    }
    const controls = document.createElement('div');
    controls.className = 'jvm-instance-picker';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Buscar instancia…';
    search.setAttribute('aria-label', 'Buscar instancia');
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Seleccionar instancia');
    const editor = document.createElement('div');
    controls.append(search, select);
    list.append(controls, editor);
    const draw = (): void => {
      editor.replaceChildren();
      const instance = knownInstances.find((value) => value.id === select.value);
      if (!instance) {
        editor.textContent = 'No hay coincidencias.';
        return;
      }
      const existing = instance.launchProfile;
      const card = document.createElement('article');
      card.className = 'jvm-instance-item glass';
      const title = document.createElement('strong');
      setUserText(title, instance.name);
      const version = document.createElement('small');
      version.textContent = instanceLaunchLabel(instance);
      const setting = document.createElement('select');
      setting.setAttribute('aria-label', 'Ajuste');
      for (const label of ['Argumentos JVM', 'Java', 'Memoria']) {
        const option = document.createElement('option');
        option.textContent = label;
        setting.append(option);
      }
      const args = document.createElement('textarea');
      args.className = 'jvm-instance-item-args';
      args.setAttribute('aria-label', 'Argumentos JVM');
      args.placeholder = '-XX:+UseG1GC';
      args.value = existing?.jvmArgs ?? '';
      const java = document.createElement('input');
      java.value = existing?.javaPath ?? '';
      java.placeholder = 'Java';
      java.setAttribute('aria-label', 'Java');
      const browse = document.createElement('button');
      browse.type = 'button';
      browse.className = 'b-settings-btn';
      browse.textContent = 'Seleccionar Java';
      browse.addEventListener(
        'click',
        () =>
          void window.battly.selectJavaExecutable().then((value) => {
            if (value) {
              java.value = value;
            }
          }),
      );
      const javaGroup = document.createElement('div');
      javaGroup.className = 'jvm-instance-picker';
      javaGroup.append(java, browse);
      const memory = document.createElement('div');
      memory.className = 'jvm-instance-picker';
      const ramMin = document.createElement('input'),
        ramMax = document.createElement('input');
      for (const [input, label, value] of [
        [ramMin, 'RAM mínima (GB)', existing?.ramMinGb],
        [ramMax, 'RAM máxima (GB)', existing?.ramMaxGb],
      ] as const) {
        input.type = 'number';
        input.min = '0.25';
        input.step = '0.25';
        input.placeholder = label;
        input.setAttribute('aria-label', label);
        input.value = value == null ? '' : String(value);
        const wrapper = document.createElement('label');
        wrapper.textContent = label;
        wrapper.append(input);
        memory.append(wrapper);
      }
      const show = (): void => {
        args.hidden = setting.selectedIndex !== 0;
        javaGroup.hidden = setting.selectedIndex !== 1;
        memory.hidden = setting.selectedIndex !== 2;
      };
      setting.addEventListener('change', show);
      show();
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'b-settings-btn';
      save.textContent = 'Guardar instancia';
      save.addEventListener('click', () => {
        if (!ramMin.reportValidity() || !ramMax.reportValidity()) {
          return;
        }
        if (ramMin.value && ramMax.value && Number(ramMin.value) > Number(ramMax.value)) {
          ramMax.setCustomValidity(
            translateUiText('La RAM máxima debe ser mayor o igual que la mínima.'),
          );
          ramMax.reportValidity();
          ramMax.setCustomValidity('');
          return;
        }
        save.disabled = true;
        void window.battly
          .updateInstance(instance.id, {
            ...instance,
            launchProfile: {
              javaPath: java.value.trim(),
              javaVersion: java.value.trim()
                ? 'custom-path'
                : existing?.javaVersion === 'automatic'
                  ? 'automatic'
                  : 'global',
              jvmArgs: args.value.trim(),
              ramMinGb: ramMin.value ? Number(ramMin.value) : null,
              ramMaxGb: ramMax.value ? Number(ramMax.value) : null,
            },
          })
          .then((next) => {
            knownInstances = next;
            save.textContent = 'Guardado';
          })
          .catch(() => {
            save.textContent = 'Error al guardar';
          })
          .finally(() => {
            save.disabled = false;
          });
      });
      card.append(title, version, setting, args, javaGroup, memory, save);
      editor.append(card);
    };
    const filter = (): void => {
      const previous = select.value;
      select.replaceChildren();
      for (const instance of instances.filter((value) =>
        (value.name + ' ' + value.version).toLowerCase().includes(search.value.toLowerCase()),
      )) {
        const option = document.createElement('option');
        option.value = instance.id;
        setUserText(option, instance.name + ' · ' + instance.version);
        select.append(option);
      }
      if (Array.from(select.options).some((option) => option.value === previous)) {
        select.value = previous;
      }
      draw();
    };
    search.addEventListener('input', filter);
    select.addEventListener('change', draw);
    filter();
  } catch {
    list.textContent = 'No se pudieron cargar las instancias.';
  }
}

function bindJvmManagers(): void {
  const instancePanel = document.querySelector<HTMLElement>('#jvm-subpanel-instance');
  const versionPanel = document.querySelector<HTMLElement>('#jvm-subpanel-version');
  const instanceTab = document.querySelector<HTMLButtonElement>('#jvm-tab-instance');
  const versionTab = document.querySelector<HTMLButtonElement>('#jvm-tab-version');
  const show = (kind: 'instance' | 'version'): void => {
    const instanceActive = kind === 'instance' && instancePanel?.style.display !== 'block';
    const versionActive = kind === 'version' && versionPanel?.style.display !== 'block';
    if (instancePanel) {
      instancePanel.style.display = instanceActive ? 'block' : 'none';
    }
    if (versionPanel) {
      versionPanel.style.display = versionActive ? 'block' : 'none';
    }
    instanceTab?.classList.toggle('outline', !instanceActive);
    versionTab?.classList.toggle('outline', !versionActive);
    if (instanceActive) {
      void renderInstanceJvmManager();
    }
    if (versionActive) {
      void loadJvmVersionHelpers();
    }
  };
  instanceTab?.addEventListener('click', () => show('instance'));
  versionTab?.addEventListener('click', () => show('version'));
  document
    .querySelector<HTMLButtonElement>('#jvm-version-refresh-btn')
    ?.addEventListener('click', () => void loadJvmVersionHelpers());
  document
    .querySelector<HTMLButtonElement>('#jvm-version-load-btn')
    ?.addEventListener('click', () => {
      const key =
        document.querySelector<HTMLInputElement>('#jvm-version-id-input')?.value.trim() ?? '';
      const args = document.querySelector<HTMLTextAreaElement>('#jvm-version-args-input');
      if (args) {
        args.value = currentJvmArgsConfig.byVersion[key] ?? '';
      }
    });
  document
    .querySelector<HTMLButtonElement>('#jvm-version-save-btn')
    ?.addEventListener('click', () => {
      const key =
        document.querySelector<HTMLInputElement>('#jvm-version-id-input')?.value.trim() ?? '';
      const args =
        document.querySelector<HTMLTextAreaElement>('#jvm-version-args-input')?.value.trim() ?? '';
      if (!key || !args) {
        return;
      }
      void window.battly
        .saveJvmArgs({ byVersion: { ...currentJvmArgsConfig.byVersion, [key]: args } })
        .then((config) => {
          currentJvmArgsConfig = config;
          renderJvmVersionEntries();
        });
    });
  document
    .querySelector<HTMLButtonElement>('#jvm-version-remove-btn')
    ?.addEventListener('click', () => {
      const key =
        document.querySelector<HTMLInputElement>('#jvm-version-id-input')?.value.trim() ?? '';
      const next = { ...currentJvmArgsConfig.byVersion };
      delete next[key];
      void window.battly.saveJvmArgs({ byVersion: next }).then((config) => {
        currentJvmArgsConfig = config;
        renderJvmVersionEntries();
      });
    });
  document.querySelectorAll<HTMLButtonElement>('.jvm-preset-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector<HTMLTextAreaElement>('#jvm-version-args-input');
      if (input) {
        input.value = button.dataset.preset ?? '';
      }
    });
  });
  void window.battly.getJvmArgs().then((config) => {
    currentJvmArgsConfig = config;
    renderJvmVersionEntries();
  });
}

function bindLegacySettingsControls(): void {
  const slider = document.querySelector<HTMLElement>('.memory-slider');
  const left = slider?.querySelector<HTMLElement>('.slider-touch-left');
  const right = slider?.querySelector<HTMLElement>('.slider-touch-right');
  const range = slider?.querySelector<HTMLElement>('.slider-line span');
  const updateRamFromPointer = (handle: HTMLElement, clientX: number): void => {
    if (!slider || !left || !right || !range) {
      return;
    }
    const bounds = slider.getBoundingClientRect();
    const minimum = Number(slider.dataset.minimum ?? 0.5);
    const maximum = Number(slider.dataset.maximum ?? 8);
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - bounds.left - 18) / Math.max(1, bounds.width - 36)),
    );
    const rawValue = minimum + ratio * (maximum - minimum);
    const value = Math.round(rawValue * 2) / 2;
    const minimumInput = settingElement<HTMLInputElement>('ramMinGb');
    const maximumInput = settingElement<HTMLInputElement>('ramMaxGb');
    if (!minimumInput || !maximumInput) {
      return;
    }
    if (handle === left) {
      minimumInput.value = String(Math.min(value, Number(maximumInput.value) - 0.5));
    } else {
      maximumInput.value = String(Math.max(value, Number(minimumInput.value) + 0.5));
    }
    const auto = settingElement<HTMLInputElement>('autoRamEnabled');
    if (auto?.checked) {
      auto.checked = false;
      setRamInputsDisabled(false);
    }
    if (currentSettingsSnapshot) {
      renderLegacyRamSlider({
        ...currentSettingsSnapshot,
        runtime: {
          ...currentSettingsSnapshot.runtime,
          ramMinGb: Number(minimumInput.value),
          ramMaxGb: Number(maximumInput.value),
          autoRamEnabled: false,
        },
      });
    }
  };
  for (const handle of [left, right]) {
    handle?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      updateRamFromPointer(handle, event.clientX);
    });
    handle?.addEventListener('pointermove', (event) => {
      if (handle.hasPointerCapture(event.pointerId)) {
        updateRamFromPointer(handle, event.clientX);
      }
    });
  }

  const downloadPreset = document.querySelector<HTMLSelectElement>('#download-multiple-preset');
  const downloadCustom = document.querySelector<HTMLInputElement>('#download-multiple-custom');
  downloadPreset?.addEventListener('change', () => {
    if (!downloadCustom) {
      return;
    }
    const custom = downloadPreset.value === 'custom';
    downloadCustom.style.display = custom ? '' : 'none';
    if (!custom) {
      downloadPreset.value = String(Math.min(500, Math.max(1, Number(downloadPreset.value))));
    }
  });
  downloadCustom?.addEventListener('input', () => {
    if (!downloadPreset) {
      return;
    }
    const value = Math.min(500, Math.max(1, Math.round(Number(downloadCustom.value) || 1)));
    downloadCustom.value = String(value);
    downloadPreset.value = 'custom';
    downloadPreset.setAttribute('data-custom-value', String(value));
  });
  document
    .querySelector<HTMLButtonElement>('#language-selector-btn')
    ?.addEventListener('click', () => {
      document.querySelector<HTMLButtonElement>('[data-settings-save]')?.click();
    });
  const soundRadios = document.querySelectorAll<HTMLInputElement>('input[name="sound"]');
  soundRadios[1]?.addEventListener('change', () => {
    if (soundRadios[0]) {
      soundRadios[0].checked = false;
    }
  });

  const profileModal = document.querySelector<HTMLElement>('[data-profile-customization-modal]');
  const profileMenu = document.querySelector<HTMLElement>('#b-settings-profile-menu');
  const closeProfileMenu = (): void => {
    if (!profileMenu) {
      return;
    }
    profileMenu.style.display = 'none';
    profileMenu.style.visibility = 'visible';
    profileMenu.classList.remove('open-up');
  };
  document.addEventListener('click', (event) => {
    const target = event.target as Element;
    const trigger = target.closest<HTMLElement>('.b-settings-menu-trigger');
    if (trigger && profileMenu) {
      const card = trigger.closest<HTMLElement>('.b-settings-acc-card');
      if (!card) {
        return;
      }
      profileMenu.dataset.uuid = card.dataset.uuid ?? card.id;
      profileMenu.dataset.username = card.dataset.username ?? '';
      const editOption = profileMenu.querySelector<HTMLButtonElement>(
        '#b-settings-customize-profile',
      );
      if (editOption) {
        const allowed = card.dataset.accountType === 'battly';
        editOption.hidden = !allowed;
        editOption.disabled = !allowed;
      }
      const skinOption = profileMenu.querySelector<HTMLButtonElement>('[data-skin-open]');
      if (skinOption) {
        const allowed = card.dataset.accountType === 'battly';
        skinOption.hidden = !allowed;
        skinOption.disabled = !allowed;
      }
      profileMenu.style.position = 'fixed';
      profileMenu.style.visibility = 'hidden';
      profileMenu.style.display = 'block';
      const triggerBox = trigger.getBoundingClientRect();
      const menuBox = profileMenu.getBoundingClientRect();
      const gap = 8;
      const openUp = triggerBox.bottom + gap + menuBox.height > window.innerHeight - gap;
      const top = openUp
        ? Math.max(gap, triggerBox.top - menuBox.height - gap)
        : triggerBox.bottom + gap;
      const leftPosition = Math.max(
        gap,
        Math.min(
          triggerBox.left + triggerBox.width / 2 - menuBox.width / 2,
          window.innerWidth - menuBox.width - gap,
        ),
      );
      profileMenu.style.top = `${top}px`;
      profileMenu.style.left = `${leftPosition}px`;
      profileMenu.style.transform = 'none';
      profileMenu.classList.toggle('open-up', openUp);
      profileMenu.style.visibility = 'visible';
      return;
    }
    if (!target.closest('#b-settings-profile-menu, [data-guided-tutorial="settings"]')) {
      closeProfileMenu();
    }
  });
  document
    .querySelector<HTMLButtonElement>('#b-settings-copy-uuid')
    ?.addEventListener('click', () => {
      const uuid = profileMenu?.dataset.uuid ?? '';
      void copyTextToClipboard(uuid).catch(() => undefined);
      closeProfileMenu();
    });
  document
    .querySelector<HTMLButtonElement>('#b-settings-view-profile')
    ?.addEventListener('click', () => {
      const username = profileMenu?.dataset.username ?? '';
      closeProfileMenu();
      if (username) {
        showSocialProfile(username);
      }
    });
  document.querySelector<HTMLButtonElement>('#b-settings-logout')?.addEventListener(
    'click',
    voidAsyncEvent(async () => {
      const uuid = profileMenu?.dataset.uuid;
      const username = profileMenu?.dataset.username;
      closeProfileMenu();
      if (
        uuid &&
        (await askBattly({
          text: username
            ? `¿Eliminar la cuenta ${username} de Battly?`
            : '¿Eliminar esta cuenta de Battly?',
        }))
      ) {
        runAccountAction(() => window.battly.removeAccount(uuid));
      }
    }),
  );
  const openProfileCustomization = (): void => {
    const account = profileAccounts.find((item) => item.uuid === profileMenu?.dataset.uuid);
    if (account?.type !== 'battly') {
      return;
    }
    editableProfileUuid = account.uuid;
    profileModal?.classList.add('is-active');
    profileModal?.setAttribute('aria-hidden', 'false');
    loadOwnSocialProfile();
  };
  const closeProfileCustomization = (): void => {
    profileLoadGeneration += 1;
    profileModal?.classList.remove('is-active');
    profileModal?.setAttribute('aria-hidden', 'true');
  };
  document
    .querySelector<HTMLButtonElement>('#b-profile-modal-close')
    ?.addEventListener('click', closeProfileCustomization);
  profileModal
    ?.querySelector<HTMLElement>('.modal-background')
    ?.addEventListener('click', closeProfileCustomization);
  document
    .querySelector<HTMLButtonElement>('#b-settings-customize-profile')
    ?.addEventListener('click', () => {
      closeProfileMenu();
      openProfileCustomization();
    });
  document.querySelectorAll<HTMLButtonElement>('.custom-tab[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.section;
      document
        .querySelectorAll<HTMLButtonElement>('.custom-tab')
        .forEach((tab) => tab.classList.toggle('active', tab === button));
      document
        .querySelectorAll<HTMLElement>('.controls-section')
        .forEach((controls) =>
          controls.classList.toggle('active', controls.id === `${section}-controls-section`),
        );
    });
  });
  const legacyProfileControls = [
    '#border-color-picker',
    '#border-color-text',
    '#border-style-select',
    '#border-width-slider',
    '#name-color-picker',
    '#name-color-text',
    '#bg-color-picker',
    '#bg-color-text',
  ];
  legacyProfileControls.forEach((selector) => {
    document
      .querySelector<HTMLInputElement | HTMLSelectElement>(selector)
      ?.addEventListener('input', () => {
        const pairs = [
          ['#border-color-picker', '#border-color-text'],
          ['#name-color-picker', '#name-color-text'],
          ['#bg-color-picker', '#bg-color-text'],
        ] as const;
        for (const [pickerSelector, textSelector] of pairs) {
          const picker = document.querySelector<HTMLInputElement>(pickerSelector);
          const text = document.querySelector<HTMLInputElement>(textSelector);
          if (!picker || !text) {
            continue;
          }
          if (selector === pickerSelector) {
            text.value = picker.value;
          }
          if (selector === textSelector && /^#[0-9a-f]{6}$/i.test(text.value)) {
            picker.value = text.value;
          }
        }
        const width = document.querySelector<HTMLInputElement>('#border-width-slider');
        const output = document.querySelector<HTMLElement>('#border-width-value');
        if (width && output) {
          output.textContent = width.value;
        }
        renderProfilePreview();
      });
  });
  document.querySelector<HTMLButtonElement>('.slider-minus')?.addEventListener('click', () => {
    const slider = document.querySelector<HTMLInputElement>('#border-width-slider');
    if (!slider) {
      return;
    }
    slider.value = String(Math.max(Number(slider.min), Number(slider.value) - 1));
    slider.dispatchEvent(new Event('input'));
  });
  document.querySelector<HTMLButtonElement>('.slider-plus')?.addEventListener('click', () => {
    const slider = document.querySelector<HTMLInputElement>('#border-width-slider');
    if (!slider) {
      return;
    }
    slider.value = String(Math.min(Number(slider.max), Number(slider.value) + 1));
    slider.dispatchEvent(new Event('input'));
  });
  document
    .querySelector<HTMLButtonElement>('#reset-customization-btn')
    ?.addEventListener('click', () => {
      setProfileCustomizationForm(defaultProfileCustomization);
      profileBackgroundPreviewUrl = null;
      renderProfilePreview();
    });
}

function bindSettings(): void {
  bindLegacySettingsControls();
  const settingsRoot = document.querySelector<HTMLElement>('[data-panel-view="settings"]');
  if (settingsRoot) {
    for (const selector of ['#b-settings-customize-profile', '#b-settings-skin']) {
      const badge = document.createElement('span');
      badge.className = 'battly-new-tag';
      setUiText(badge, 'Nuevo');
      settingsRoot.querySelector(selector)?.append(badge);
    }
    const settingsTourSession = tutorialSession();
    let settingsTourPage = 'accounts';
    let settingsTourGroup: HTMLButtonElement | null = null;
    mountGuidedTutorial({
      id: 'settings',
      label: 'Tutorial de ajustes',
      root: settingsRoot,
      storageKey: 'battly.settings-tutorial.v1',
      replayHost: '#bottom_bar_settings',
      onStart: () => {
        settingsTourSession.start();
        settingsTourGroup = settingsRoot.querySelector<HTMLButtonElement>(
          '.settings-subnav [aria-pressed="true"]',
        );
        settingsTourPage =
          settingsRoot.querySelector<HTMLElement>('[data-settings-tab].is-active')?.dataset
            .settingsTab ?? 'accounts';
      },
      onFinish: () => {
        settingsTourSession.finish();
        settingsTourGroup?.click();
        settingsRoot
          .querySelector<HTMLButtonElement>('[data-settings-tab="' + settingsTourPage + '"]')
          ?.click();
      },
      promptTitle: 'Configura Battly a tu gusto',
      promptText: 'Tus cuentas, temas y opciones de juego.',
      steps: [
        {
          title: 'Tus cuentas de Minecraft y Battly',
          text: 'Selecciona una cuenta para jugar. Puedes añadir cuentas sin cerrar las que ya tienes.',
          selector: '.b-settings-acc-list',
          onEnter: () =>
            document.querySelector<HTMLButtonElement>('[data-settings-tab="accounts"]')?.click(),
        },
        {
          title: 'Más opciones para cada cuenta',
          text: 'Pulsa la flecha junto a la cuenta. Aquí puedes ver el perfil, copiar el UUID y personalizar tu perfil y skin de Battly.',
          selector: '#b-settings-profile-menu',
          onEnter: () => {
            settingsRoot
              .querySelector<HTMLButtonElement>('[data-settings-tab="accounts"]')
              ?.click();
            (
              settingsRoot.querySelector<HTMLButtonElement>(
                '.b-settings-acc-card[data-account-type="battly"] .account-options',
              ) ?? settingsRoot.querySelector<HTMLButtonElement>('.account-options')
            )?.click();
          },
          onLeave: () => {
            const menu = settingsRoot.querySelector<HTMLElement>('#b-settings-profile-menu');
            if (menu) {
              menu.style.display = 'none';
            }
          },
        },
        {
          title: 'Tus temas y sonidos',
          text: 'Elige un tema o crea el tuyo. Con Battly+ puedes subir tu propio sonido de inicio.',
          selector: '[data-settings-view="appearance"]',
          onEnter: () =>
            document.querySelector<HTMLButtonElement>('[data-settings-tab="appearance"]')?.click(),
        },
        ...[
          [
            'java',
            'Java para Minecraft',
            'Consulta los runtimes disponibles y elige cuál utilizar. El tutorial no cambiará tu selección.',
          ],
          [
            'ram',
            'Memoria para jugar',
            'Ajusta la memoria según tu equipo y la versión que vayas a iniciar.',
          ],
          [
            'launcher',
            'Comportamiento de Battly',
            'Revisa las opciones de inicio y funcionamiento del launcher.',
          ],
        ].map(([tab, title, text]) => ({
          selector: '[data-settings-view="' + tab + '"]',
          title,
          text,
          onEnter: () => {
            settingsRoot
              .querySelector<HTMLButtonElement>('[data-settings-tab="' + tab + '"]')
              ?.click();
          },
        })),
        ...[
          [
            'Pantalla',
            'Ventana de Minecraft',
            'Configura el tamaño de la ventana de Minecraft y cómo quieres abrirla.',
          ],
          ['Battly Worlds', 'Battly Worlds', 'Revisa las preferencias para compartir tus mundos.'],
          ['Audio', 'Sonidos de Battly', 'Aquí eliges los sonidos y la música del launcher.'],
          [
            'Descargas y archivos',
            'Archivos y almacenamiento',
            'Revisa la ubicación de tus archivos y las opciones de descarga.',
          ],
          [
            'Mundos',
            'Sincronización de mundos',
            'Consulta las opciones de sincronización de tus mundos.',
          ],
          [
            'Privacidad',
            'Privacidad',
            'Decide qué información compartes y revisa tus preferencias de privacidad.',
          ],
          [
            'Registros',
            'Tus registros',
            'Abre los registros cuando necesites revisar un error o pedir ayuda.',
          ],
          [
            'Actualizaciones',
            'Actualizaciones de Battly',
            'Consulta el estado de las actualizaciones y elige entre el canal estable y beta.',
          ],
        ].map(([group, title, text]) => ({
          selector: '[data-settings-group="' + group + '"]',
          title,
          text,
          onEnter: () => {
            settingsRoot
              .querySelector<HTMLButtonElement>('[data-settings-tab="launcher"]')
              ?.click();
            const section = settingsRoot.querySelector<HTMLElement>(
              '[data-settings-group="' + group + '"]',
            );
            if (section) {
              settingsRoot
                .querySelector<HTMLButtonElement>('[aria-controls="' + section.id + '"]')
                ?.click();
            }
          },
        })),
        {
          title: 'Guarda tus cambios',
          text: 'Pulsa Guardar para conservar tu configuración. Puedes repetir este tutorial cuando quieras.',
          selector: '[data-settings-save]',
        },
      ],
    });
  }
  bindJvmManagers();
  bindSettingsLogReader();
  document
    .querySelectorAll<HTMLButtonElement>('[data-panel="settings"]')
    .forEach((button) => button.addEventListener('click', loadSettings));
  const settingsMoreToggle = document.querySelector<HTMLButtonElement>(
    '[data-settings-more-toggle]',
  );
  const settingsMoreMenu = document.querySelector<HTMLElement>('[data-settings-more-menu]');
  settingsMoreToggle?.addEventListener('click', () => {
    if (!settingsMoreMenu) {
      return;
    }
    const expanded = settingsMoreToggle.getAttribute('aria-expanded') === 'true';
    settingsMoreToggle.setAttribute('aria-expanded', String(!expanded));
    settingsMoreMenu.hidden = expanded;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.settingsTab;
      if (target === 'appearance') {
        void loadThemeLibrary();
      }
      if (target === 'profile') {
        loadOwnSocialProfile();
      }
      document.querySelector<HTMLElement>('.b-settings-pages')?.scrollTo({ top: 0 });
      document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.classList.toggle('b-settings-active', active);
      });
      if (settingsMoreMenu?.contains(button)) {
        settingsMoreMenu.hidden = true;
        settingsMoreToggle?.setAttribute('aria-expanded', 'false');
      }
      const heading = document.querySelector<HTMLElement>('[data-settings-heading]');
      const settingsHeadings: Record<string, string> = {
        accounts: 'Mis cuentas',
        appearance: 'Personalizar Battly',
        java: 'Configuración de Java',
        ram: 'Configuración de RAM',
        launcher: 'Configuración de Battly',
        privacy: 'Privacidad',
        profile: 'Perfil',
        drive: 'Google Drive',
        diagnostics: 'Diagnóstico',
        updates: 'Actualizaciones',
      };
      if (heading) {
        heading.removeAttribute('data-string-id');
        setUiText(heading, settingsHeadings[target ?? ''] ?? 'Ajustes');
      }
      document.querySelectorAll<HTMLElement>('[data-settings-view]').forEach((page) => {
        const active = page.dataset.settingsView === target;
        page.hidden = !active;
        page.classList.toggle('is-active', active);
        page.style.display = active ? 'block' : 'none';
      });
    });
  });
  settingElement<HTMLInputElement>('presenceShareStatus')?.addEventListener('change', (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    const server = settingElement<HTMLInputElement>('presenceShareServer');
    if (server) {
      server.disabled = !enabled;
      if (!enabled) {
        server.checked = false;
      }
    }
  });
  settingElement<HTMLInputElement>('discordShareStatus')?.addEventListener('change', (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    const server = settingElement<HTMLInputElement>('discordShareServer');
    if (server) {
      server.disabled = !enabled;
      if (!enabled) {
        server.checked = false;
      }
    }
  });
  document.querySelector<HTMLButtonElement>('[data-accounts-remove-all]')?.addEventListener(
    'click',
    voidAsyncEvent(async () => {
      if (
        await askBattly({
          text: '¿Cerrar sesión en todas las cuentas? Se eliminarán sus credenciales guardadas de Battly.',
        })
      ) {
        runAccountAction(() => window.battly.removeAllAccounts());
      }
    }),
  );
  settingElement<HTMLInputElement>('autoRamEnabled')?.addEventListener('change', (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    setRamInputsDisabled(enabled);
    if (!currentSettingsSnapshot) {
      return;
    }
    const recommendation = currentSettingsSnapshot.autoRamRecommendation;
    if (enabled) {
      const minimum = settingElement<HTMLInputElement>('ramMinGb');
      const maximum = settingElement<HTMLInputElement>('ramMaxGb');
      if (minimum) {
        minimum.value = String(recommendation.minimumGb);
      }
      if (maximum) {
        maximum.value = String(recommendation.maximumGb);
      }
    }
    renderAutoRamStatus(currentSettingsSnapshot, enabled);
  });
  document.querySelector<HTMLButtonElement>('[data-java-select]')?.addEventListener('click', () => {
    const status = document.querySelector<HTMLElement>('[data-java-status]');
    if (status) {
      status.textContent = 'Abriendo selector de Java…';
    }
    void window.battly
      .selectJavaExecutable()
      .then((path) => {
        if (!path) {
          if (status) {
            status.textContent = 'Selección cancelada';
          }
          return;
        }
        const input = settingElement<HTMLInputElement>('javaPath');
        if (input) {
          input.value = path;
        }
        if (status) {
          status.textContent = 'Ejecutable seleccionado. Guarda los ajustes para aplicarlo.';
        }
      })
      .catch(() => {
        if (status) {
          status.textContent = 'No se pudo seleccionar ese ejecutable';
        }
      });
  });
  document
    .querySelector<HTMLButtonElement>('[data-java-automatic]')
    ?.addEventListener('click', () => {
      const input = settingElement<HTMLInputElement>('javaPath');
      const status = document.querySelector<HTMLElement>('[data-java-status]');
      if (input) {
        input.value = '';
      }
      if (status) {
        status.textContent = 'Se usará la detección automática del core al guardar.';
      }
    });
  document
    .querySelector<HTMLButtonElement>('[data-managed-java-clear]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-managed-java-status]');
      void window.battly
        .clearManagedJava()
        .then((snapshot) => {
          renderManagedJava(snapshot);
          const input = settingElement<HTMLInputElement>('javaPath');
          if (input) {
            input.value = '';
          }
          if (status) {
            status.textContent = 'Se usará la detección automática del core.';
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo limpiar la selección de Java';
          }
        });
    });
  const javaDialog = document.querySelector<HTMLElement>('#b-java-download-modal');
  const closeJavaDialog = (): void => {
    hideLegacyModal(javaDialog);
    pendingManagedJavaMajor = null;
  };
  javaDialog
    ?.querySelectorAll<HTMLButtonElement>('#b-java-modal-close, #b-java-modal-cancel')
    .forEach((button) => button.addEventListener('click', closeJavaDialog));
  javaDialog
    ?.querySelector<HTMLButtonElement>('#b-java-modal-download')
    ?.addEventListener('click', () => {
      const major = pendingManagedJavaMajor;
      if (!major) {
        return;
      }
      const wrap = javaDialog.querySelector<HTMLElement>('#b-java-progress-wrap');
      const warning = javaDialog.querySelector<HTMLElement>('#b-java-warning');
      const status = javaDialog.querySelector<HTMLElement>('#b-java-progress-text');
      const download = javaDialog.querySelector<HTMLButtonElement>('#b-java-modal-download');
      const cancel = javaDialog.querySelector<HTMLButtonElement>('#b-java-modal-cancel');
      if (wrap) {
        wrap.style.display = 'block';
      }
      if (warning) {
        warning.style.display = 'block';
      }
      if (status) {
        status.removeAttribute('data-string-id');
        setUiText(status, `Preparando Java ${major}…`);
      }
      if (download) {
        download.disabled = true;
      }
      if (cancel) {
        cancel.disabled = true;
      }
      void installAndSelectManagedJava(
        major,
        normalizeJavaRuntimeProvider(
          javaDialog.querySelector<HTMLSelectElement>('#b-java-provider')?.value,
        ),
      )
        .then((snapshot) => {
          renderManagedJava(snapshot);
          const selected = snapshot.runtimes.find(({ selected }) => selected);
          const input = settingElement<HTMLInputElement>('javaPath');
          if (input && selected?.path) {
            input.value = selected.path;
          }
          if (status) {
            setUiText(status, `Java ${major} instalado correctamente`);
          }
          window.setTimeout(closeJavaDialog, 800);
        })
        .catch((error: unknown) => {
          if (status) {
            status.textContent =
              error instanceof Error ? error.message : `No se pudo descargar Java ${major}`;
          }
          if (download) {
            download.disabled = false;
          }
          if (cancel) {
            cancel.disabled = false;
          }
        });
    });
  window.battly.onManagedJavaProgress(renderManagedJavaProgress);
  document.querySelector<HTMLButtonElement>('[data-battly-data-root-change]')?.addEventListener(
    'click',
    voidAsyncEvent(async () => {
      const status = document.querySelector<HTMLElement>('[data-battly-data-root-status]');
      const button = document.querySelector<HTMLButtonElement>('[data-battly-data-root-change]');
      if (
        !(await askBattly({
          text: 'Battly copiará todos sus datos a una carpeta vacía, conservará el origen y se reiniciará. ¿Continuar?',
        }))
      ) {
        return;
      }
      if (button) {
        button.disabled = true;
      }
      if (status) {
        status.textContent = 'Selecciona una carpeta vacía…';
      }
      const progressDialog = showDataRootMigration();
      const unsubscribe = window.battly.onDataRootProgress((progress) =>
        progressDialog.update(progress),
      );
      void window.battly
        .migrateBattlyDataRoot()
        .then((snapshot) => {
          if (!snapshot) {
            progressDialog.remove();
            if (status) {
              status.textContent = 'Migración cancelada.';
            }
            if (button) {
              button.disabled = false;
            }
            return;
          }
          const input = document.querySelector<HTMLInputElement>('[data-battly-data-root]');
          if (input) {
            input.value = snapshot.currentPath;
          }
          if (status) {
            status.textContent = 'Datos copiados. Battly se reiniciará ahora.';
          }
        })
        .catch((error: unknown) => {
          progressDialog.error(error);
          if (status) {
            setUiText(status, 'No se pudo completar el traslado. La carpeta original se conserva.');
          }
          if (button) {
            button.disabled = false;
          }
        })
        .finally(unsubscribe);
    }),
  );
  document
    .querySelector<HTMLButtonElement>('[data-settings-save]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-settings-status]');
      const draft = settingsDraft();
      if (!currentSettingsSnapshot?.googleDriveConnected) {
        draft.autoSyncEnabled = false;
      }
      if (status) {
        status.textContent = 'Guardando…';
      }
      void window.battly
        .saveSettings(draft)
        .then(async (snapshot) => {
          renderSettings(snapshot);
          await applyVisualPreferences(snapshot.visual);
          if (status) {
            status.textContent = 'Ajustes guardados';
          }
          showToast('Ajustes guardados', 'Los cambios se aplicaron correctamente.', 'success');
          await activatePanel('home');
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error && error.message === worldsShortcutConflict
              ? worldsShortcutConflict
              : 'Revisa los valores e inténtalo de nuevo.';
          if (status) {
            status.textContent = 'No se pudieron guardar los ajustes';
          }
          showToast('No se pudieron guardar los ajustes', message, 'error');
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-simple-mode-exit]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const simpleMode = settingElement<HTMLInputElement>('simpleMode');
      if (simpleMode) {
        simpleMode.checked = false;
      }
      button.disabled = true;
      button.textContent = 'Saliendo…';
      void window.battly
        .saveSettings(settingsDraft())
        .then((snapshot) => {
          renderSettings(snapshot);
          button.innerHTML =
            '<i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Salir modo simple';
        })
        .finally(() => {
          button.disabled = false;
        });
    });
  document
    .querySelector<HTMLFormElement>('[data-profile-customization-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = profileCustomizationForm();
      const status = document.querySelector<HTMLElement>('[data-profile-customization-status]');
      const save = form?.querySelector<HTMLButtonElement>('[type="submit"]');
      if (!form || !save || save.disabled || !editableProfileUuid) {
        return;
      }
      const generation = profileLoadGeneration;
      const accountUuid = editableProfileUuid;
      const draft = profileCustomizationDraft();
      save.disabled = true;
      if (status) {
        status.textContent = 'Guardando cambios…';
      }
      void window.battly
        .updateSocialProfile(draft, accountUuid)
        .then(() => window.battly.getOwnSocialProfile(accountUuid))
        .then((profile) => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          const stored = profile.customization;
          if (
            Object.entries(draft).some(
              ([key, value]) => stored[key as keyof ProfileCustomization] !== value,
            )
          ) {
            throw new Error(
              'El servidor no ha conservado todos los cambios. Tu selección sigue aquí para reintentarlo.',
            );
          }
          ownSocialProfile = profile;
          if (status) {
            status.textContent = 'Cambios guardados';
          }
          renderProfilePreview();
        })
        .catch((error) => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          if (status) {
            status.textContent =
              error instanceof Error
                ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
                : 'No se pudieron guardar los cambios. Inténtalo de nuevo.';
          }
        })
        .finally(() => {
          if (generation === profileLoadGeneration) {
            save.disabled = false;
          }
        });
    });
  profileCustomizationForm()
    ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
    .forEach((control) => control.addEventListener('input', renderProfilePreview));
  document.querySelectorAll<HTMLButtonElement>('[data-profile-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = profilePresets[button.dataset.profilePreset ?? ''];
      if (!preset) {
        return;
      }
      setProfileCustomizationForm({
        ...preset,
        backgroundImage: profileCustomizationDraft().backgroundImage,
      });
      renderProfilePreview();
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-profile-background-select]')
    ?.addEventListener('click', () => {
      if (!editableProfileUuid) {
        return;
      }
      const generation = profileLoadGeneration;
      const status = document.querySelector<HTMLElement>('[data-profile-customization-status]');
      if (status) {
        status.textContent = 'Selecciona una imagen de hasta 5 MB…';
      }
      void window.battly
        .selectSocialProfileBackground(editableProfileUuid ?? undefined)
        .then((selection) => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          if (!selection) {
            if (status) {
              status.textContent = 'Selección cancelada';
            }
            return;
          }
          const input = profileCustomizationForm()?.elements.namedItem('backgroundImage');
          if (input instanceof HTMLInputElement) {
            input.value = selection.value;
          } else {
            const legacyInput = document.querySelector<HTMLInputElement>(
              '[data-profile-background-value]',
            );
            if (legacyInput) {
              legacyInput.value = selection.value;
            }
          }
          profileBackgroundPreviewUrl = selection.previewUrl;
          renderProfilePreview();
          if (status) {
            status.textContent = 'Imagen subida. Guarda el perfil para aplicarla.';
          }
        })
        .catch(() => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          if (status) {
            status.textContent = 'No se pudo subir la imagen de perfil';
          }
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-profile-background-remove]')
    ?.addEventListener('click', () => {
      if (!editableProfileUuid) {
        return;
      }
      const generation = profileLoadGeneration;
      const status = document.querySelector<HTMLElement>('[data-profile-customization-status]');
      if (status) {
        status.textContent = 'Quitando imagen…';
      }
      void window.battly
        .removeSocialProfileBackground(editableProfileUuid ?? undefined)
        .then(() => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          const input = profileCustomizationForm()?.elements.namedItem('backgroundImage');
          if (input instanceof HTMLInputElement) {
            input.value = '';
          } else {
            const legacyInput = document.querySelector<HTMLInputElement>(
              '[data-profile-background-value]',
            );
            if (legacyInput) {
              legacyInput.value = '';
            }
          }
          profileBackgroundPreviewUrl = null;
          renderProfilePreview();
          if (status) {
            status.textContent = 'Imagen eliminada';
          }
        })
        .catch(() => {
          if (generation !== profileLoadGeneration) {
            return;
          }
          if (status) {
            status.textContent = 'No se pudo quitar la imagen';
          }
        });
    });
  document.querySelector<HTMLButtonElement>('[data-drive-sync]')?.addEventListener('click', () => {
    void (async () => {
      const status = document.querySelector<HTMLElement>('[data-drive-status]');
      if (!(await window.battly.getDriveState().catch(() => ({ connected: false }))).connected) {
        if (status) {
          status.textContent = 'Conecta Google Drive para sincronizar tus mundos';
        }
        const accepted = await askBattly({
          title: 'Battly × Google Drive',
          text: 'Battly abrirá la autorización oficial de Google. No se activará la sincronización ni se guardará nada hasta que Google devuelva credenciales válidas.',
          cancelText: 'Ahora no',
          confirmText: 'Iniciar sesión',
        });
        if (!accepted) {
          const autoSync = settingElement<HTMLInputElement>('autoSyncEnabled');
          if (autoSync) {
            autoSync.checked = false;
          }
          if (status) {
            status.textContent = 'Conecta Google Drive antes de sincronizar';
          }
          return;
        }
        if (status) {
          status.textContent = 'Completa la autorización en Google…';
        }
        try {
          await authorizeGoogleDrive();
          renderSettings(await window.battly.getSettings());
          if (status) {
            status.textContent = 'Cuenta de Google conectada';
          }
        } catch (error) {
          if (status) {
            status.textContent =
              error instanceof Error ? error.message : 'No se pudo conectar Google';
          }
        }
        return;
      }
      if (status) {
        status.textContent = 'Sincronizando…';
      }
      void window.battly
        .syncGoogleDrive()
        .then((result) => {
          if (!status) {
            return;
          }
          status.textContent = result.success
            ? `${result.count} copias sincronizadas`
            : result.reason === 'no_tokens'
              ? 'Conecta Google Drive desde Battly para sincronizar'
              : 'La sesión de Google Drive ha caducado';
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo sincronizar con Google Drive';
          }
        });
    })();
  });
  window.addEventListener('battly:drive-changed', () => {
    void window.battly.getSettings().then(renderSettings);
  });
  document
    .querySelector<HTMLButtonElement>('[data-diagnostic-save]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-diagnostic-status]');
      if (status) {
        status.textContent = 'Preparando informe…';
      }
      void window.battly
        .saveDiagnosticReport()
        .then((result) => {
          if (status) {
            status.textContent = result.saved ? 'Informe guardado' : 'Guardado cancelado';
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo guardar el informe';
          }
        });
    });
}

function readableLaunchLog(content: string): string {
  return formatCrashLog(content);
}

function bindSettingsLogReader(): void {
  mountSettingsLogReader({ format: readableLaunchLog, render: renderLogLines, locale: uiLocale });
}

function closeAccountDropdown(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-account-trigger]');
  const dropdown = document.querySelector<HTMLElement>('[data-account-dropdown]');
  trigger?.setAttribute('aria-expanded', 'false');
  if (dropdown) {
    dropdown.hidden = true;
    dropdown.classList.remove('show');
  }
}

function runAccountAction(action: () => Promise<AccountCollection>): void {
  document.body.dataset.accountAction = 'pending';
  void action()
    .then((collection) => {
      renderAccountCollection(collection);
      document.body.dataset.accountAction = 'ready';
      if (collection.accounts.length === 0) {
        void activatePanel('login');
      }
    })
    .catch(() => {
      document.body.dataset.accountAction = 'error';
    });
}

let accountRenderRevision = 0;
let ownAccountNames = new Set<string>();
let realtimeAccountKey = '';
let realtimeAccountQueue: Promise<void> = Promise.resolve();
function syncAccountRealtime(collection: AccountCollection): void {
  const identity =
    collection.accounts.find((account) => account.type === 'battly' && account.selected) ??
    collection.accounts.find((account) => account.type === 'battly');
  const key = identity?.uuid ?? '';
  if (key === realtimeAccountKey) {
    return;
  }
  realtimeAccountKey = key;
  window.dispatchEvent(new Event('battly:account-changed'));
  realtimeAccountQueue = realtimeAccountQueue
    .catch(() => undefined)
    .then(async () => {
      if (key !== realtimeAccountKey) {
        return;
      }
      if (!key) {
        await window.battly.stopSocialRealtime();
        return;
      }
      try {
        await window.battly.startSocialRealtime();
      } catch {
        if (key === realtimeAccountKey) {
          realtimeAccountKey = '';
        }
      }
    });
}
function renderAccountCollection(collection: AccountCollection): void {
  rendererHasAccount = collection.accounts.length > 0;
  document.body.dataset.accountAccess = rendererHasAccount ? 'allowed' : 'required';
  const back = document.querySelector<HTMLButtonElement>('[data-login-back]');
  if (back) {
    back.hidden = !rendererHasAccount;
    back.disabled = !rendererHasAccount;
  }
  if (!rendererHasAccount && !document.querySelector('[data-panel-view="news"].is-active')) {
    setActivePanel('login');
  }
  syncAccountRealtime(collection);
  accountRenderRevision += 1;
  const skinRevision = accountRenderRevision;
  ownAccountNames = new Set(collection.accounts.map((account) => account.name.toLowerCase()));
  const visibleAccounts = collection.accounts;
  const selector = document.querySelector<HTMLElement>('[data-account-selector]');
  const currentName = document.querySelector<HTMLElement>('[data-current-username]');
  const accountList = document.querySelector<HTMLElement>('[data-account-list]');
  const settingsList = document.querySelector<HTMLElement>('[data-settings-account-list]');
  const selected = visibleAccounts.find((account) => account.selected) ?? null;
  const musicAccount =
    selected?.type === 'battly'
      ? selected
      : (visibleAccounts.find(
          (account) => account.type === 'battly' && account.name === selected?.name,
        ) ?? visibleAccounts.find((account) => account.type === 'battly'));
  musicInviteRefresh.setAccount(musicAccount?.uuid ?? null);
  void musicInviteRefresh.refresh().catch(() => {});

  const nextEditableUuid = selected?.type === 'battly' ? selected.uuid : null;
  if (editableProfileUuid !== nextEditableUuid) {
    profileLoadGeneration += 1;
    ownSocialProfile = null;
    const profileDialog = document.querySelector<HTMLElement>('[data-profile-customization-modal]');
    profileDialog?.classList.remove('is-active');
    profileDialog?.setAttribute('aria-hidden', 'true');
  }
  editableProfileUuid = nextEditableUuid;
  profileAccounts = collection.accounts;
  setSkinCustomizerAccount(selected, collection.accounts);
  if (selector) {
    selector.hidden = visibleAccounts.length === 0;
  }
  if (currentName) {
    currentName.textContent = selected?.name ?? 'Seleccionar cuenta';
  }
  const avatar = document.querySelector<HTMLElement>('.user-avatar-container');
  if (avatar) {
    if (selected) {
      avatar.style.backgroundImage = `url(${JSON.stringify(
        window.battly.skinImageUrl(selected.name),
      )})`;
      avatar.dataset.state = 'ready';
    } else {
      avatar.style.removeProperty('background-image');
      avatar.dataset.state = 'empty';
    }
  }
  applyPremiumPresentation(collection);

  accountList?.replaceChildren();
  settingsList?.replaceChildren();
  for (const account of visibleAccounts) {
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = `account-list-item${account.selected ? ' selected' : ''}`;
    const accountFace = document.createElement('div');
    accountFace.className = 'mc-face-viewer-4x';
    accountFace.style.backgroundImage = `url(${JSON.stringify(
      window.battly.skinImageUrl(account.name),
    )})`;
    const accountLabel = document.createElement('span');
    setUserText(accountLabel, account.name);
    accountLabel.className = 'account-list-name';
    const accountType = document.createElement('span');
    accountType.className = `account-type-badge is-${account.type}`;
    setUiText(
      accountType,
      account.type === 'microsoft'
        ? 'Microsoft'
        : account.type === 'battly'
          ? account.premium
            ? 'Battly+'
            : 'Battly'
          : 'Local',
    );
    const identityLabel = document.createElement('span');
    identityLabel.className = 'account-list-identity';
    identityLabel.append(accountLabel, accountType);
    selectButton.append(accountFace, identityLabel);
    selectButton.setAttribute('aria-pressed', String(account.selected));
    selectButton.addEventListener('click', () => {
      closeAccountDropdown();
      if (!account.selected) {
        runAccountAction(() => window.battly.selectAccount(account.uuid));
      }
    });
    accountList?.append(selectButton);

    const row = document.createElement('div');
    row.className = `b-settings-acc-card${account.selected ? ' active-account' : ''}`;
    row.id = account.uuid;
    row.dataset.uuid = account.uuid;
    row.dataset.username = account.name;
    row.dataset.accountType = account.type;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', String(account.selected));
    const identity = document.createElement('div');
    identity.style.display = 'flex';
    identity.style.alignItems = 'center';
    identity.style.gap = '20px';
    const accountImage = document.createElement('div');
    accountImage.className = 'account-image mc-face-viewer-8x';
    accountImage.dataset.offline = String(account.type === 'offline');
    accountImage.style.backgroundImage = `url(${JSON.stringify(window.battly.skinImageUrl(account.name))})`;
    if (account.type === 'microsoft') {
      void window.battly
        .getAccountSkinUrl(account.uuid)
        .then((url) => {
          if (!url || skinRevision !== accountRenderRevision) {
            return;
          }
          const background = `url(${JSON.stringify(url)})`;
          accountImage.style.backgroundImage = background;
          accountFace.style.backgroundImage = background;
          if (account.selected && avatar) {
            avatar.style.backgroundImage = background;
          }
        })
        .catch(() => undefined);
    }
    const accountName = document.createElement('div');
    accountName.className = 'account-name';
    accountName.id = 'user-name';
    accountName.append(document.createTextNode(account.name));
    if (account.premium) {
      const premium = document.createElement('i');
      premium.className = 'fa-solid fa-fire';
      premium.style.cursor = 'pointer';
      premium.style.marginLeft = '5px';
      accountName.append(premium);
    }
    if (account.type === 'offline') {
      const offline = document.createElement('i');
      offline.className = 'fa-solid fa-cube';
      offline.style.cursor = 'pointer';
      offline.style.marginLeft = '5px';
      accountName.append(offline);
    }
    identity.append(accountImage, accountName);
    const trigger = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trigger.classList.add('b-settings-menu-trigger');
    trigger.setAttribute('viewBox', '0 0 24 24');
    trigger.setAttribute('width', '18');
    trigger.setAttribute('height', '18');
    trigger.setAttribute('stroke', '#FFFFFF');
    trigger.setAttribute('stroke-width', '2');
    trigger.setAttribute('fill', 'none');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', `Opciones de ${account.name}`);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M9 5l7 7-7 7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    trigger.append(path);
    const optionsButton = document.createElement('button');
    optionsButton.type = 'button';
    optionsButton.className = 'b-settings-menu-trigger account-options';
    optionsButton.setAttribute('aria-label', `Opciones de ${account.name}`);
    optionsButton.setAttribute('aria-haspopup', 'menu');
    trigger.classList.remove('b-settings-menu-trigger');
    trigger.removeAttribute('role');
    trigger.removeAttribute('aria-label');
    trigger.setAttribute('aria-hidden', 'true');
    optionsButton.append(trigger);
    if (account.type === 'battly') {
      const badge = document.createElement('span');
      badge.className = 'battly-new-tag';
      setUiText(badge, 'Nuevo');
      optionsButton.prepend(badge);
    }
    row.append(identity, optionsButton);
    const selectAccount = (): void => {
      if (!account.selected) {
        runAccountAction(() => window.battly.selectAccount(account.uuid));
      }
    };
    row.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.b-settings-menu-trigger, .fa-fire, .fa-cube')) {
        return;
      }
      selectAccount();
    });
    row.addEventListener('keydown', (event) => {
      if ((event.target as Element).closest('.account-options')) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        selectAccount();
      }
    });
    settingsList?.append(row);
  }
  if (selected?.type === 'battly') {
    void window.battly
      .getSkins()
      .then((skins) => {
        if (skinRevision !== accountRenderRevision) {
          return;
        }
        const current = collection.accounts.find((account) => account.selected);
        if (!avatar || current?.uuid !== selected.uuid) {
          return;
        }
        avatar.style.backgroundImage = `url("${skins.currentSkinUrl.replaceAll('"', '%22')}")`;
        avatar.dataset.state = 'ready';
      })
      .catch(() => {
        if (avatar && skinRevision === accountRenderRevision) {
          avatar.dataset.state = 'fallback';
        }
      });
  }
}

async function renderAccounts(): Promise<void> {
  const revision = accountRenderRevision;
  try {
    const accounts = await window.battly.getAccounts();
    if (revision !== accountRenderRevision) {
      return;
    }
    renderAccountCollection(accounts);
    document.body.dataset.accounts = 'ready';
  } catch {
    if (revision !== accountRenderRevision) {
      return;
    }
    renderAccountCollection({ accounts: [], selectedAccountUuid: null });
    document.body.dataset.accounts = 'error';
  }
}

function renderHomeNews(items: HomeSnapshot['news'], minecraft = false): void {
  const list = document.querySelector<HTMLElement>('[data-home-news-list]');
  if (!list) {
    return;
  }
  list.replaceChildren();
  list.dataset.newsSource = minecraft ? 'minecraft' : 'battly';
  for (const [index, news] of items.entries()) {
    if (minecraft) {
      list.append(minecraftNewsCard(news, index === 0));
      continue;
    }
    const block = document.createElement('div');
    block.className = 'news-block';
    const card = document.createElement('div');
    card.className = 'new-panel';
    const header = document.createElement('div');
    header.className = 'new-panel-top';
    const title = document.createElement('p');
    title.className = 'new-panel-title';
    title.dataset.homeNewsTitle = '';
    title.textContent = news.title;
    const date = document.createElement('div');
    date.className = 'new-panel-date';
    date.dataset.homeNewsDate = '';
    const parsedDate = new Date(news.publishedAt);
    if (!Number.isNaN(parsedDate.valueOf())) {
      const day = document.createElement('p');
      day.className = 'new-panel-date-day';
      day.textContent = String(parsedDate.getDate());
      const month = document.createElement('p');
      month.className = 'new-panel-date-month';
      month.textContent = parsedDate.toLocaleDateString(uiLocale(), { month: 'long' });
      date.replaceChildren(day, month);
    }
    header.append(title, date);
    const content = document.createElement('div');
    content.className = 'new-panel-bottom';
    content.dataset.homeNewsContent = '';
    const paragraph = document.createElement('div');
    paragraph.className = 'new-panel-description';
    paragraph.setAttribute('translate', 'no');
    paragraph.innerHTML = DOMPurify.sanitize(news.articleHtml ?? news.content, {
      ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'a', 'blockquote'],
      ALLOWED_ATTR: ['href'],
    });
    for (const link of paragraph.querySelectorAll<HTMLAnchorElement>('a')) {
      try {
        const url = new URL(link.getAttribute('href') ?? '');
        if (url.protocol !== 'https:' || url.username || url.password) {
          throw new Error('Invalid news link');
        }
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } catch {
        link.removeAttribute('href');
      }
    }
    const author = document.createElement('p');
    author.className = 'new-panel-author';
    author.dataset.homeNewsAuthor = '';
    const authorText = document.createElement('span');
    const authorIcon = document.createElement('i');
    authorIcon.className = 'fa-solid fa-hammer';
    authorText.append(authorIcon, ` ${news.author}`);
    author.append(authorText);
    content.append(paragraph, author);
    card.append(header, content);
    block.append(card);
    list.append(block);
  }
  if (!items.length) {
    const block = document.createElement('div');
    block.className = 'news-block opacity-1';
    const card = document.createElement('div');
    card.className = 'new-panel';
    const title = document.createElement('p');
    title.className = 'new-panel-title';
    title.dataset.homeNewsTitle = '';
    title.textContent = 'No se pudieron cargar las noticias';
    const header = document.createElement('div');
    header.className = 'new-panel-top';
    header.append(title);
    const content = document.createElement('div');
    content.className = 'new-panel-bottom';
    content.dataset.homeNewsContent = '';
    content.textContent = 'Comprueba tu conexión a Internet.';
    card.append(header, content);
    block.append(card);
    list.append(block);
  }
}

window.addEventListener('minecraft-news-translation-change', () => {
  void window.battly
    .getHome(translateMinecraftNews())
    .then(renderHomeSnapshot)
    .catch(() => undefined);
});

function renderHomeSnapshot(snapshot: HomeSnapshot): void {
  const newsSelector = document.querySelector<HTMLSelectElement>('.news-filter select');
  const renderSelectedNews = (): void => {
    const minecraft = newsSelector?.value === 'minecraft';
    const heading = document.querySelector<HTMLElement>(
      '.main-home-panel-left-news-type .main-home-panel-left-title',
    );
    heading?.setAttribute('data-string-id', minecraft ? 'home.minecraftNews' : 'home.latestNews');
    const news = minecraft ? snapshot.minecraftNews : snapshot.news;
    if (!news.length && (minecraft ? snapshot.pendingMinecraftNews : snapshot.pendingNews)) {
      const list = document.querySelector<HTMLElement>('[data-home-news-list]');
      if (list) {
        const loading = document.createElement('p');
        loading.setAttribute('role', 'status');
        setUiText(loading, 'Cargando...');
        list.replaceChildren(loading);
      }
    } else {
      renderHomeNews(news, minecraft);
    }
  };
  if (newsSelector) {
    newsSelector.onchange = renderSelectedNews;
  }
  renderSelectedNews();
  const warning = document.querySelector<HTMLElement>('[data-home-warning]');
  if (warning) {
    warning.hidden = !snapshot.warning.enabled;
    warning.textContent = snapshot.warning.text;
    warning.dataset.tone = snapshot.warning.tone;
  }
  const setService = (selector: string, online: boolean | null): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      return;
    }
    // This label follows the live snapshot, not the original static locale binding.
    element.removeAttribute('data-string-id');
    element.removeAttribute('data-string-target');
    element.classList.remove('online-text', 'offline-text', 'green');
    if (online === null) {
      delete element.dataset.uiSource;
      element.textContent = '—';
      element.style.removeProperty('color');
      return;
    }
    setUiText(element, online ? 'Operativo' : 'No operativo - No conectado');
    element.style.setProperty('color', online ? '#48c78e' : '#f14668', 'important');
    element.classList.toggle('online-text', online);
    element.classList.toggle('offline-text', !online);
  };
  setService('[data-home-api-status]', snapshot.services.api);
  setService('[data-home-web-status]', snapshot.services.web);
  const users = document.querySelector<HTMLElement>('[data-home-online-users]');
  if (users) {
    setUiText(
      users,
      snapshot.onlineUsers === null ? '—' : `${snapshot.onlineUsers} usuarios online`,
    );
  }
}

function renderFriendActivity(element: HTMLElement, raw: string): void {
  raw = formatPresenceServer(raw);
  const presence = parseMinecraftPresence(raw);
  if (!presence) {
    element.textContent = raw;
    return;
  }
  const { loader, version } = presence;
  const title = loader === 'vanilla' ? 'Minecraft' : formatLoaderName(loader);
  const icon = document.createElement('img');
  icon.className = 'friend-activity-icon';
  icon.alt = '';
  icon.src = playIcon(version, loader);
  const label = document.createElement('span');
  label.textContent = `${title} ${version}`;
  element.replaceChildren(icon, label);
}

function renderSocialRequestBadges(count: number): void {
  document
    .querySelectorAll<HTMLElement>('[data-social-request-count], [data-home-request-count]')
    .forEach((badge) => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.style.display = count > 0 ? 'grid' : 'none';
    });
}

let homeRequestRevision = 0;
async function renderHome(): Promise<void> {
  const revision = ++homeRequestRevision;
  const homeFriends = document.querySelector<HTMLElement>('[data-home-friends]');
  const renderHomeFriends = (snapshot: SocialSnapshot): void => {
    renderSocialRequestBadges(snapshot.receivedRequests.length);
    if (!homeFriends) {
      return;
    }
    bindFriendsDragScroll(homeFriends);
    const online = snapshot.friends.filter((friend) => friend.status === 'online');
    if (!online.length) {
      const empty = document.createElement('p');
      empty.className = 'home-friends-empty';
      empty.textContent = 'No hay amigos conectados ahora mismo';
      homeFriends.replaceChildren(empty);
      return;
    }
    homeFriends.replaceChildren(
      ...online.map((friend) => {
        const card = document.createElement('div');
        card.className = 'online-friend';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Ver el perfil de ${friend.username}`);
        const avatar = document.createElement('img');
        avatar.className = 'online-friend-avatar';
        avatar.draggable = false;
        avatar.alt = '';
        avatar.src = window.battly.faceImageUrl(friend.username);
        avatar.addEventListener(
          'error',
          () => {
            avatar.src = battlyIconUrl;
          },
          { once: true },
        );
        const details = document.createElement('div');
        details.className = 'online-friend-data';
        const username = document.createElement('p');
        username.className = 'online-friend-name';
        setUserText(username, friend.username);
        const activity = document.createElement('p');
        activity.className = 'online-friend-status';
        renderFriendActivity(activity, friend.activity || friend.client || 'En Battly');
        details.append(username, activity);
        card.append(avatar, details);
        const openProfile = (): void => showSocialProfile(friend.userId || friend.username);
        card.addEventListener('click', openProfile);
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openProfile();
          }
        });
        return card;
      }),
    );
  };
  await Promise.allSettled([
    window.battly.getHome(translateMinecraftNews()).then(
      (home) => {
        if (revision !== homeRequestRevision) {
          return;
        }
        renderHomeSnapshot(home);
        document.body.dataset.home = 'ready';
      },
      () => {
        document.body.dataset.home = 'error';
      },
    ),
    window.battly.getSocial().then(
      (social) => {
        if (revision !== homeRequestRevision) {
          return;
        }
        socialSnapshot = social;
        updateSocialProfilePresence();
        renderHomeFriends(social);
      },
      () => {
        if (revision !== homeRequestRevision) {
          return;
        }
        if (!homeFriends) {
          return;
        }
        const retry = document.createElement('button');
        retry.className = 'button is-small';
        setUiText(retry, 'Reintentar');
        retry.addEventListener('click', () => {
          retry.disabled = true;
          void renderHome();
        });
        homeFriends.replaceChildren(retry);
      },
    ),
  ]);
}

function setLoginPending(pending: boolean): void {
  const legacyInformation = document.querySelector<HTMLElement>('#info-login-panel');
  // Popup notifications leave the form's cancel control reachable.
  legacyInformation?.classList.remove('is-active');
  const status = document.querySelector<HTMLElement>('[data-login-status]');
  if (status) {
    status.removeAttribute('data-string-id');
    delete status.dataset.uiSource;
  }
  document
    .querySelectorAll<HTMLInputElement>('[data-login-form] input, [data-offline-form] input')
    .forEach((input) => {
      input.disabled = pending;
    });
  document
    .querySelectorAll<HTMLButtonElement>('[data-login-form] button, [data-offline-form] button')
    .forEach((button) => {
      button.disabled = pending;
    });
  const cancel = document.querySelector<HTMLButtonElement>('[data-auth-cancel]');
  if (cancel) {
    cancel.hidden = !pending;
    cancel.disabled = false;
  }
}

function openGoogleLogin(): void {
  if (document.querySelector('.google-login-dialog')) {
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'google-login-dialog';
  dialog.innerHTML = /* HTML */ `<form>
    <h2>Iniciar sesión con Google</h2>
    <p>
      Termina el inicio de sesión en el navegador. Si solicita permiso para conectarse a Battly,
      permite la conexión local.
    </p>
    <label for="google-login-code">Si la web muestra un código, introdúcelo aquí</label>
    <input
      id="google-login-code"
      name="code"
      autocomplete="off"
      maxlength="6"
      placeholder="ABC123"
      pattern="[A-Za-z0-9]{6}"
      required
    />
    <div>
      <button
        type="button"
        data-google-cancel
      >
        Cancelar</button
      ><button type="submit">Usar código</button>
    </div>
  </form>`;
  document.body.append(dialog);
  dialog.showModal();
  let submitting = false;
  const close = (): void => {
    dialog.close();
    dialog.remove();
  };
  const showOutcome = (outcome: AuthOutcome): void => {
    if (!dialog.isConnected) {
      return;
    }
    if (outcome.ok) {
      close();
    }
  };
  const pending = startAuthentication({ method: 'battly-google' });
  void pending.then((outcome) => {
    if (!submitting) {
      showOutcome(outcome);
    }
  });
  const cancel = (): void => {
    void window.battly.cancelAuth().catch(() => undefined);
    close();
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancel();
  });
  dialog.querySelector('[data-google-cancel]')?.addEventListener('click', cancel);
  dialog.querySelector('form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const code = dialog.querySelector<HTMLInputElement>('input')?.value.trim().toUpperCase() ?? '';
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return;
    }
    submitting = true;
    const submit = dialog.querySelector<HTMLButtonElement>('[type=submit]')!;
    submit.disabled = true;
    void (async () => {
      try {
        await window.battly.cancelAuth();
        const automatic = await pending;
        if (!dialog.isConnected) {
          return;
        }
        // If automatic login already saved the account, do not authenticate twice.
        if (automatic.ok) {
          showOutcome(automatic);
          return;
        }
        showOutcome(await startAuthentication({ method: 'battly-google', code }));
      } catch {
        if (dialog.isConnected) {
          showToast(
            'Iniciar sesión',
            'No se pudo verificar el código. Vuelve a intentarlo.',
            'error',
          );
        }
      } finally {
        submitting = false;
        submit.disabled = false;
      }
    })();
  });
}

function startAuthentication(request: AuthRequest): Promise<AuthOutcome> {
  document
    .querySelectorAll<HTMLElement>(
      '[data-login-status], [data-two-factor-status], [data-offline-status], [data-legacy-two-factor-status]',
    )
    .forEach((element) => {
      element.textContent = '';
    });
  const isTwoFactor = request.method === 'battly-two-factor';
  const pendingNotice = showToast(
    'Iniciar sesión',
    isTwoFactor
      ? 'Verificando…'
      : request.method === 'offline'
        ? 'Creando perfil local…'
        : request.method === 'battly-google' && request.code
          ? 'Verificando código y guardando cuenta…'
          : 'Iniciando sesión…',
  );
  const twoFactorControls = document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    '[data-two-factor-form] input, [data-two-factor-form] button',
  );
  if (isTwoFactor) {
    twoFactorControls.forEach((control) => (control.disabled = true));
  } else {
    setLoginPending(true);
  }
  return window.battly
    .startAuth(request)
    .then(async (outcome): Promise<AuthOutcome> => {
      if (outcome.ok) {
        document.querySelector<HTMLDialogElement>('[data-two-factor-dialog]')?.close();
        document
          .querySelector<HTMLElement>('[data-legacy-two-factor]')
          ?.classList.remove('is-active');
        document.querySelector<HTMLDialogElement>('[data-offline-dialog]')?.close();
        renderAccountCollection(outcome.accounts);
        const news = await window.battly.getNewsState().catch(() => ({ seen: false }));
        const panelId = news.seen ? 'home' : 'news';
        // Avoid the generic transition loader after saving the account.
        setActivePanel(panelId);
        const panel = document.querySelector<HTMLElement>(`[data-panel-view="${panelId}"]`);
        if (panel) {
          notifyPanelEntered(panel, panelId);
        }
        void renderHome();
        return outcome;
      }
      if (outcome.code === 'two-factor-required') {
        const legacyDialog = document.querySelector<HTMLElement>('[data-legacy-two-factor]');
        const legacyCode = document.querySelector<HTMLInputElement>(
          '[data-legacy-two-factor-code]',
        );
        const legacyStatus = document.querySelector<HTMLElement>('[data-legacy-two-factor-status]');
        if (legacyDialog && legacyCode) {
          legacyCode.value = '';
          if (legacyStatus) {
            legacyStatus.textContent = 'Introduce tu código de autenticación';
          }
          legacyDialog.classList.add('is-active');
          legacyCode.focus();
          return outcome;
        }
        const dialog = document.querySelector<HTMLDialogElement>('[data-two-factor-dialog]');
        const code = document.querySelector<HTMLInputElement>('[data-two-factor-code]');
        if (code) {
          code.value = '';
        }
        dialog?.showModal();
        code?.focus();
        return outcome;
      }
      if (outcome.code !== 'cancelled') {
        showToast(
          'Iniciar sesión',
          userErrorMessage(outcome.message, 'No se pudo iniciar sesión'),
          'error',
        );
      }
      return outcome;
    })
    .catch((error: unknown): AuthOutcome => {
      const detail = userErrorMessage(
        error,
        isTwoFactor ? 'No se pudo verificar el código' : 'No se pudo iniciar sesión',
      );
      showToast('Iniciar sesión', detail, 'error');
      return { ok: false, code: 'failed', message: detail };
    })
    .finally(() => {
      pendingNotice?.close();
      if (isTwoFactor) {
        twoFactorControls.forEach((control) => (control.disabled = false));
      } else {
        setLoginPending(false);
      }
    });
}

function bindTwoFactor(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-two-factor-dialog]');
  const form = document.querySelector<HTMLFormElement>('[data-two-factor-form]');
  const code = document.querySelector<HTMLInputElement>('[data-two-factor-code]');
  const label = document.querySelector<HTMLElement>('[data-two-factor-code-label]');
  const status = document.querySelector<HTMLElement>('[data-two-factor-status]');
  const cancelChallenge = (): void => {
    if (status) {
      status.textContent = '';
    }
    void window.battly.cancelAuth();
  };
  form?.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const recovery = radio.checked && radio.value === 'recovery';
      if (!radio.checked || !code) {
        return;
      }
      code.value = '';
      code.inputMode = recovery ? 'text' : 'numeric';
      code.placeholder = recovery ? 'Código de respaldo' : 'Código de 6 dígitos';
      code.pattern = recovery ? '[A-Za-z0-9-]{8,128}' : '[0-9]{6}';
      if (label) {
        label.textContent = recovery
          ? 'Código de respaldo'
          : 'Código de autenticación de 6 dígitos';
      }
    });
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const mode = data.get('mode');
    const rawCode = data.get('code');
    if ((mode !== 'totp' && mode !== 'recovery') || typeof rawCode !== 'string') {
      return;
    }
    const normalizedCode =
      mode === 'totp' ? rawCode.replace(/\D/g, '') : rawCode.trim().toUpperCase();
    if (
      (mode === 'totp' && normalizedCode.length !== 6) ||
      (mode === 'recovery' && normalizedCode.length < 8)
    ) {
      showToast('Iniciar sesión', 'Introduce un código válido', 'warning');
      return;
    }
    void startAuthentication({ method: 'battly-two-factor', mode, code: normalizedCode });
  });
  document
    .querySelector<HTMLButtonElement>('[data-two-factor-cancel]')
    ?.addEventListener('click', () => {
      dialog?.close();
      cancelChallenge();
    });
  dialog?.addEventListener('cancel', cancelChallenge);
  const legacyDialog = document.querySelector<HTMLElement>('[data-legacy-two-factor]');
  const legacyCode = document.querySelector<HTMLInputElement>('[data-legacy-two-factor-code]');
  document.querySelector<HTMLButtonElement>('#code-btn')?.addEventListener('click', () => {
    const normalizedCode = legacyCode?.value.replace(/\D/g, '') ?? '';
    if (normalizedCode.length !== 6) {
      showToast('Iniciar sesión', 'Introduce un código válido de 6 dígitos', 'warning');
      return;
    }
    void startAuthentication({ method: 'battly-two-factor', mode: 'totp', code: normalizedCode });
  });
  document.querySelector<HTMLButtonElement>('#cancel-code-btn')?.addEventListener('click', () => {
    legacyDialog?.classList.remove('is-active');
    cancelChallenge();
  });
}

function bindLogin(): void {
  const form = document.querySelector<HTMLFormElement>('[data-login-form]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const usernameValue = formData.get('username');
    const passwordValue = formData.get('password');
    const username = typeof usernameValue === 'string' ? usernameValue : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const passwordInput = form.elements.namedItem('password');
    if (passwordInput instanceof HTMLInputElement) {
      passwordInput.value = '';
    }
    void startAuthentication({ method: 'battly-password', username, password });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-auth-method]').forEach((button) => {
    button.addEventListener('click', () => {
      const method = button.dataset.authMethod;
      if (method === 'battly-google') {
        openGoogleLogin();
      } else if (method === 'microsoft') {
        void startAuthentication({ method });
      }
    });
  });
  document.querySelector<HTMLButtonElement>('[data-auth-cancel]')?.addEventListener('click', () => {
    void window.battly.cancelAuth();
  });
  document
    .querySelector<HTMLButtonElement>('[data-password-help]')
    ?.addEventListener('click', () => {
      void window.battly.openPasswordHelp();
    });
  document
    .querySelector<HTMLButtonElement>('[data-battly-register]')
    ?.addEventListener('click', () => {
      void window.battly.openBattlyRegister();
    });
  document.querySelector<HTMLButtonElement>('[data-login-back]')?.addEventListener('click', () => {
    void window.battly
      .getAccounts()
      .then((accounts) => {
        renderAccountCollection(accounts);
        return activatePanel(accounts.accounts.length ? 'home' : 'login');
      })
      .catch(() => activatePanel('login', false));
  });
}

function bindAccountSelector(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-account-trigger]');
  const dropdown = document.querySelector<HTMLElement>('[data-account-dropdown]');
  trigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!expanded));
    if (dropdown) {
      dropdown.hidden = expanded;
      dropdown.classList.toggle('show', !expanded);
    }
  });
  dropdown?.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', closeAccountDropdown);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAccountDropdown();
    }
  });
}

function updateInstanceRuntimeControls(form: HTMLFormElement): void {
  const ramMode = form.querySelector<HTMLSelectElement>('[data-instance-ram-mode]');
  const javaMode = form.querySelector<HTMLSelectElement>('[data-instance-java-mode]');
  form.querySelectorAll<HTMLElement>('[data-instance-custom-ram]').forEach((control) => {
    const customRam = ramMode?.value === 'custom';
    control.hidden = !customRam;
    const input = control.querySelector<HTMLInputElement>('input');
    if (input) {
      input.required = customRam;
    }
  });
  const customJava = javaMode?.value === 'custom-path';
  const javaPath = form.querySelector<HTMLElement>('[data-instance-java-path]');
  const javaPicker = form.querySelector<HTMLButtonElement>('[data-instance-java-select]');
  if (javaPath) {
    javaPath.hidden = !customJava;
  }
  if (javaPicker) {
    javaPicker.hidden = !customJava;
  }
  const javaPathInput = form.elements.namedItem('javaPath');
  if (javaPathInput instanceof HTMLInputElement) {
    javaPathInput.required = customJava;
  }
}

function resetInstanceEditor(): void {
  const form = document.querySelector<HTMLFormElement>('[data-instance-form]');
  form?.reset();
  if (form) {
    delete form.dataset.editing;
    form
      .querySelector<HTMLSelectElement>('[data-instance-loader]')
      ?.dispatchEvent(new Event('change'));
    updateInstanceRuntimeControls(form);
    form.querySelector<HTMLDetailsElement>('.instance-runtime-details')?.removeAttribute('open');
    form
      .querySelector<HTMLElement>('[data-instance-runtime-toggle]')
      ?.setAttribute('aria-pressed', 'false');
  }
  hideLegacyModal(document.querySelector<HTMLElement>('[data-instance-editor-dialog]'));
  const title = document.querySelector<HTMLElement>('[data-instance-form-title]');
  if (title) {
    title.textContent = 'Crear instancia';
  }
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    submit.textContent = 'Crear instancia';
  }
  const preview = form?.querySelector<HTMLImageElement>('[data-instance-image-preview]');
  if (preview) {
    preview.src = defaultMinecraftIconUrl;
    preview.alt = '';
    delete preview.dataset.customIcon;
  }
  const imageName = form?.querySelector<HTMLElement>('[data-instance-image-name]');
  if (imageName) {
    imageName.textContent = '';
  }
}

function editInstance(instance: InstanceSummary): void {
  const form = document.querySelector<HTMLFormElement>('[data-instance-form]');
  if (!form) {
    return;
  }
  showLegacyModal(document.querySelector<HTMLElement>('[data-instance-editor-dialog]'));
  form.dataset.editing = instance.id;
  const versionControl = form.elements.namedItem('version');
  if (
    versionControl instanceof HTMLSelectElement &&
    ![...versionControl.options].some((option) => option.value === instance.version)
  ) {
    versionControl.append(new Option(instance.version, instance.version));
  }
  const values: Record<'description' | 'loader' | 'loaderVersion' | 'name' | 'version', string> = {
    name: instance.name,
    description: instance.description,
    version: instance.version,
    loader: instance.loader ?? '',
    loaderVersion: instance.loaderVersion ?? '',
  };
  for (const [name, value] of Object.entries(values)) {
    const control = form.elements.namedItem(name);
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    ) {
      control.value = value;
    }
  }
  const profile = instance.launchProfile;
  const ramMode = form.querySelector<HTMLSelectElement>('[data-instance-ram-mode]');
  if (ramMode) {
    ramMode.value =
      profile?.ramMinGb !== null && profile?.ramMinGb !== undefined ? 'custom' : 'global';
  }
  const ramMinimum = form.elements.namedItem('ramMinGb');
  if (ramMinimum instanceof HTMLInputElement) {
    ramMinimum.value = String(profile?.ramMinGb ?? 0.5);
  }
  const ramMaximum = form.elements.namedItem('ramMaxGb');
  if (ramMaximum instanceof HTMLInputElement) {
    ramMaximum.value = String(profile?.ramMaxGb ?? 2);
  }
  const javaMode = form.querySelector<HTMLSelectElement>('[data-instance-java-mode]');
  if (javaMode) {
    javaMode.value = profile?.javaVersion ?? 'global';
  }
  const javaPath = form.elements.namedItem('javaPath');
  if (javaPath instanceof HTMLInputElement) {
    javaPath.value = profile?.javaPath ?? '';
  }
  const jvmArgs = form.elements.namedItem('jvmArgs');
  if (jvmArgs instanceof HTMLTextAreaElement) {
    jvmArgs.value = profile?.jvmArgs ?? '';
  }
  const preview = form.querySelector<HTMLImageElement>('[data-instance-image-preview]');
  if (preview) {
    preview.src = instance.iconDataUrl ?? defaultMinecraftIconUrl;
  }
  const loaderVersion = form.querySelector<HTMLSelectElement>('[data-instance-loader-version]');
  if (loaderVersion) {
    loaderVersion.dataset.preferred = instance.loaderVersion ?? '';
  }
  updateInstanceRuntimeControls(form);
  const title = document.querySelector<HTMLElement>('[data-instance-form-title]');
  if (title) {
    title.textContent = 'Editar instancia';
  }
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submit) {
    submit.textContent = 'Guardar';
  }
  form
    .querySelector<HTMLSelectElement>('[data-instance-loader]')
    ?.dispatchEvent(new Event('change'));
}

let knownInstances: readonly InstanceSummary[] = [];
let playVersionSnapshot: PlayVersionSnapshot | null = null;
let selectedPlayRequest: PlayVersionLaunchRequest | null = null;

function recentInstanceIds(instances: readonly InstanceSummary[]): string[] {
  try {
    return parseRecentInstanceIds(privateStorage.getItem(launchHistoryStorageKey), instances);
  } catch {
    return [];
  }
}

function rememberInstanceLaunch(instanceId: string): void {
  try {
    const next = recordRecentInstanceId(instanceId, recentInstanceIds(knownInstances));
    privateStorage.setItem(launchHistoryStorageKey, JSON.stringify(next));
  } catch {
    // Launch history is optional when storage is unavailable.
  }
}

function showLegacyModal(element: HTMLElement | null): void {
  if (!element) {
    return;
  }
  element.hidden = false;
  element.classList.add('is-active');
}

function hideLegacyModal(element: HTMLElement | null): void {
  if (!element) {
    return;
  }
  element
    .querySelectorAll<HTMLElement>('[popover]:popover-open')
    .forEach((panel) => panel.hidePopover());
  element.classList.remove('is-active');
  element.hidden = true;
}

const playLoaderDefinitions = [
  ['vanilla', 'minecraft.png', 'Vanilla', 'La versión original de Minecraft. Sin modificaciones.'],
  ['fabric', 'fabric.png', 'Fabric', 'Un modloader ligero y fácil de usar para mods.'],
  ['forge', 'forge.png', 'Forge', 'El modloader más popular; gran cantidad de mods.'],
  ['quilt', 'quilt.png', 'Quilt', 'Modloader experimental para Minecraft, moderno y compatible.'],
  [
    'legacyfabric',
    'legacyfabric.png',
    'LegacyFabric',
    'La versión legacy de Fabric para Minecraft antiguas.',
  ],
  ['neoforge', 'neoforge.png', 'NeoForge', 'Modloader moderno y ligero, versión moderna de Forge.'],
  [
    'optifine',
    'optifine.png',
    'OptiFine',
    'Mejora el rendimiento y permite usar shaders y texturas HD.',
  ],
  ['horizon', 'minecraft.png', 'Horizon', 'Minecraft en Rust.'],
] as const;

function playIcon(version: string, loader = ''): string {
  if (loader === 'horizon') {
    return new URL('./assets/horizon.png', import.meta.url).href;
  }
  const lower = version.toLowerCase().replace(/[\s_-]+/g, '');
  const icons: readonly (readonly [string, string])[] = [
    ['labymod', 'labymod.webp'],
    ['optifine', 'optifine.png'],
    ['neoforge', 'neoforge.png'],
    ['legacyfabric', 'legacyfabric.png'],
    ['forge', 'forge.png'],
    ['fabric', 'fabric.png'],
    ['quilt', 'quilt.png'],
    ['battlyclient', 'battly.png'],
    ['msclient', 'ms.png'],
    ['lehan23', 'lehan23.png'],
    ['madaclient', 'mada.jpg'],
    ['cmpack', 'cmpack.png'],
    ['ares', 'ares.png'],
    ['batmod', 'batmod.png'],
    ['pluto', 'pluto.png'],
    ['beast', 'beast.png'],
    ['pixel', 'pixel.png'],
    ['netherclient', 'nether.png'],
    ['pengiun', 'pengiun.png'],
    ['penguin', 'pengiun.png'],
  ];
  const loaderFile = playLoaderDefinitions.find(([id]) => id === loader)?.[1];
  const file =
    icons.find(([needle]) => lower.includes(needle))?.[1] ??
    (/^battly-\d/i.test(version) ? 'battly.png' : loaderFile) ??
    'minecraft.png';
  return legacyImageUrls[`./legacy/assets/images/icons/${file}`] ?? defaultMinecraftIconUrl;
}

function formatPlayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  const time = date.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `Hoy a las ${time}`;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Ayer a las ${time}`;
  }
  return `${date.toLocaleDateString(uiLocale(), { day: '2-digit', month: 'long' })} a las ${time}`;
}

function playVersionLabel(
  version: string,
  loader: string,
  loaderVersion: string,
  custom = false,
): string {
  if (custom || loader === 'vanilla') {
    return formatPlayVersion(version);
  }
  if (loader === 'optifine') {
    const build = loaderVersion && loaderVersion !== 'latest' ? ` (${loaderVersion})` : '';
    return `OptiFine ${version}${build}`;
  }
  const loaderTitle = playLoaderDefinitions.find(([id]) => id === loader)?.[2] ?? loader;
  const visibleBuild =
    loader === 'forge' && loaderVersion.startsWith(`${version}-`)
      ? loaderVersion.slice(version.length + 1)
      : loaderVersion;
  return `${loaderTitle} ${version}${visibleBuild ? ` (${visibleBuild})` : ''}`;
}

function requestFromRecent(recent: PlayRecentVersion, safeMode = false): PlayVersionLaunchRequest {
  return {
    version: recent.version,
    custom: recent.isExtra,
    customVersion: recent.customVersion,
    loader: recent.loader || 'vanilla',
    loaderVersion: recent.loaderVersion,
    requiredJavaVersion: recent.requiredJavaVersion,
    safeMode,
  };
}

function renderRecentVersions(recents: readonly PlayRecentVersion[]): void {
  const container = document.querySelector<HTMLElement>('[data-play-recents]');
  if (!container) {
    return;
  }
  container.replaceChildren();
  for (const recent of recents) {
    const rawVersion = recent.isExtra ? recent.customVersion : recent.version;
    const item = document.createElement('div');
    item.className = 'recent-version-item';
    const row = document.createElement('div');
    row.className = 'version-item';
    const information = document.createElement('div');
    information.className = 'version-item-info';
    const icon = document.createElement('div');
    icon.className = 'version-item-icon';
    const iconImage = document.createElement('img');
    iconImage.src = playIcon(rawVersion, recent.loader);
    iconImage.alt = '';
    icon.append(iconImage);
    const copy = document.createElement('div');
    copy.className = 'version-item-name';
    const title = document.createElement('h1');
    title.textContent = playVersionLabel(
      rawVersion,
      recent.loader,
      recent.loaderVersion,
      recent.isExtra,
    );
    title.title = title.textContent;
    const detail = document.createElement('h2');
    detail.textContent = formatPlayDate(recent.dateOpened);
    copy.append(title, detail);
    information.append(icon, copy);
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'button is-info is-outlined start-version-button';
    play.setAttribute('aria-label', `Iniciar ${rawVersion}`);
    play.innerHTML = '<span><i class="fas fa-play" aria-hidden="true"></i></span>';
    play.addEventListener('click', () =>
      startPlayVersion(requestFromRecent(recent), title.textContent || rawVersion),
    );
    row.append(information, play);
    item.append(row);
    container.append(item);
  }
}

function selectPlayLoader(
  installed: InstalledPlayVersion,
  loader: string,
  loaderVersion = '',
): void {
  const start = document.querySelector<HTMLButtonElement>('[data-play-start]');
  const safe = document.querySelector<HTMLButtonElement>('[data-play-safe]');
  const shortcut = document.querySelector<HTMLButtonElement>('[data-play-shortcut]');
  const status = document.querySelector<HTMLElement>('[data-play-status]');
  selectedPlayRequest = {
    version: installed.version,
    custom: installed.custom,
    customVersion: installed.custom || loader === 'optifine' ? installed.id : '',
    loader,
    loaderVersion: loader === 'vanilla' ? '' : loaderVersion,
    requiredJavaVersion: installed.requiredJavaVersion ?? '',
    safeMode: false,
  };
  if (start) {
    start.disabled = false;
    start.style.display = 'flex';
  }
  if (safe) {
    safe.disabled = loader === 'horizon';
    safe.style.display = loader === 'horizon' ? 'none' : 'flex';
  }
  if (shortcut) {
    shortcut.disabled = false;
    shortcut.hidden = false;
  }
  if (status) {
    status.style.display = 'block';
    status.textContent = `Iniciarás la versión: ${playVersionLabel(installed.custom ? installed.id : installed.version, loader, loaderVersion, installed.custom)}`;
  }
}

function renderPlayLoaders(requestedVersion: string): void {
  const container = document.querySelector<HTMLElement>('[data-play-loaders]');
  const versionSelect = document.querySelector<HTMLSelectElement>('[data-play-version]');
  const buildWrap = document.querySelector<HTMLElement>('[data-play-loader-build-wrap]');
  const buildSelect = document.querySelector<HTMLSelectElement>('[data-play-loader-build]');
  const version = requestedVersion || versionSelect?.value || '';
  const status = document.querySelector<HTMLElement>('[data-play-status]');
  const start = document.querySelector<HTMLButtonElement>('[data-play-start]');
  const safe = document.querySelector<HTMLButtonElement>('[data-play-safe]');
  const shortcut = document.querySelector<HTMLButtonElement>('[data-play-shortcut]');
  if (!container) {
    return;
  }
  container.replaceChildren();
  buildWrap?.setAttribute('hidden', '');
  if (buildSelect) {
    buildSelect.onchange = null;
    buildSelect.replaceChildren(new Option('Elige una versión instalada', ''));
  }
  selectedPlayRequest = null;
  const selectedOption = versionSelect?.selectedOptions[0];
  const isCustom = selectedOption?.dataset.custom === 'true';
  const standaloneLoader = selectedOption?.dataset.standaloneLoader;
  const installedVersions =
    playVersionSnapshot?.installed.filter((entry) => {
      if (isCustom) {
        return entry.custom && entry.id === version;
      }
      if (standaloneLoader) {
        return entry.id === version && entry.loader === standaloneLoader;
      }
      return !entry.custom && entry.loader !== 'horizon' && entry.version === version;
    }) ?? [];
  const installed =
    installedVersions.find((entry) => entry.loader === 'vanilla') ?? installedVersions[0];
  container.hidden = !installed || isCustom;
  container.style.setProperty('display', installed && !isCustom ? 'grid' : 'none');
  if (status) {
    status.style.display = version ? 'block' : 'none';
  }
  if (start) {
    start.disabled = true;
    start.style.display = 'none';
  }
  if (safe) {
    safe.disabled = true;
    safe.style.display = 'none';
  }
  if (shortcut) {
    shortcut.disabled = true;
    shortcut.hidden = true;
  }
  if (!installed) {
    return;
  }
  if (isCustom || installed.custom || /optifine/i.test(installed.id)) {
    selectPlayLoader(installed, 'vanilla');
    return;
  }
  const available = new Set(installedVersions.map((entry) => entry.loader));
  for (const [id, , titleText, descriptionText] of playLoaderDefinitions) {
    const button = document.createElement('div');
    button.className = 'loader-option';
    button.dataset.playLoader = id;
    button.dataset.loader = id;
    button.id = `playLoaderType-${id}`;
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', titleText);
    button.style.display = available.has(id) ? 'flex' : 'none';
    const icon = document.createElement('img');
    icon.src = playIcon('', id);
    icon.alt = '';
    const copy = document.createElement('span');
    copy.className = 'button-span';
    const title = document.createElement('h1');
    title.textContent = id === 'horizon' ? 'Horizon · Beta' : titleText;
    const description = document.createElement('h2');
    description.textContent = descriptionText;
    copy.append(title, description);
    button.append(icon, copy);
    const choose = (): void => {
      container.querySelectorAll<HTMLElement>('[data-play-loader]').forEach((entry) => {
        const selected = entry === button;
        entry.setAttribute('aria-pressed', String(selected));
        entry.classList.toggle('selected-loader', selected);
      });
      const matching = installedVersions.filter((entry) => entry.loader === id);
      if (id === 'vanilla' || matching.length === 1) {
        if (buildWrap) {
          buildWrap.hidden = true;
        }
        if (buildSelect) {
          buildSelect.onchange = null;
        }
        const single = matching[0];
        if (single) {
          selectPlayLoader(single, id, single.loaderVersion);
        }
        return;
      }
      if (!buildSelect || !buildWrap) {
        return;
      }
      buildSelect.replaceChildren(new Option('Elige una versión instalada', ''));
      for (const entry of matching) {
        const option = document.createElement('option');
        option.value = entry.id;
        setUserText(option, entry.loaderVersion);
        buildSelect.append(option);
      }
      buildWrap.hidden = false;
      selectedPlayRequest = null;
      if (status) {
        status.style.display = 'block';
        status.textContent = `Elige la versión instalada de ${titleText}`;
      }
      if (start) {
        start.style.display = 'none';
      }
      if (safe) {
        safe.style.display = 'none';
      }
      if (shortcut) {
        shortcut.hidden = true;
      }
      buildSelect.onchange = () => {
        const exact = matching.find((entry) => entry.id === buildSelect.value);
        if (exact) {
          selectPlayLoader(exact, id, exact.loaderVersion);
        }
      };
    };
    button.addEventListener('click', choose);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    container.append(button);
    if (id === standaloneLoader) {
      choose();
    }
  }
  if (standaloneLoader) {
    return;
  }
  if (status) {
    status.textContent = `Iniciarás la versión: ${formatPlayVersion(installed.id)}`;
  }
}

function renderPlaySelector(snapshot: PlayVersionSnapshot): void {
  playVersionSnapshot = snapshot;
  const version = document.querySelector<HTMLSelectElement>('[data-play-version]');
  if (!version) {
    return;
  }
  const selectedVersion = version.value;
  version.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Elige una versión';
  version.append(placeholder);
  const sort = document.querySelector<HTMLSelectElement>('[data-play-sort]')?.value ?? 'recent';
  const direction =
    document.querySelector<HTMLSelectElement>('[data-play-sort-direction]')?.value ?? 'desc';
  const compare = (a: InstalledPlayVersion, b: InstalledPlayVersion): number =>
    comparePlayOptions(a, b, sort, direction);
  const customEntries = snapshot.installed.filter((entry) => entry.custom).sort(compare);
  const horizonEntries = snapshot.installed.filter(
    (entry) => !entry.custom && entry.loader === 'horizon',
  );
  const regularEntries = snapshot.installed.filter(
    (entry) => !entry.custom && entry.loader !== 'horizon',
  );
  const minecraftVersions = [...new Set(regularEntries.map((entry) => entry.version))].sort(
    (left, right) => right.localeCompare(left, undefined, { numeric: true }),
  );
  const choices: {
    id: string;
    version: string;
    installedAt?: number;
    custom: boolean;
    loader?: string;
  }[] = minecraftVersions.map((id) => ({
    id,
    version: id,
    custom: false,
    installedAt: Math.max(
      0,
      ...regularEntries
        .filter((entry) => entry.version === id)
        .map((entry) => entry.installedAt ?? 0),
    ),
  }));
  choices.push(...customEntries, ...horizonEntries);
  choices.sort((a, b) => comparePlayOptions(a, b, sort, direction));
  for (const entry of choices) {
    const option = document.createElement('option');
    option.value = entry.id;
    if (entry.custom) {
      option.dataset.custom = 'true';
    }
    option.title = entry.id;
    if (entry.loader === 'horizon' && !entry.custom) {
      option.dataset.standaloneLoader = entry.loader;
      option.textContent = playVersionLabel(entry.version, entry.loader, '');
    } else {
      option.textContent = formatPlayVersion(entry.id);
    }
    version.append(option);
  }
  if (choices.some((entry) => entry.id === selectedVersion)) {
    version.value = selectedVersion;
  }
  renderPlayLoaders(version.value);
  renderRecentVersions(snapshot.recent);
}

let playSelectorRevision = 0;
const playSelectorCache = new PlaySelectorCache(privateStorage, () =>
  window.battly.getPlayVersions(),
);

let playSelectorServer: PlayVersionLaunchRequest['directConnect'] = null;
async function openPlaySelector(
  server: PlayVersionLaunchRequest['directConnect'] = null,
): Promise<void> {
  playSelectorServer = server;
  const dialog = document.querySelector<HTMLElement>('[data-play-dialog]');
  const status = document.querySelector<HTMLElement>('[data-play-status]');
  if (!dialog) {
    return;
  }
  const revision = ++playSelectorRevision;
  showLegacyModal(dialog);
  dialog.setAttribute('aria-busy', 'true');
  const cached = playSelectorCache.read();
  const hasCachedVersions = cached !== null && hasPlayableVersion(cached);
  if (cached) {
    renderPlaySelector(cached);
    dialog.querySelectorAll<HTMLSelectElement>('select').forEach((control) => {
      control.disabled = false;
    });
  } else {
    selectedPlayRequest = null;
    const controls = dialog.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '[data-play-start], [data-play-safe], [data-play-shortcut], [data-play-version], [data-play-loader-build]',
    );
    controls.forEach((control) => {
      control.disabled = true;
    });
    document.querySelector('[data-play-loaders]')?.replaceChildren();
    document.querySelector('[data-play-recents]')?.replaceChildren();
    if (status) {
      status.style.display = 'block';
      status.textContent = 'Cargando versiones...';
    }
  }
  try {
    // Yield a frame so the cached controls paint before discovery or persistence work.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const snapshot = await playSelectorCache.refresh();
    if (revision !== playSelectorRevision) {
      return;
    }
    if (!hasPlayableVersion(snapshot)) {
      hideLegacyModal(dialog);
      await activatePanel('downloads');
      await askBattly({
        title: 'Primero descarga una versión',
        text: 'Todavía no tienes ninguna versión de Minecraft instalada. Elige una versión en Descargas y Battly la preparará antes de jugar.',
        confirmText: 'Entendido',
        cancelText: 'Cerrar',
      });
      return;
    }
    const sameInstalled =
      cached && JSON.stringify(snapshot.installed) === JSON.stringify(cached.installed);
    if (sameInstalled) {
      playVersionSnapshot = snapshot;
      if (JSON.stringify(snapshot.recent) !== JSON.stringify(cached.recent)) {
        renderRecentVersions(snapshot.recent);
      }
    } else {
      const loader = document.querySelector<HTMLElement>('[data-play-loader][aria-pressed="true"]')
        ?.dataset.playLoader;
      const build = document.querySelector<HTMLSelectElement>('[data-play-loader-build]')?.value;
      renderPlaySelector(snapshot);
      if (loader) {
        const button = document.querySelector<HTMLElement>('[data-play-loader="' + loader + '"]');
        if (button && button.style.display !== 'none') {
          button.click();
        }
        const select = document.querySelector<HTMLSelectElement>('[data-play-loader-build]');
        if (select && build && [...select.options].some((option) => option.value === build)) {
          select.value = build;
          select.dispatchEvent(new Event('change'));
        }
      }
    }
    dialog.querySelectorAll<HTMLSelectElement>('select').forEach((control) => {
      control.disabled = false;
    });
  } catch (error: unknown) {
    if (revision !== playSelectorRevision) {
      return;
    }
    if (status && !hasCachedVersions) {
      status.textContent = 'No se pudieron cargar las versiones instaladas.';
    }
    console.error('No se pudo renderizar el selector de versiones', error);
  } finally {
    if (revision === playSelectorRevision) {
      dialog.setAttribute('aria-busy', 'false');
    }
  }
}

function instanceLoaderBanner(loader: string | null): string {
  switch (loader?.trim().toLowerCase()) {
    case 'neoforge':
      return neoforgeInstanceBannerUrl;
    case 'fabric':
      return fabricInstanceBannerUrl;
    case 'forge':
      return forgeInstanceBannerUrl;
    default:
      return vanillaInstanceBannerUrl;
  }
}

function renderInstances(instances: readonly InstanceSummary[]): void {
  knownInstances = instances;
  const list = document.querySelector<HTMLElement>('[data-instances-list]');
  list?.replaceChildren();
  const loaderFilter = document.querySelector<HTMLSelectElement>('[data-instances-loader-filter]');
  const versionFilter = document.querySelector<HTMLSelectElement>(
    '[data-instances-version-filter]',
  );
  const updateOptions = (
    select: HTMLSelectElement | null,
    values: readonly string[],
    placeholder: string,
  ): void => {
    if (!select) {
      return;
    }
    const selected = select.value;
    const all = document.createElement('option');
    all.value = '';
    setUiText(all, placeholder);
    select.replaceChildren(all);
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      setUiText(
        option,
        value === 'vanilla'
          ? 'Vanilla'
          : value === 'neoforge'
            ? 'NeoForge'
            : value === 'optifine'
              ? 'OptiFine'
              : value.charAt(0).toUpperCase() + value.slice(1),
      );
      select.append(option);
    }
    select.value = values.includes(selected) ? selected : '';
  };
  updateOptions(
    loaderFilter,
    [...new Set(instances.map((instance) => instance.loader?.toLowerCase() || 'vanilla'))].sort(),
    'Todos',
  );
  updateOptions(
    versionFilter,
    [...new Set(instances.map((instance) => instance.version))].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    ),
    'Todas las versiones',
  );
  const visible = filterInstanceLibrary(
    instances,
    {
      query: document.querySelector<HTMLInputElement>('[data-instances-search]')?.value ?? '',
      loader: loaderFilter?.value ?? '',
      version: versionFilter?.value ?? '',
      sort: document.querySelector<HTMLSelectElement>('[data-instances-sort]')?.value ?? 'recent',
      direction:
        document.querySelector<HTMLSelectElement>('[data-instances-sort-direction]')?.value ??
        'desc',
    },
    recentInstanceIds(instances),
  );
  let openedCard: HTMLElement | null = null;
  for (const instance of visible) {
    const versionLabel = instance.loader
      ? `${instance.version} · ${formatLoaderName(instance.loader)}`
      : instance.version;
    const card = document.createElement('div');
    card.className = 'card ten-radius';
    card.dataset.instanceCard = instance.id;
    card.style.cssText = 'margin-bottom:-5px;background-color:rgb(22,29,43)';
    const header = document.createElement('header');
    header.className = 'card-header';
    header.style.cssText = 'color:#fff;cursor:pointer';
    const title = document.createElement('p');
    title.className = 'card-header-title';
    title.style.color = '#fff';
    const titleText = document.createElement('span');
    setUserText(titleText, instance.name);
    const titleEdit = document.createElement('button');
    titleEdit.type = 'button';
    titleEdit.className = 'instance-title-edit';
    titleEdit.setAttribute('aria-label', `Editar ${instance.name}`);
    titleEdit.innerHTML = '<i class="fa-solid fa-edit" aria-hidden="true"></i>';
    titleEdit.addEventListener('click', (event) => {
      event.stopPropagation();
      editInstance(instance);
    });
    const viewContent = document.createElement('button');
    viewContent.type = 'button';
    viewContent.className = 'instance-title-edit instance-title-content';
    viewContent.title = 'Ver contenido de la instancia';
    viewContent.setAttribute('aria-label', `Ver contenido de ${instance.name}`);
    viewContent.innerHTML = '<i class="fa-solid fa-box-open" aria-hidden="true"></i>';
    viewContent.addEventListener('click', (event) => {
      event.stopPropagation();
      openInstanceContent(instance);
    });
    title.append(titleText, titleEdit, viewContent);
    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'card-header-icon';
    chevron.setAttribute('aria-label', 'Más opciones');
    chevron.innerHTML = '<span class="icon"><i class="fas fa-angle-down"></i></span>';
    header.append(title, chevron);
    const content = document.createElement('div');
    content.className = 'card-content';
    content.style.display = 'none';
    const defaultIcon = defaultMinecraftIconUrl;
    const image = document.createElement('img');
    image.src = instance.iconDataUrl ?? defaultIcon;
    image.alt = '';
    image.style.borderRadius = '5px';
    image.addEventListener('error', () => {
      if (image.src !== defaultIcon) {
        image.src = defaultIcon;
      }
    });
    const figure = document.createElement('figure');
    figure.className = 'image is-32x32';
    figure.append(image);
    content.append(figure);
    const description = document.createElement('div');
    description.className = 'content';
    description.style.cssText =
      "margin-left:10px;color:#fff;font-family:'Battly Emoji',Poppins,'Battly Emoji Sequences';font-weight:700";
    const descriptionCopy = document.createElement('span');
    setUserText(descriptionCopy, instance.description, 'Sin descripción');
    const versionCopy = document.createElement('span');
    setUserText(versionCopy, ` · ${versionLabel}`);
    description.append(descriptionCopy, versionCopy);
    content.append(description);
    const actions = document.createElement('footer');
    actions.className = 'card-footer';
    actions.style.display = 'none';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'card-footer-item button instance-action instance-action-primary';
    open.innerHTML =
      '<i class="fa-solid fa-square-up-right"></i><span class="btn-text">Abrir instancia</span>';
    open.setAttribute('aria-label', `Abrir instancia ${instance.name}`);
    open.addEventListener('click', () => startInstance(instance));
    const openFolder = document.createElement('button');
    openFolder.type = 'button';
    openFolder.className = 'card-footer-item button instance-action';
    openFolder.innerHTML =
      '<i class="fa-solid fa-folder-open"></i><span class="btn-text">Abrir carpeta</span>';
    openFolder.setAttribute('aria-label', `Abrir carpeta de ${instance.name}`);
    openFolder.addEventListener('click', () => void window.battly.openInstanceFolder(instance.id));
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'card-footer-item button instance-action instance-action-danger';
    archive.innerHTML = '<i class="fa-solid fa-trash"></i><span class="btn-text">Eliminar</span>';
    archive.setAttribute('aria-label', `Eliminar instancia ${instance.name}`);
    archive.addEventListener(
      'click',
      voidAsyncEvent(async () => {
        if (
          !(await askBattly({
            text: `¿Eliminar la instancia ${instance.name}? Podrás recuperarla del archivo.`,
          }))
        ) {
          return;
        }
        const status = document.querySelector<HTMLElement>('[data-instances-status]');
        if (status) {
          status.textContent = 'Archivando instancia…';
        }
        void window.battly
          .archiveInstance(instance.id)
          .then((next) => {
            renderInstances(next);
            if (status) {
              status.textContent = 'Instancia archivada';
            }
          })
          .catch(() => {
            if (status) {
              status.textContent = 'No se pudo archivar la instancia';
            }
          });
      }),
    );
    const exportPack = document.createElement('button');
    exportPack.type = 'button';
    exportPack.className = 'card-footer-item button instance-action';
    exportPack.title = translateUiText('Exportar instancia');
    exportPack.dataset.instanceExport = '';
    exportPack.setAttribute('aria-label', `${exportPack.title} · ${instance.name}`);
    exportPack.innerHTML =
      '<i class="fa-solid fa-file-export" aria-hidden="true"></i><span class="btn-text"></span>';
    exportPack.querySelector('.btn-text')!.textContent = translateUiText('Exportar');
    exportPack.addEventListener('click', () => chooseInstanceExport(instance));
    const duplicate = document.createElement('button');
    duplicate.type = 'button';
    duplicate.className = exportPack.className;
    duplicate.title = translateUiText('Duplicar instancia');
    duplicate.dataset.instanceDuplicate = '';
    duplicate.setAttribute('aria-label', `${duplicate.title} · ${instance.name}`);
    duplicate.innerHTML =
      '<i class="fa-solid fa-copy" aria-hidden="true"></i><span class="btn-text"></span>';
    duplicate.querySelector('.btn-text')!.textContent = translateUiText('Duplicar');
    duplicate.addEventListener('click', () => {
      openInstanceCopy(instance, (copy) => {
        const current = knownInstances.some((entry) => entry.id === copy.id)
          ? knownInstances
          : [...knownInstances, copy];
        renderInstances(current);
        const status = document.querySelector<HTMLElement>('[data-instances-status]');
        if (status) {
          status.textContent = translateUiText('Instancia duplicada.');
        }
      });
    });
    const shortcut = document.createElement('button');
    shortcut.type = 'button';
    shortcut.className = 'card-footer-item button instance-action';
    shortcut.title = 'Crear acceso directo en el escritorio';
    shortcut.dataset.instanceShortcut = '';
    shortcut.setAttribute('aria-label', `Crear acceso directo de ${instance.name}`);
    shortcut.innerHTML =
      '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i><span class="btn-text">Acceso directo</span>';
    shortcut.addEventListener('click', () => {
      shortcut.disabled = true;
      void window.battly
        .createPlayShortcut(
          {
            instanceId: instance.id,
            version: instance.version,
            loader: instance.loader || 'vanilla',
            loaderVersion: '',
            custom: false,
            customVersion: '',
            requiredJavaVersion: '',
            safeMode: false,
          },
          instance.name,
        )
        .then(() => {
          const status = document.querySelector<HTMLElement>('[data-instances-status]');
          if (status) {
            status.textContent = 'Acceso directo creado en el escritorio';
          }
        })
        .catch(() => {
          const status = document.querySelector<HTMLElement>('[data-instances-status]');
          if (status) {
            status.textContent = 'No se pudo crear el acceso directo';
          }
        })
        .finally(() => {
          shortcut.disabled = false;
        });
    });
    actions.append(open, openFolder, duplicate, exportPack, shortcut, archive);
    header.addEventListener('click', () => {
      const opening = content.style.display === 'none';
      if (opening && openedCard && openedCard !== card) {
        const previousContent = openedCard.querySelector<HTMLElement>('.card-content');
        const previousActions = openedCard.querySelector<HTMLElement>('.card-footer');
        const previousIcon = openedCard.querySelector<HTMLElement>('.card-header-icon i');
        if (previousContent) {
          previousContent.style.display = 'none';
        }
        if (previousActions) {
          previousActions.style.display = 'none';
        }
        previousIcon?.classList.remove('fa-angle-up');
        previousIcon?.classList.add('fa-angle-down');
      }
      content.style.display = opening ? 'flex' : 'none';
      actions.style.display = opening ? 'flex' : 'none';
      openedCard = opening ? card : null;
      const icon = chevron.querySelector('i');
      icon?.classList.toggle('fa-angle-down', !opening);
      icon?.classList.toggle('fa-angle-up', opening);
    });
    const cover = document.createElement('div');
    cover.className = 'instance-cover';
    const coverImage = document.createElement('img');
    coverImage.className = 'instance-cover-image';
    coverImage.alt = '';
    coverImage.loading = 'lazy';
    const packBanners = [instance.artwork?.coverUrl, ...(instance.artwork?.coverUrls ?? [])].filter(
      (source): source is string => Boolean(source),
    );
    const coverSources = instance.artwork
      ? [
          ...new Set(
            [...packBanners, instance.artwork.iconUrl, instance.iconDataUrl].filter(
              (source): source is string => Boolean(source),
            ),
          ),
        ]
      : [instanceLoaderBanner(instance.loader)];
    let coverSourceIndex = 0;
    const showNextCover = (): void => {
      const source = coverSources[coverSourceIndex++];
      if (!source) {
        coverImage.remove();
        return;
      }
      coverImage.classList.toggle(
        'instance-cover-image-icon',
        Boolean(instance.artwork && !packBanners.includes(source)),
      );
      coverImage.src = source;
    };
    if (coverSources.length) {
      coverImage.addEventListener('error', showNextCover);
      showNextCover();
      cover.append(coverImage);
    }
    const badge = document.createElement('img');
    badge.className = 'instance-cover-icon';
    badge.src = instance.iconDataUrl ?? instance.artwork?.iconUrl ?? defaultIcon;
    badge.alt = '';
    badge.addEventListener(
      'error',
      () => {
        badge.src = defaultIcon;
      },
      { once: true },
    );
    const versionBadge = document.createElement('span');
    versionBadge.className = 'instance-version-badge';
    versionBadge.textContent = versionLabel;
    cover.append(badge, versionBadge);
    const summary = document.createElement('p');
    summary.className = 'instance-grid-description';
    setUserText(
      summary,
      instance.description || instance.artwork?.description,
      'Tu instancia de Minecraft, lista para una nueva aventura.',
    );
    const metadata = document.createElement('div');
    metadata.className = 'instance-grid-metadata';
    const author = document.createElement('span');
    setUserText(author, instance.artwork?.author, 'Instancia local');
    const downloads = document.createElement('span');
    setUiText(
      downloads,
      instance.artwork ? `${formatCount(instance.artwork.downloads)} descargas` : instance.version,
    );
    metadata.append(author, downloads);
    card.append(cover, header, summary, metadata, content, actions);
    list?.append(card);
  }
  if (visible.length === 0 && list) {
    const empty = emptyState(instances.length ? 'No hay resultados' : 'Todavía no hay instancias');
    empty.classList.add('instances-empty');
    list.append(empty);
  }
}

type InstanceViewMode = 'grid' | 'list';

function setInstanceView(mode: InstanceViewMode): void {
  const list = document.querySelector<HTMLElement>('[data-instances-list]');
  if (!list) {
    return;
  }
  list.dataset.instanceView = mode;
  list.classList.toggle('list-view', mode === 'list');
  list.classList.toggle('grid-view', mode === 'grid');
  document
    .querySelectorAll<HTMLButtonElement>('[data-instances-list-view], [data-instances-grid-view]')
    .forEach((button) => {
      const active =
        (mode === 'list' && button.hasAttribute('data-instances-list-view')) ||
        (mode === 'grid' && button.hasAttribute('data-instances-grid-view'));
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  try {
    privateStorage.setItem('battly:instances-view', mode);
  } catch {
    // The view still works when persistent storage is unavailable.
  }
}

function savedInstanceView(): InstanceViewMode {
  try {
    return privateStorage.getItem('battly:instances-view') === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

const maximumVisibleLaunchLogLines = 200;
let launchLogLines: string[] = [];
let launchLogDecoder = new Log4jLogDecoder();
let launchLogFrame: number | undefined;
let lastLaunchProgressLog = '';
let currentLaunchPhase = 'preparing';
let activeLaunchSurface: 'instance' | 'play' | 'worlds' | null = null;
let worldsLaunchProgress: ((event: MinecraftLaunchEvent) => void) | undefined;
let crashRepairBusy = false;
let crashLaunchAgain: {
  instanceId: string | null;
  start: (allowDuplicateMods?: boolean) => void;
} | null = null;
let instanceLaunchTelemetry = {
  filesStarted: 0,
  filesCompleted: 0,
  bytesPerSecond: 0,
  sample: null as TransferSampleState | null,
  lastSpeedEventAt: 0,
};

function formatLaunchBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '--';
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  if (value < 1_048_576) {
    return `${(value / 1024).toFixed(2)} KB`;
  }
  if (value < 1_073_741_824) {
    return `${(value / 1_048_576).toFixed(2)} MB`;
  }
  return `${(value / 1_073_741_824).toFixed(2)} GB`;
}

function formatLaunchEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function setDiagnosticCopy(element: HTMLElement, source: string): void {
  element.replaceChildren();
  const sentences = catalogParagraphParts(source);
  sentences.forEach((sentence, index) => {
    if (index) {
      element.append(document.createTextNode(' '));
    }
    const text = document.createElement('span');
    setUiText(text, sentence);
    element.append(text);
  });
}

function crashIssueElement(report: MinecraftCrashReport, issue: MinecraftCrashIssue): HTMLElement {
  const article = document.createElement('article');
  article.className = `crash-issue is-${issue.severity}`;
  const header = document.createElement('header');
  const title = document.createElement('h3');
  const modIssue = issue.repairs.some((repair) =>
    ['resolve-mod-conflict', 'install-mod-dependency', 'disable-mod'].includes(repair.kind),
  );
  if (modIssue && !['duplicate-mods', 'sodium-lwjgl-conflict'].includes(issue.id)) {
    setUiText(title, 'Algunos mods impiden abrir Minecraft');
  } else {
    setUiText(title, issue.title);
  }
  const confidence = document.createElement('span');
  confidence.textContent = issue.confidence === 'high' ? 'Coincidencia alta' : 'Revisar';
  header.append(title);
  const description = document.createElement('p');
  description.className = 'crash-description';
  setDiagnosticCopy(description, issue.description);
  article.append(header);
  const evidenceDetails = document.createElement('details');
  evidenceDetails.className = 'crash-evidence-details';
  const evidenceSummary = document.createElement('summary');
  setUiText(evidenceSummary, 'Detalles técnicos');
  evidenceDetails.append(evidenceSummary);
  evidenceDetails.append(confidence);
  evidenceDetails.append(description);
  issue.evidence.slice(0, 4).forEach((entry) => {
    const source = document.createElement('div');
    source.className = 'crash-evidence-source';
    const filename = document.createElement('span');
    setUserText(filename, entry.file);
    const evidence = document.createElement('pre');
    evidence.className = 'crash-evidence';
    evidence.textContent = formatCrashLog(entry.line);
    source.append(filename, evidence);
    evidenceDetails.append(source);
  });
  if (issue.id === 'duplicate-mods') {
    return duplicateModIssue(
      issue,
      (repair) => crashRepairButton(report, repair, true),
      evidenceDetails,
    );
  }
  if (issue.repairs.length) {
    const actions = document.createElement('div');
    actions.className = 'crash-repair-actions';
    if (
      issue.repairs.some(
        (repair) =>
          repair.kind === 'resolve-mod-conflict' || repair.kind === 'install-mod-dependency',
      )
    ) {
      const assistant = document.createElement('div');
      assistant.className = 'crash-mod-assistant';
      const assistantTitle = document.createElement('strong');
      assistantTitle.textContent = 'Asistente de compatibilidad';
      const assistantCopy = document.createElement('span');
      setUiText(assistantCopy, 'Battly guardará una copia para que puedas deshacer el cambio.');
      assistant.append(assistantTitle, assistantCopy);
      actions.append(assistant);
    }
    const individual = document.createElement('div');
    individual.className = 'crash-mod-list';
    const advanced = document.createElement('details');
    advanced.className = 'crash-advanced-options';
    const advancedSummary = document.createElement('summary');
    setUiText(advancedSummary, 'Opciones avanzadas');
    advanced.append(advancedSummary);
    const recommended =
      issue.repairs.find((repair) => repair.kind === 'install-mod-dependency') ??
      issue.repairs.find((repair) => repair.kind === 'resolve-mod-conflict') ??
      issue.repairs.find((repair) => repair.kind !== 'disable-mod') ??
      issue.repairs[0];
    issue.repairs.forEach((repair) => {
      const button = crashRepairButton(report, repair, repair === recommended);
      if (repair === recommended) {
        button.classList.add('crash-recommended-repair');
        const label = document.createElement('span');
        setUiText(
          label,
          crashLaunchAgain && crashLaunchAgain.instanceId === report.instanceId
            ? 'Reparar e iniciar'
            : 'Reparar con Battly',
        );
        const wand = document.createElement('i');
        wand.className = 'fa-solid fa-wand-magic-sparkles';
        wand.setAttribute('aria-hidden', 'true');
        button.replaceChildren(wand, document.createTextNode(' '), label);
        actions.append(button);
        // Keep the same action available in the per-file list when relevant.
        if (repair.kind !== 'disable-mod') {
          return;
        }
      }
      if (repair.kind !== 'disable-mod') {
        advanced.append(button);
        return;
      }
      const row = document.createElement('div');
      row.className = 'crash-mod-row';
      const name = document.createElement('span');
      setUserText(name, repair.label.replace(/^Desactivar\s+/u, ''));
      name.title = name.textContent ?? '';
      const manual = repair === recommended ? crashRepairButton(report, repair) : button;
      setUiText(manual, 'Desactivar');
      manual.setAttribute('aria-label', repair.label);
      manual.classList.add('crash-mod-action');
      row.append(name, manual);
      individual.append(row);
    });
    article.append(actions);
    if (individual.childElementCount) {
      advanced.append(individual);
    }
    if (advanced.childElementCount > 1) {
      article.append(advanced);
    }
  } else {
    article.append(description);
  }
  article.append(evidenceDetails);
  return article;
}

function crashRepairButton(
  report: MinecraftCrashReport,
  repair: MinecraftCrashRepair,
  restartAfterRepair = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button crash-repair-button';
  button.textContent = repair.label;
  if (repair.kind === 'resolve-mod-conflict') {
    const wand = document.createElement('i');
    wand.className = 'fa-solid fa-wand-magic-sparkles';
    wand.setAttribute('aria-hidden', 'true');
    button.prepend(wand, document.createTextNode(' '));
  }
  button.title = repair.description;
  button.addEventListener('click', () => {
    const originalLabel = [...button.childNodes].map((node) => node.cloneNode(true));
    const launchAgain =
      crashLaunchAgain && crashLaunchAgain.instanceId === report.instanceId
        ? crashLaunchAgain
        : null;
    void askBattly({
      title: 'Battly ha encontrado una solución',
      text: repair.description,
      note: /copia|backup|reversible/i.test(repair.description)
        ? undefined
        : 'Battly guardará una copia para que puedas deshacer el cambio.',
      confirmText: restartAfterRepair && launchAgain ? 'Reparar e iniciar' : 'Aplicar solución',
      cancelText: 'Cancelar',
      danger: false,
    }).then(async (accepted) => {
      if (!accepted || crashRepairBusy) {
        return;
      }
      crashRepairBusy = true;
      const status = document.querySelector<HTMLElement>('[data-crash-report-status]');
      button.disabled = true;
      const closeProgress = showCrashRepairProgress(
        report.id,
        repair.id,
        repair.kind === 'install-mod-dependency',
      );
      if (status) {
        status.textContent = 'Aplicando la solución y creando una copia de seguridad…';
      }
      try {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const result = await window.battly.applyCrashRepair(report.id, repair.id);
        await closeProgress();
        if (!result.ok) {
          if (status) {
            status.textContent = result.message;
          }
          button.disabled = false;
          return;
        }
        setUiText(button, 'Solución aplicada');
        const article = button.closest<HTMLElement>('.crash-issue');
        article?.classList.add('is-repaired');
        article?.querySelector('.crash-mod-assistant')?.remove();
        const summary = document.querySelector<HTMLElement>('[data-crash-report-summary]');
        if (summary) {
          setUiText(summary, 'Solución aplicada');
        }
        if (status) {
          setUiText(status, result.message);
        }
        if (result.repairId) {
          const undo = document.createElement('button');
          undo.type = 'button';
          undo.textContent = 'Deshacer';
          undo.addEventListener('click', () => {
            undo.disabled = true;
            void window.battly
              .rollbackCrashRepair(result.repairId as string)
              .then((rollback) => {
                if (status) {
                  status.textContent = rollback.message;
                }
                if (rollback.ok) {
                  undo.remove();
                  article?.classList.remove('is-repaired');
                  article?.querySelector('[data-crash-retry]')?.remove();
                  button.disabled = false;
                  delete button.dataset.uiSource;
                  button.replaceChildren(...originalLabel.map((node) => node.cloneNode(true)));
                } else {
                  undo.disabled = false;
                }
              })
              .catch(() => {
                if (status) {
                  status.textContent = 'No se pudo deshacer la reparación.';
                }
                undo.disabled = false;
              });
          });
          button.parentElement?.append(undo);
        }
        if (launchAgain) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.dataset.crashRetry = '';
          setUiText(retry, 'Iniciar Minecraft');
          retry.onclick = () => {
            if (crashRepairBusy) {
              return;
            }
            retry.disabled = true;
            document.querySelector<HTMLDialogElement>('[data-crash-report-dialog]')?.close();
            launchAgain.start();
          };
          button.parentElement?.append(retry);
          if (restartAfterRepair) {
            crashRepairBusy = false;
            retry.click();
          }
        }
      } catch {
        if (status) {
          status.textContent = 'No se pudo aplicar la solución de forma segura.';
        }
        button.disabled = false;
      } finally {
        await closeProgress();
        crashRepairBusy = false;
      }
    });
  });
  return button;
}

function showCrashReport(report: MinecraftCrashReport): void {
  closeMinecraftProgress('failed');
  if (report.launchRequest && !report.instanceId) {
    const request = { ...report.launchRequest, installOnly: false };
    const label = formatPlayVersion(
      request.installedVersionId ||
        request.customVersion ||
        `${request.loader} ${request.version}${request.loaderVersion ? ` (${request.loaderVersion})` : ''}`,
    );
    crashLaunchAgain = {
      instanceId: null,
      start: (allowDuplicateMods = false) =>
        startPlayVersion({ ...request, allowDuplicateMods }, label),
    };
  }
  const dialog = document.querySelector<HTMLDialogElement>('[data-crash-report-dialog]');
  const summary = document.querySelector<HTMLElement>('[data-crash-report-summary]');
  const issues = document.querySelector<HTMLElement>('[data-crash-report-issues]');
  const log = document.querySelector<HTMLElement>('[data-crash-report-log]');
  const status = document.querySelector<HTMLElement>('[data-crash-report-status]');
  if (!dialog || !issues || !log) {
    return;
  }
  dialog
    .querySelector<HTMLElement>('.crash-report-log-card')
    ?.toggleAttribute('hidden', report.stage === 'preflight');
  const heading = dialog.querySelector<HTMLElement>('[data-crash-report-title]');
  if (heading) {
    setUiText(
      heading,
      report.stage === 'preflight'
        ? 'Revisa los mods antes de iniciar'
        : 'Error al abrir Minecraft',
    );
  }
  if (summary) {
    if (report.stage === 'preflight') {
      setUiText(
        summary,
        'Hay mods con el mismo identificador. Puedes revisarlos o intentar iniciar sin cambiar los archivos.',
      );
    } else if (report.issues.length) {
      summary.replaceChildren();
      setUiText(
        summary,
        report.issues.some((issue) => issue.repairs.length)
          ? 'Minecraft no pudo abrirse. Hemos encontrado una posible solución; empieza por el botón de reparar.'
          : 'Minecraft no pudo abrirse. Guarda los registros y compártelos en Discord para que podamos ayudarte.',
      );
    } else {
      setUiText(summary, report.summary);
    }
  }
  if (status) {
    status.textContent = '';
  }
  let forceLaunch = dialog.querySelector<HTMLButtonElement>('[data-crash-force-launch]');
  if (!forceLaunch) {
    forceLaunch = document.createElement('button');
    forceLaunch.type = 'button';
    forceLaunch.className = 'button is-warning';
    forceLaunch.dataset.crashForceLaunch = '';
    setUiText(forceLaunch, 'Iniciar de todos modos');
    dialog.querySelector('.modal-card-foot')?.prepend(forceLaunch);
  }
  const retry = crashLaunchAgain?.instanceId === report.instanceId ? crashLaunchAgain : null;
  forceLaunch.hidden = report.stage !== 'preflight' || !retry;
  forceLaunch.onclick = () => {
    if (!retry || report.stage !== 'preflight' || crashRepairBusy) {
      return;
    }
    forceLaunch.disabled = true;
    dialog.close();
    retry.start(true);
  };
  forceLaunch.disabled = false;
  renderLogLines(log, formatCrashLog(report.rawLog) || 'No hay registros disponibles.');
  issues.replaceChildren();
  issues.closest('.crash-report-solutions')?.toggleAttribute('hidden', !report.issues.length);
  report.issues.forEach((entry) => issues.append(crashIssueElement(report, entry)));
  const logContent = dialog.querySelector<HTMLElement>('[data-crash-log-content]');
  const logToggle = dialog.querySelector<HTMLButtonElement>('[data-crash-log-toggle]');
  if (logContent) {
    logContent.hidden = true;
  }
  logToggle?.setAttribute('aria-expanded', 'false');
  logToggle?.querySelector('i')?.classList.remove('fa-angle-up');
  logToggle?.querySelector('i')?.classList.add('fa-angle-down');
  if (!dialog.open) {
    dialog.showModal();
  }
  dialog.querySelector<HTMLElement>('.crash-report-body')?.scrollTo(0, 0);
  dialog.querySelector<HTMLButtonElement>('[data-crash-report-close]')?.focus();
}

function appendLaunchLog(message: string, flush = false): void {
  launchLogLines.push(
    ...launchLogDecoder.push(message + '\n').flatMap((entry) => entry.split('\n')),
  );
  if (flush) {
    launchLogLines.push(...launchLogDecoder.flush().flatMap((entry) => entry.split('\n')));
  }
  launchLogLines = launchLogLines.slice(-maximumVisibleLaunchLogLines);
  if (flush) {
    flushLaunchLog();
  } else {
    launchLogFrame ??= requestAnimationFrame(flushLaunchLog);
  }
}

function flushLaunchLog(): void {
  if (launchLogFrame !== undefined) {
    cancelAnimationFrame(launchLogFrame);
  }
  launchLogFrame = undefined;
  const log = document.querySelector<HTMLElement>('[data-launch-log]');
  if (!log) {
    return;
  }
  const contents = launchLogLines.join('\n') || 'Esperando al core…';
  renderLogLines(log, contents);
  log.scrollTop = log.scrollHeight;
}

function readableLaunchPhase(value: string): string {
  const labels: Record<string, string> = {
    assets: 'Descargando recursos',
    'assets-check': 'Comprobando recursos',
    checking: 'Comprobando archivos',
    client: 'Preparando cliente',
    downloading: 'Descargando archivos',
    extract: 'Extrayendo archivos',
    files: 'Comprobando archivos',
    'files-check': 'Comprobando archivos',
    fixture: 'Validando adaptador',
    'horizon-prepare': 'Preparando Horizon',
    libraries: 'Descargando librerías',
    'libraries-check': 'Comprobando librerías',
    labymod: 'Instalando LabyMod',
    'java-runtime': 'Preparando Java',
    'java-download': 'Descargando Java',
    'mesa-recovery': 'Reparando compatibilidad gráfica con Mesa3D',
    'java-check': 'Comprobando Java',
    natives: 'Preparando librerías nativas',
    loader: 'Preparando loader',
    'loader-install': 'Instalando loader',
    preparing: 'Preparando Minecraft',
    ready: 'Iniciando Minecraft',
    runtime: 'Preparando Java',
    'version-json': 'Comprobando versión',
  };
  return labels[value.toLowerCase()] ?? 'Preparando Minecraft';
}

function renderLaunchMeter(
  progress: HTMLProgressElement | null,
  percent: HTMLElement | null,
  value: number | null,
): void {
  if (progress) {
    progress.max = 100;
    if (value === null) {
      progress.removeAttribute('value');
    } else {
      progress.value = value;
    }
  }
  if (percent) {
    percent.textContent = value === null ? '' : `${value}%`;
  }
}

function launchProgressPercent(current: number, total: number): number | null {
  return total > 0 ? Math.floor(Math.max(0, Math.min(100, (current / total) * 100))) : null;
}

function launchCounterPhase(event: 'progress' | 'check'): string {
  if (event === 'check' && !/check|^files$|^version-json$/i.test(currentLaunchPhase)) {
    return 'checking';
  }
  return currentLaunchPhase;
}

function renderInstanceLaunchEvent(event: MinecraftLaunchEvent): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-instance-launch-dialog]');
  const message = document.querySelector<HTMLElement>('[data-instance-launch-message]');
  const progress = document.querySelector<HTMLProgressElement>('[data-instance-launch-progress]');
  const percent = document.querySelector<HTMLElement>('[data-instance-launch-percent]');
  const phase = document.querySelector<HTMLElement>('[data-instance-launch-phase]');
  const file = document.querySelector<HTMLElement>('[data-instance-launch-file]');
  const files = document.querySelector<HTMLElement>('[data-instance-launch-files]');
  const transferred = document.querySelector<HTMLElement>('[data-instance-launch-transferred]');
  const speed = document.querySelector<HTMLElement>('[data-instance-launch-speed]');
  const eta = document.querySelector<HTMLElement>('[data-instance-launch-eta]');
  const spinner = document.querySelector<HTMLElement>('[data-instance-launch-spinner]');
  const cancel = document.querySelector<HTMLButtonElement>('[data-instance-launch-cancel]');
  if (event.type === 'log') {
    appendLaunchLog(event.message);
  }
  if (event.type === 'phase') {
    appendLaunchLog(`[fase] ${readableLaunchPhase(event.phase)}`);
  }
  if (event.type === 'state') {
    appendLaunchLog(`[estado] ${event.state}`);
  }
  if (event.type === 'exit') {
    appendLaunchLog(
      `[salida] código=${event.code === null ? 'desconocido' : String(event.code)} señal=${event.signal ?? 'ninguna'}`,
    );
  }
  if (dialog && !dialog.open) {
    dialog.showModal();
  }
  if (event.type === 'phase') {
    currentLaunchPhase = event.phase;
    const readable = readableLaunchPhase(event.phase);
    if (message) {
      message.textContent = readable;
    }
    if (phase) {
      setUiText(phase, readableLaunchPhase(event.phase));
    }
    renderLaunchMeter(progress, percent, event.phase.toLowerCase() === 'ready' ? 100 : null);
    instanceLaunchTelemetry.sample = null;
    if (speed) {
      speed.hidden = true;
    }
    if (eta) {
      eta.hidden = true;
    }
  }
  if (event.type === 'progress' || event.type === 'check') {
    const overall = launchProgressPercent(event.current, event.total);
    const readable = readableLaunchPhase(launchCounterPhase(event.type));
    renderLaunchMeter(progress, percent, overall);
    if (message) {
      setUiText(message, readable);
    }
    if (phase) {
      setUiText(phase, readable);
    }
    if (file) {
      file.textContent = `Archivo: ${event.item.split(/[\\/]/).at(-1) ?? event.item}`;
    }
    const looksLikeBytes =
      event.type === 'progress' &&
      (event.unit === 'bytes' ||
        (event.unit === undefined &&
          !isInstallOnlyPhase(currentLaunchPhase) &&
          event.total >= 1024));
    if (files) {
      files.textContent = looksLikeBytes
        ? `Archivos: ${instanceLaunchTelemetry.filesCompleted}/${Math.max(instanceLaunchTelemetry.filesStarted, instanceLaunchTelemetry.filesCompleted) || '—'}`
        : `Archivos: ${event.current}/${event.total}`;
    }
    if (transferred) {
      transferred.textContent = looksLikeBytes
        ? `Transferido: ${formatLaunchBytes(event.current)} / ${formatLaunchBytes(event.total)}`
        : `Progreso: ${event.current} / ${event.total}`;
    }
    if (speed) {
      speed.hidden = !looksLikeBytes;
    }
    if (eta) {
      eta.hidden = !looksLikeBytes;
    }
    if (looksLikeBytes && overall !== null) {
      const sampled = sampleTransfer(instanceLaunchTelemetry.sample, event, performance.now());
      instanceLaunchTelemetry.sample = sampled.state;
      if (sampled.sample) {
        instanceLaunchTelemetry.bytesPerSecond = sampled.sample.bytesPerSecond;
        if (speed) {
          speed.textContent = `Velocidad: ${formatLaunchBytes(sampled.sample.bytesPerSecond)}/s`;
        }
        if (eta) {
          eta.textContent = `ETA: ${formatLaunchEta(sampled.sample.etaSeconds)}`;
        }
      }
    }
  }
  if (event.type === 'speed') {
    const now = performance.now();
    if (
      !isInstallOnlyPhase(currentLaunchPhase) &&
      now - instanceLaunchTelemetry.lastSpeedEventAt >= 3_000
    ) {
      instanceLaunchTelemetry.lastSpeedEventAt = now;
      instanceLaunchTelemetry.bytesPerSecond = event.bytesPerSecond;
      if (speed) {
        speed.hidden = false;
        speed.textContent = `Velocidad: ${formatLaunchBytes(event.bytesPerSecond)}/s`;
      }
    }
  }
  if (event.type === 'file-start' || event.type === 'file-complete') {
    if (event.type === 'file-start') {
      instanceLaunchTelemetry.filesStarted += 1;
    } else {
      instanceLaunchTelemetry.filesCompleted += 1;
    }
    if (file) {
      setUiText(
        file,
        event.type === 'file-complete'
          ? `Archivo verificado: ${event.item}`
          : `Archivo: ${event.item}`,
      );
    }
    if (files) {
      files.textContent = `Archivos: ${instanceLaunchTelemetry.filesCompleted}/${Math.max(instanceLaunchTelemetry.filesStarted, instanceLaunchTelemetry.filesCompleted)}`;
    }
  }
  if (event.type === 'client-ready') {
    if (message) {
      message.textContent = 'Minecraft iniciado';
    }
    if (progress) {
      progress.max = 100;
      progress.value = 100;
    }
    if (percent) {
      percent.textContent = '100.00%';
    }
    document.body.dataset.launchState = 'ready';
    activeLaunchSurface = null;
    dialog?.close();
  }
  if (event.type === 'state') {
    document.body.dataset.launchState = event.state;
    if (event.state === 'running' && message) {
      message.textContent = 'Iniciando Minecraft';
    }
    if (event.state === 'running') {
      if (phase) {
        phase.textContent = 'Iniciando Minecraft';
      }
      if (file) {
        file.textContent = '';
      }
      if (progress) {
        progress.max = 100;
        progress.value = 100;
      }
      if (percent) {
        percent.textContent = '100%';
      }
    }
    if (event.state === 'failed') {
      if (message) {
        message.textContent = 'No se pudo iniciar la instancia';
      }
      spinner?.classList.remove('fa-spinner', 'fa-spin-pulse');
      spinner?.classList.add('fa-triangle-exclamation');
      if (cancel) {
        cancel.disabled = false;
        cancel.textContent = 'Cerrar';
      }
    }
    if (event.state === 'exited') {
      activeLaunchSurface = null;
      dialog?.close();
    }
  }
}

function launchStatusElement(): HTMLElement | null {
  const downloading = document
    .querySelector('[data-launch-dialog]')
    ?.classList.contains('is-installing');
  return document.querySelector<HTMLElement>(
    downloading ? '[data-launch-download-status]' : '[data-launch-status]',
  );
}

function closeMinecraftProgress(state: 'failed' | 'exited'): void {
  appendLaunchLog('', true);
  minecraftLaunchPreparing = false;
  activeLaunchSurface = null;
  worldsLaunchProgress = undefined;
  document.body.dataset.launchState = state;
  document.querySelector<HTMLDialogElement>('[data-launch-dialog]')?.close();
  document.querySelector<HTMLDialogElement>('[data-instance-launch-dialog]')?.close();
}

function renderLaunchEvent(event: MinecraftLaunchEvent): void {
  if (event.type === 'memory-warning') {
    if (event.severity === 'safe') {
      return;
    }
    showToast(
      event.severity === 'unknown' ? 'No se pudo comprobar la memoria' : 'Memoria insuficiente',
      event.severity === 'unknown'
        ? 'Minecraft se iniciará sin comprobar la memoria disponible.'
        : 'No hay suficiente memoria disponible. Cierra otras aplicaciones o reduce la RAM asignada en Ajustes.',
      'warning',
      9_000,
    );
    return;
  }
  if (activeLaunchSurface === 'worlds') {
    worldsLaunchProgress?.(event);
  }
  const terminalState =
    event.type === 'exit'
      ? 'exited'
      : event.type === 'state' && (event.state === 'failed' || event.state === 'exited')
        ? event.state
        : null;
  if (terminalState) {
    const alreadyFinished = ['failed', 'exited'].includes(document.body.dataset.launchState ?? '');
    appendLaunchLog(
      event.type === 'exit'
        ? `[salida] código=${event.code ?? 'desconocido'} señal=${event.signal ?? 'ninguna'}`
        : `[estado] ${terminalState}`,
    );
    closeMinecraftProgress(terminalState);
    if (terminalState === 'failed' && !alreadyFinished) {
      showToast(
        'No se pudo iniciar Minecraft',
        'Consulta los registros o el informe del fallo.',
        'error',
        7_000,
      );
    }
    return;
  }
  // Download callbacks and flushed logs can arrive after the process has ended.
  if (
    ['failed', 'exited'].includes(document.body.dataset.launchState ?? '') &&
    !(event.type === 'state' && event.state === 'preparing')
  ) {
    if (event.type === 'log') {
      appendLaunchLog(event.message);
    }
    return;
  }
  if (event.type === 'state') {
    minecraftLaunchPreparing = event.state === 'preparing';
  }
  // Late progress from a parallel download must not replace the game startup state.
  if (
    ['running', 'ready'].includes(document.body.dataset.launchState ?? '') &&
    ['phase', 'progress', 'check', 'file-start', 'file-complete'].includes(event.type)
  ) {
    return;
  }
  if (activeLaunchSurface === 'instance') {
    renderInstanceLaunchEvent(event);
    return;
  }
  if (activeLaunchSurface === 'worlds') {
    if (event.type === 'log') {
      appendLaunchLog(event.message);
    }
    if (event.type === 'state') {
      document.body.dataset.launchState = event.state;
    }
    if (event.type === 'client-ready') {
      document.body.dataset.launchState = 'ready';
      minecraftLaunchPreparing = false;
      activeLaunchSurface = null;
      worldsLaunchProgress = undefined;
    }
    return;
  }
  const dialog = document.querySelector<HTMLDialogElement>('[data-launch-dialog]');
  const phase = document.querySelector<HTMLElement>('[data-launch-phase]');
  const status = launchStatusElement();
  const progress = document.querySelector<HTMLProgressElement>('[data-launch-progress]');
  const percent = document.querySelector<HTMLElement>('[data-launch-percent]');
  const files = document.querySelector<HTMLElement>('[data-launch-files]');
  const filesIcon = document.querySelector<HTMLElement>('[data-launch-files-icon]');
  const gameIcon = document.querySelector<HTMLElement>('[data-launch-game-icon]');
  const cancel = document.querySelector<HTMLButtonElement>('[data-launch-cancel]');
  const close = document.querySelector<HTMLButtonElement>('[data-launch-close]');
  if (!dialog?.open && activeLaunchSurface === 'play') {
    dialog?.showModal();
  }
  if (event.type === 'phase') {
    currentLaunchPhase = event.phase;
    const readable = readableLaunchPhase(event.phase);
    if (phase) {
      phase.textContent = readable;
      phase.removeAttribute('title');
    }
    if (files) {
      files.textContent = readable;
      files.removeAttribute('title');
    }
    lastLaunchProgressLog = '';
    renderLaunchMeter(progress, percent, event.phase.toLowerCase() === 'ready' ? 100 : null);
    appendLaunchLog(`[fase] ${readable}`);
  }
  if (event.type === 'progress' || event.type === 'check') {
    const progressPercent = launchProgressPercent(event.current, event.total);
    renderLaunchMeter(progress, percent, progressPercent);
    const readable =
      currentLaunchPhase === 'labymod'
        ? event.item
        : readableLaunchPhase(launchCounterPhase(event.type));
    if (phase) {
      phase.textContent = readable;
      phase.title = event.item;
    }
    if (files) {
      files.textContent = readable;
      files.title = event.item;
    }
    const unit = event.type === 'progress' ? event.unit : 'files';
    const bytes = unit === 'bytes' || (unit === undefined && event.total >= 1_048_576);
    const current = bytes ? formatLaunchBytes(event.current) : String(event.current);
    const total = bytes ? formatLaunchBytes(event.total) : String(event.total);
    const progressLog = `${event.item}|${Math.floor((progressPercent ?? 0) / 5)}`;
    if (progressPercent !== null && progressLog !== lastLaunchProgressLog) {
      lastLaunchProgressLog = progressLog;
      appendLaunchLog(
        unit === 'percent'
          ? `[progreso] ${event.item}: ${progressPercent}%`
          : `[progreso] ${event.item}: ${current} / ${total} (${progressPercent}%)`,
      );
    }
  }
  if (event.type === 'log') {
    appendLaunchLog(event.message);
  }
  if (event.type === 'client-ready') {
    if (status) {
      status.textContent = 'Minecraft iniciado';
    }
    if (progress) {
      progress.max = 100;
      progress.value = 100;
    }
    if (percent) {
      percent.textContent = '100%';
    }
    gameIcon?.classList.remove('fa-sync', 'fa-spin');
    gameIcon?.classList.add('fa-check');
    document.body.dataset.launchState = 'ready';
    activeLaunchSurface = null;
    dialog?.close();
  }
  if (event.type === 'exit') {
    appendLaunchLog(
      `[salida] código=${event.code === null ? 'desconocido' : String(event.code)} señal=${event.signal ?? 'ninguna'}`,
    );
  }
  if (event.type === 'state') {
    appendLaunchLog(`[estado] ${event.state}`);
    document.body.dataset.launchState = event.state;
    if (status) {
      status.textContent =
        event.state === 'preparing'
          ? 'Preparando…'
          : event.state === 'running'
            ? 'Iniciando Minecraft'
            : event.state === 'exited'
              ? 'Minecraft cerrado'
              : 'No se pudo iniciar Minecraft';
    }
    const finished = event.state === 'exited' || event.state === 'failed';
    if (event.state === 'running') {
      // Keep the originating download layout through startup and terminal states.
      if (dialog?.classList.contains('is-installing')) {
        const downloadTitle = document.querySelector<HTMLElement>('[data-launch-download-title]');
        if (downloadTitle) {
          downloadTitle.textContent = 'Iniciando Minecraft';
        }
      }
      if (phase) {
        phase.textContent = 'Iniciando Minecraft';
      }
      if (files) {
        setUiText(files, 'Archivos preparados');
      }
      const title = document.querySelector<HTMLElement>('#launch-title');
      if (title) {
        title.textContent = 'Iniciando Minecraft';
      }
      if (progress) {
        progress.max = 100;
        progress.removeAttribute('value');
      }
      if (percent) {
        percent.textContent = '';
      }
      filesIcon?.classList.remove('fa-sync', 'fa-spin');
      filesIcon?.classList.add('fa-check');
      gameIcon?.classList.remove('fa-check', 'fa-xmark');
      gameIcon?.classList.add('fa-sync', 'fa-spin');
    }
    if (event.state === 'failed') {
      if (dialog?.classList.contains('is-installing')) {
        const heading = document.querySelector<HTMLElement>('[data-launch-download-title]');
        if (heading) {
          heading.textContent = 'Instalación interrumpida';
        }
      }
      gameIcon?.classList.remove('fa-sync', 'fa-spin');
      gameIcon?.classList.add('fa-xmark');
      showToast(
        'No se pudo iniciar Minecraft',
        'Abre los detalles del launcher para ver el fallo.',
        'error',
        7_000,
      );
    }
    if (cancel) {
      cancel.hidden = finished;
    }
    if (close) {
      close.hidden = !finished;
    }
    if (event.state === 'exited') {
      activeLaunchSurface = null;
      if (!dialog?.classList.contains('is-installing')) {
        dialog?.close();
      }
    }
  }
}

// Preparation shares downloaded files; running Java processes are independent.
let minecraftLaunchPreparing = false;
let launchUiSequence = 0;

function showActiveMinecraftNotice(): boolean {
  if (!minecraftLaunchPreparing) {
    return false;
  }
  showToast(
    'Preparando Minecraft',
    'Espera a que termine la preparación. Después puedes abrir otra partida sin cerrar la anterior.',
    'info',
  );
  return true;
}

function startInstance(
  instance: InstanceSummary,
  safeMode = false,
  directConnect: { readonly host: string; readonly port: number } | null = null,
  javaPath?: string,
  allowDuplicateMods = false,
): void {
  if (showActiveMinecraftNotice()) {
    return;
  }
  crashLaunchAgain = {
    instanceId: instance.id,
    start: (allowDuplicateMods = false) =>
      startInstance(instance, safeMode, directConnect, javaPath, allowDuplicateMods),
  };
  minecraftLaunchPreparing = true;
  const launchSequence = ++launchUiSequence;
  const instancesDialog = document.querySelector<HTMLElement>('[data-instances-dialog]');
  const playDialog = document.querySelector<HTMLElement>('[data-play-dialog]');
  const launchDialog = document.querySelector<HTMLDialogElement>('[data-instance-launch-dialog]');
  activeLaunchSurface = 'instance';
  setInstallArtwork(
    document.querySelector('[data-instance-launch-dialog]'),
    instance.name,
    instance.artwork?.coverUrl ||
      instance.artwork?.coverUrls?.[0] ||
      instanceLoaderBanner(instance.loader),
    instance.iconDataUrl || instance.artwork?.iconUrl,
  );
  launchLogLines = [];
  launchLogDecoder = new Log4jLogDecoder();
  if (directConnect) {
    appendLaunchLog(`[servidor] ${directConnect.host}:${directConnect.port}`);
  }
  instanceLaunchTelemetry = {
    filesStarted: 0,
    filesCompleted: 0,
    bytesPerSecond: 0,
    sample: null,
    lastSpeedEventAt: 0,
  };
  hideLegacyModal(instancesDialog);
  hideLegacyModal(playDialog);
  rememberInstanceLaunch(instance.id);
  if (launchDialog && !launchDialog.open) {
    launchDialog.showModal();
  }
  document.body.dataset.launchState = 'preparing';
  const status = document.querySelector<HTMLElement>('[data-instance-launch-message]');
  const details = document.querySelector<HTMLElement>('[data-instance-launch-details]');
  const progress = document.querySelector<HTMLProgressElement>('[data-instance-launch-progress]');
  const percent = document.querySelector<HTMLElement>('[data-instance-launch-percent]');
  const cancel = document.querySelector<HTMLButtonElement>('[data-instance-launch-cancel]');
  const spinner = document.querySelector<HTMLElement>('[data-instance-launch-spinner]');
  const file = document.querySelector<HTMLElement>('[data-instance-launch-file]');
  const files = document.querySelector<HTMLElement>('[data-instance-launch-files]');
  const transferred = document.querySelector<HTMLElement>('[data-instance-launch-transferred]');
  const speed = document.querySelector<HTMLElement>('[data-instance-launch-speed]');
  const eta = document.querySelector<HTMLElement>('[data-instance-launch-eta]');
  const phase = document.querySelector<HTMLElement>('[data-instance-launch-phase]');
  if (progress) {
    progress.value = 0;
  }
  if (percent) {
    percent.textContent = '0.00%';
  }
  if (file) {
    file.textContent = 'Archivo: esperando al core';
  }
  if (files) {
    files.textContent = 'Archivos: preparando';
  }
  if (transferred) {
    transferred.textContent = 'Transferido: sin descarga activa';
  }
  if (speed) {
    speed.hidden = true;
    speed.textContent = 'Velocidad: calculando';
  }
  if (eta) {
    eta.hidden = true;
    eta.textContent = 'ETA: calculando';
  }
  if (phase) {
    setUiText(phase, readableLaunchPhase('preparing'));
  }
  if (details) {
    details.textContent = `Versión: ${instance.version} | Loader: ${instance.loader ?? 'vanilla'}`;
    void window.battly.getAccounts().then((accounts) => {
      const account = accounts.accounts.find((candidate) => candidate.selected);
      details.textContent = `Cuenta: ${account?.name ?? 'Desconocido'} | Versión: ${instance.version} | Loader: ${instance.loader ?? 'vanilla'}`;
    });
  }
  document.querySelectorAll<HTMLElement>('[data-instance-phase-card]').forEach((card) => {
    card.classList.remove('is-expanded');
  });
  if (cancel) {
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = 'Cancelar';
  }
  spinner?.classList.remove('fa-triangle-exclamation');
  spinner?.classList.add('fa-spinner', 'fa-spin-pulse');
  if (status) {
    status.textContent = safeMode
      ? `Aislando temporalmente las personalizaciones de ${instance.name}…`
      : `Preparando ${instance.name}…`;
  }
  void window.battly
    .startInstance(instance.id, {
      directConnect,
      safeMode,
      allowDuplicateMods,
      ...(javaPath ? { javaPath } : {}),
    })
    .then((outcome) => {
      if (launchSequence !== launchUiSequence) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.code === 'cancelled') {
          renderLaunchEvent({ type: 'state', state: 'exited' });
          activeLaunchSurface = null;
          launchDialog?.close();
          return;
        }
        if (outcome.code === 'busy') {
          minecraftLaunchPreparing = false;
          document.body.dataset.launchState = outcome.state;
          activeLaunchSurface = null;
          launchDialog?.close();
          showToast('Preparando Minecraft', outcome.message, 'info');
          return;
        }
        renderLaunchEvent({ type: 'state', state: 'failed' });
        if (status) {
          status.textContent = outcome.message;
        }
      }
    })
    .catch(() => {
      if (launchSequence !== launchUiSequence) {
        return;
      }
      renderLaunchEvent({ type: 'state', state: 'failed' });
      if (status) {
        status.textContent = 'Battly no pudo comunicarse con el servicio de lanzamiento';
      }
    });
}

function startPlayVersion(
  request: PlayVersionLaunchRequest,
  label: string,
  installMode = false,
  inlineProgress?: (event: MinecraftLaunchEvent) => void,
): void {
  if (showActiveMinecraftNotice()) {
    inlineProgress?.({ type: 'state', state: 'failed' });
    return;
  }
  if (
    !installMode &&
    !request.directConnect &&
    playSelectorServer &&
    document.querySelector('[data-play-dialog]')?.classList.contains('is-active')
  ) {
    request = { ...request, directConnect: playSelectorServer };
  }
  playSelectorServer = null;
  playSelectorRevision += 1;
  if (!installMode) {
    crashLaunchAgain = {
      instanceId: null,
      start: (allowDuplicateMods = false) =>
        startPlayVersion({ ...request, allowDuplicateMods }, label),
    };
  }
  minecraftLaunchPreparing = true;
  const launchSequence = ++launchUiSequence;
  activeLaunchSurface = inlineProgress ? 'worlds' : 'play';
  worldsLaunchProgress = inlineProgress;
  hideLegacyModal(document.querySelector<HTMLElement>('[data-play-dialog]'));
  const launchDialog = document.querySelector<HTMLDialogElement>('[data-launch-dialog]');
  launchDialog?.classList.toggle('is-installing', installMode);
  if (launchDialog && !launchDialog.open && !inlineProgress) {
    launchDialog.showModal();
  }
  document.body.dataset.launchState = 'preparing';
  const status = launchStatusElement();
  const files = document.querySelector<HTMLElement>('[data-launch-files]');
  const progress = document.querySelector<HTMLProgressElement>('[data-launch-progress]');
  const percent = document.querySelector<HTMLElement>('[data-launch-percent]');
  const detailsToggle = document.querySelector<HTMLButtonElement>('[data-launch-details-toggle]');
  const log = document.querySelector<HTMLElement>('[data-launch-log]');
  const cancel = document.querySelector<HTMLButtonElement>('[data-launch-cancel]');
  const close = document.querySelector<HTMLButtonElement>('[data-launch-close]');
  if (files) {
    files.textContent = 'Comprobando archivos...';
  }
  renderLaunchMeter(progress, percent, null);
  launchLogLines = [];
  launchLogDecoder = new Log4jLogDecoder();
  lastLaunchProgressLog = '';
  currentLaunchPhase = 'preparing';
  appendLaunchLog(`[versión] ${label}`);
  if (detailsToggle) {
    detailsToggle.hidden = false;
    detailsToggle.setAttribute('aria-expanded', 'false');
    detailsToggle.innerHTML =
      '<i class="fa-solid fa-terminal" aria-hidden="true"></i> Mostrar detalles';
  }
  if (log) {
    log.hidden = !installMode;
  }
  if (cancel) {
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = 'Cancelar';
  }
  if (close) {
    close.hidden = true;
  }
  for (const selector of ['[data-launch-files-icon]', '[data-launch-game-icon]']) {
    const icon = document.querySelector<HTMLElement>(selector);
    icon?.classList.remove('fa-check', 'fa-xmark');
    icon?.classList.add('fa-sync', 'fa-spin');
  }
  const launchTitle = document.querySelector<HTMLElement>('#launch-title');
  const downloadTitle = document.querySelector<HTMLElement>('[data-launch-download-title]');
  const tip = document.querySelector<HTMLElement>('[data-launch-tip]');
  const tipTitle = document.querySelector<HTMLElement>('[data-launch-tip-title]');
  if (tipTitle) {
    tipTitle.textContent = legacyString('download.funFact') ?? '';
  }
  if (tip) {
    tip.textContent =
      legacyString(`download.funFacts.${Math.floor(Math.random() * 5)}`) ??
      legacyString('download.funFactText') ??
      '';
  }
  if (launchTitle) {
    launchTitle.textContent = installMode
      ? 'Descargando versión...'
      : request.safeMode
        ? 'Minecraft está iniciando en modo seguro...'
        : 'Minecraft está iniciando...';
  }
  if (downloadTitle) {
    downloadTitle.textContent = `Descargando ${label}...`;
  }
  if (status) {
    status.textContent = request.safeMode
      ? `Aislando temporalmente las personalizaciones de ${label}…`
      : `Preparando ${label}…`;
  }
  void window.battly
    .startPlayVersion(request)
    .then((outcome) => {
      if (launchSequence !== launchUiSequence) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.code === 'cancelled') {
          renderLaunchEvent({ type: 'state', state: 'exited' });
          activeLaunchSurface = null;
          launchDialog?.close();
          return;
        }
        if (outcome.code === 'busy') {
          if (inlineProgress) {
            renderLaunchEvent({ type: 'state', state: 'failed' });
          }
          minecraftLaunchPreparing = false;
          document.body.dataset.launchState = outcome.state;
          activeLaunchSurface = null;
          launchDialog?.close();
          showToast('Preparando Minecraft', outcome.message, 'info');
          return;
        }
        renderLaunchEvent({ type: 'state', state: 'failed' });
        if (status) {
          status.textContent = outcome.message;
        }
      }
    })
    .catch(() => {
      if (launchSequence !== launchUiSequence) {
        return;
      }
      renderLaunchEvent({ type: 'state', state: 'failed' });
      if (status) {
        status.textContent = 'Battly no pudo comunicarse con el servicio de lanzamiento';
      }
    });
}

function instanceDraftFromForm(form: HTMLFormElement, iconDataUrl?: string): InstanceDraft {
  const values = new FormData(form);
  const text = (name: string): string => {
    const value = values.get(name);
    return typeof value === 'string' ? value : '';
  };
  const javaVersion = text('javaVersion');
  return {
    name: text('name'),
    description: text('description'),
    version: text('version'),
    loader: text('loader') || null,
    loaderVersion: text('loaderVersion') || null,
    ...(iconDataUrl ? { iconDataUrl } : {}),
    launchProfile: {
      ramMinGb: text('ramMode') === 'custom' ? Number(text('ramMinGb')) : null,
      ramMaxGb: text('ramMode') === 'custom' ? Number(text('ramMaxGb')) : null,
      javaVersion:
        javaVersion === 'automatic' || javaVersion === 'custom-path' ? javaVersion : 'global',
      javaPath: text('javaPath'),
      jvmArgs: text('jvmArgs'),
    },
  };
}

function readInstanceIcon(file: File | undefined): Promise<string | undefined> {
  if (!file) {
    return Promise.resolve(undefined);
  }
  const supportedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  const supportedName = /\.(?:jpe?g|png|webp)$/i.test(file.name);
  if ((!supportedType && !supportedName) || file.size > 1024 * 1024) {
    return Promise.reject(new TypeError('La imagen debe ser PNG, JPG o WebP de hasta 1 MB'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () =>
      resolve(typeof reader.result === 'string' ? reader.result : undefined),
    );
    reader.addEventListener('error', () => reject(reader.error ?? new Error('No se pudo leer')));
    reader.readAsDataURL(file);
  });
}

function bindLegacyDownloadPanel(): void {
  const dialog = document.querySelector<HTMLElement>('[data-download-dialog]');
  if (dialog) {
    fitDownloadVersionLabels(dialog);
  }
  const typePanel = document.querySelector<HTMLElement>('#version-type-panel');
  const vanillaTypePanel = document.querySelector<HTMLElement>(
    '[data-download-vanilla-type-panel]',
  );
  const versionPanel = document.querySelector<HTMLElement>('[data-download-version-panel]');
  const loaderVersionPanel = document.querySelector<HTMLElement>(
    '[data-download-loader-version-panel]',
  );
  const labyModPanel = document.querySelector<HTMLElement>('[data-download-labymod-panel]');
  const battlyClientPanel = document.querySelector<HTMLElement>(
    '[data-download-battly-client-panel]',
  );
  const battlyClientVersions = document.querySelector<HTMLElement>(
    '[data-download-battly-client-versions]',
  );
  const battlyClientSearch = document.querySelector<HTMLInputElement>(
    '[data-download-battly-client-search]',
  );
  const battlyClientChannel = document.querySelector<HTMLSelectElement>(
    '[data-download-battly-client-channel]',
  );
  const versions = document.querySelector<HTMLElement>('[data-download-versions]');
  const loaderVersions = document.querySelector<HTMLElement>('[data-download-loader-versions]');
  const labyModVersions = document.querySelector<HTMLElement>('[data-download-labymod-versions]');
  const create = document.querySelector<HTMLButtonElement>('[data-download-create]');
  const back = document.querySelector<HTMLButtonElement>('[data-download-back]');
  const search = document.querySelector<HTMLInputElement>('[data-download-search]');
  const loaderVersionSearch = document.querySelector<HTMLInputElement>(
    '[data-download-loader-version-search]',
  );
  const optiForge = document.querySelector<HTMLInputElement>('[data-download-optiforge]');
  const optiForgeRow = document.querySelector<HTMLElement>('[data-download-optiforge-row]');
  const loaderVersionTitle = document.querySelector<HTMLElement>(
    '[data-download-loader-version-title]',
  );
  const labyModSearch = document.querySelector<HTMLInputElement>('[data-download-labymod-search]');
  const pages = {
    loaders: typePanel,
    vanilla: vanillaTypePanel,
    versions: versionPanel,
    loaderVersions: loaderVersionPanel,
    labymod: labyModPanel,
    battlyClient: battlyClientPanel,
  } as const;
  type DownloadPage = keyof typeof pages;
  let activePage: DownloadPage = 'loaders';
  let history: DownloadPage[] = [];
  let selectedLoader = '';
  let selectedVersion = '';
  let selectedLoaderVersion: string | null = null;
  let selectedRequiredJava = '';
  let selectedLabyMod = false;
  let battlyBuildsRevision = 0;
  let versionsRevision = 0;
  let buildsRevision = 0;
  const loaderCatalog = new LoaderCatalogCache(privateStorage, window.battly);
  const battlyClientStatus = document.querySelector<HTMLElement>(
    '[data-download-battly-client-status]',
  );
  let battlyClientLoading = false;
  const showBattlyClientState = (
    state: 'loading' | 'empty' | 'search' | 'error',
    message: string,
  ): void => {
    if (!battlyClientStatus) {
      return;
    }
    const icon = document.createElement('i');
    icon.className = `fa-solid ${state === 'loading' ? 'fa-spinner fa-spin' : state === 'error' ? 'fa-triangle-exclamation' : state === 'search' ? 'fa-magnifying-glass' : 'fa-layer-group'}`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.textContent = message;
    battlyClientStatus.replaceChildren(
      state === 'empty' || state === 'search' ? thinkingSteveImage() : icon,
      text,
    );
    battlyClientStatus.dataset.state = state;
    battlyClientStatus.hidden = false;
  };
  const filterBattlyClientBuilds = (): void => {
    if (battlyClientLoading) {
      return;
    }
    const rows = [...(battlyClientVersions?.querySelectorAll<HTMLElement>('label') || [])];
    for (const row of rows) {
      row.hidden = !matchesSearch(row.textContent || '', battlyClientSearch);
    }
    const hiddenSelection = rows.find(
      (row) => row.hidden && row.querySelector<HTMLInputElement>('input')?.checked,
    );
    if (hiddenSelection) {
      const input = hiddenSelection.querySelector<HTMLInputElement>('input');
      if (input) {
        input.checked = false;
      }
      selectedVersion = '';
      selectedRequiredJava = '';
      if (create) {
        create.style.visibility = 'hidden';
      }
    }

    if (rows.length && !rows.some((row) => !row.hidden)) {
      showBattlyClientState('search', 'No hay versiones que coincidan con tu búsqueda.');
    } else if (rows.length && battlyClientStatus) {
      battlyClientStatus.hidden = true;
    }
  };

  const renderBattlyClientBuilds = async (): Promise<void> => {
    const revision = ++battlyBuildsRevision;
    selectedVersion = '';
    if (create) {
      create.style.visibility = 'hidden';
    }
    battlyClientLoading = true;
    battlyClientVersions?.replaceChildren();
    showBattlyClientState('loading', 'Cargando versiones...');
    battlyClientVersions?.setAttribute('aria-busy', 'true');
    try {
      const available = await window.battly.getBattlyClientBuilds();
      if (revision !== battlyBuildsRevision || activePage !== 'battlyClient') {
        return;
      }
      battlyClientVersions?.replaceChildren();
      if (battlyClientStatus) {
        battlyClientStatus.hidden = true;
      }
      const latest = new Set<string>();
      for (const item of [...available].sort(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.build - a.build,
      )) {
        if (
          item.channel !== (battlyClientChannel?.value || 'stable') ||
          latest.has(item.minecraftVersion)
        ) {
          continue;
        }
        latest.add(item.minecraftVersion);
        const label = document.createElement('label');
        label.className = 'label';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'download-battly-client-build';
        input.value = item.id;
        const text = document.createElement('p');
        text.className = 'texto';
        const betaNumber = /(?:^|[.-])beta[.-]?(\d+)(?:$|[.+-])/i.exec(item.clientVersion)?.[1];
        const channelName =
          battlyClientChannel?.selectedOptions[0]?.textContent?.trim() || item.channel;
        text.textContent = `${item.minecraftVersion} · ${channelName}${betaNumber ? ` ${betaNumber}` : ''}`;
        label.title = `Minecraft ${item.minecraftVersion} · ${item.clientVersion} · Build ${item.build}`;
        label.hidden = !matchesSearch(text.textContent, battlyClientSearch);
        input.addEventListener('change', () => {
          selectedVersion = item.id;
          selectedRequiredJava = String(item.javaVersion);
          if (create) {
            create.style.visibility = 'visible';
          }
        });
        label.append(input, text);
        markIncompatible(input, label, item.minecraftVersion, String(item.javaVersion));
        battlyClientVersions?.append(label);
      }
      battlyClientLoading = false;
      if (!latest.size) {
        showBattlyClientState('empty', 'No hay versiones disponibles para este canal y equipo.');
      } else {
        filterBattlyClientBuilds();
      }
    } catch {
      if (revision !== battlyBuildsRevision) {
        return;
      }
      if (battlyClientVersions) {
        showBattlyClientState('error', 'No se pudieron cargar las versiones.');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'button is-info is-small';
        retry.textContent = 'Reintentar';
        retry.addEventListener('click', () => {
          void renderBattlyClientBuilds();
        });
        battlyClientStatus?.append(retry);
      }
    } finally {
      if (revision === battlyBuildsRevision) {
        battlyClientLoading = false;
        battlyClientVersions?.setAttribute('aria-busy', 'false');
      }
    }
  };
  battlyClientChannel?.addEventListener('change', () => {
    void renderBattlyClientBuilds();
  });
  battlyClientSearch?.addEventListener('input', filterBattlyClientBuilds);
  const panelTransition = new DownloadPanelTransition(
    dialog?.querySelector<HTMLElement>('.download-modal-panel') ?? null,
  );
  let downloadPageAnimation: Animation | undefined;
  const downloadCard = dialog?.querySelector<HTMLElement>('.download-panel');
  let loadingMinHeight: { value: string; priority: string } | undefined;
  const releaseLoadingHeight = (): void => {
    if (!downloadCard || !loadingMinHeight) {
      return;
    }
    if (loadingMinHeight.value) {
      downloadCard.style.setProperty(
        'min-height',
        loadingMinHeight.value,
        loadingMinHeight.priority,
      );
    } else {
      downloadCard.style.removeProperty('min-height');
    }
    loadingMinHeight = undefined;
  };
  let downloadCatalog: DownloadCatalogSnapshot | null = null;
  const downloadAppInfo = window.battly.getAppInfo();
  const downloadArchitecture = downloadAppInfo.then((info) => info.architecture);
  let is32BitDownload = false;
  let architectureNoticeOpen = false;
  const markIncompatible = (
    input: HTMLInputElement,
    label: HTMLElement,
    version: string,
    java?: string | null,
  ): void => {
    if (!is32BitDownload || !requires64BitMinecraft(version, java)) {
      return;
    }
    input.disabled = true;
    const reason = document.createElement('small');
    reason.textContent = '64-bit';
    reason.className = 'download-architecture-badge';
    label.classList.add('download-incompatible');
    label.append(reason);
    label.title = minecraft32BitNotice;
    label.style.opacity = '0.55';
  };
  let downloadCatalogRequest: Promise<DownloadCatalogSnapshot> | null = null;
  const loadCatalog = async (refresh = false): Promise<DownloadCatalogSnapshot> => {
    if (downloadCatalog && !refresh) {
      return downloadCatalog;
    }
    const request = (downloadCatalogRequest ??= window.battly.getDownloadCatalog());
    try {
      const catalog = await request;
      // An older opening must not replace the catalog of a reopened panel.
      if (downloadCatalogRequest === request) {
        downloadCatalog = catalog;
      }
      return catalog;
    } finally {
      if (downloadCatalogRequest === request) {
        downloadCatalogRequest = null;
      }
    }
  };
  window.setTimeout(() => {
    void loadCatalog().catch(() => undefined);
    void loaderCatalog.preload();
  }, 1500);
  const matchesSearch = (value: string, input: HTMLInputElement | null): boolean =>
    value.toLowerCase().includes(input?.value.trim().toLowerCase() ?? '');

  const setClientCardIcon = (label: HTMLLabelElement, client: string): void => {
    label.dataset.downloadClientCard = '';
    label.style.setProperty('--download-card-logo', `url(${JSON.stringify(playIcon(client))})`);
  };

  const markHot = (label: HTMLElement, ...ids: string[]): void => {
    if (label.classList.contains('download-incompatible')) {
      return;
    }
    if (!ids.some((id) => downloadCatalog?.hotVersions?.includes(id))) {
      return;
    }
    label.classList.add('hot-version-border');
    label.title = 'De las versiones más usadas en las últimas 24 horas';
    const badge = document.createElement('span');
    badge.className = 'download-hot-badge';
    badge.innerHTML = '<i class="fa-solid fa-fire" aria-hidden="true"></i> Hot';
    label.append(badge);
  };

  const showPage = (next: DownloadPage, remember = true): void => {
    if (next === activePage) {
      return;
    }
    if (remember) {
      history.push(activePage);
    }
    downloadPageAnimation?.cancel();
    panelTransition.run(() => {
      if (next !== 'loaderVersions') {
        releaseLoadingHeight();
      }
      activePage = next;
      if (dialog) {
        dialog.dataset.downloadPage = next;
        dialog.setAttribute(
          'aria-labelledby',
          next === 'battlyClient' ? 'download-battly-client-title' : 'download-title',
        );
      }
      for (const [name, page] of Object.entries(pages) as Array<
        [DownloadPage, HTMLElement | null]
      >) {
        if (!page) {
          continue;
        }
        const active = name === next;
        page.classList.toggle('active', active);
        page.classList.toggle('not-active', !active);
        page.style.display = active ? (next === 'loaders' ? 'block' : 'flex') : 'none';
        page.style.height = 'auto';
        page.style.removeProperty('transition');
      }
      if (back) {
        back.style.display = history.length ? 'inline-flex' : 'none';
      }
    });
    const page = pages[next];
    if (page && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      downloadPageAnimation = page.animate(
        [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
        { duration: 500, easing: 'ease' },
      );
    }
    if (next === 'battlyClient') {
      battlyClientChannel?.focus({ preventScroll: true });
    }
  };
  const showTypes = (): void => {
    ++versionsRevision;
    ++buildsRevision;
    panelTransition.reset();
    downloadPageAnimation?.cancel();
    releaseLoadingHeight();
    history = [];
    for (const [name, page] of Object.entries(pages) as Array<[DownloadPage, HTMLElement | null]>) {
      const active = name === 'loaders';
      page?.classList.toggle('active', active);
      page?.classList.toggle('not-active', !active);
      if (page) {
        page.style.display = active ? 'block' : 'none';
      }
      if (page) {
        page.style.height = 'auto';
      }
    }
    activePage = 'loaders';
    if (dialog) {
      delete dialog.dataset.downloadPage;
      dialog.setAttribute('aria-labelledby', 'download-title');
    }
    if (back) {
      back.style.display = 'none';
    }
    if (create) {
      create.style.visibility = 'hidden';
    }
    selectedLoader = '';
    selectedVersion = '';
    selectedLoaderVersion = null;
    selectedRequiredJava = '';
    selectedLabyMod = false;
    ++battlyBuildsRevision;
    if (search) {
      search.value = '';
    }
    if (loaderVersionSearch) {
      loaderVersionSearch.value = '';
    }
    if (labyModSearch) {
      labyModSearch.value = '';
    }
    if (battlyClientSearch) {
      battlyClientSearch.value = '';
    }
    if (battlyClientStatus) {
      battlyClientStatus.hidden = true;
    }
    battlyClientLoading = false;
    if (optiForge) {
      optiForge.checked = false;
    }
    if (optiForgeRow) {
      optiForgeRow.hidden = true;
    }
    document
      .querySelectorAll<HTMLInputElement>(
        'input[name="download-loader"], input[name="download-vanilla-type"]',
      )
      .forEach((input) => (input.checked = false));
  };
  const renderVersions = async (vanillaType = 'release'): Promise<void> => {
    const revision = ++versionsRevision;
    const loader = selectedLoader;
    const current = (): boolean => revision === versionsRevision && loader === selectedLoader;
    if (create) {
      create.style.visibility = 'hidden';
    }
    versions?.replaceChildren();
    if (versions) {
      versions.scrollTop = 0;
    }
    is32BitDownload = is32BitArchitecture(await downloadArchitecture);
    if (!selectedLoader || selectedLoader === 'clients') {
      await loadCatalog();
    }
    if (!current()) {
      return;
    }
    if (selectedLoader === 'clients') {
      const clients = await window.battly.getCustomClients();
      if (!current()) {
        return;
      }
      const labyLabel = document.createElement('label');
      labyLabel.className = 'label';
      setClientCardIcon(labyLabel, 'labymod');
      const labyInput = document.createElement('input');
      labyInput.type = 'radio';
      labyInput.name = 'download-version';
      labyInput.value = 'labymod-4-entry';
      const labyText = document.createElement('p');
      labyText.className = 'texto';
      labyText.textContent = 'LabyMod 4';
      labyLabel.hidden = !matchesSearch(labyText.textContent, search);
      labyInput.addEventListener('change', () => {
        selectedLabyMod = true;
        selectedVersion = '';
        selectedRequiredJava = '21';
        if (create) {
          create.style.visibility = 'hidden';
        }
        labyModVersions?.replaceChildren();
        if (labyModVersions) {
          labyModVersions.textContent = 'Cargando versiones...';
        }
        showPage('labymod');
        void window.battly
          .getLabyModVersions()
          .then((available) => {
            labyModVersions?.replaceChildren();
            for (const item of available) {
              const label = document.createElement('label');
              label.className = 'label';
              const input = document.createElement('input');
              input.type = 'radio';
              input.name = 'download-labymod-version';
              input.value = item.version;
              const text = document.createElement('p');
              text.className = 'texto';
              text.textContent = item.version;
              label.hidden = !matchesSearch(item.version, labyModSearch);
              input.addEventListener('change', () => {
                selectedVersion = item.version;
                if (create) {
                  create.style.visibility = 'visible';
                }
              });
              label.append(input, text);
              markIncompatible(input, label, item.version);
              markHot(label, `LabyMod-${item.version}`, `labymod-${item.version}`);
              labyModVersions?.append(label);
            }
          })
          .catch(() => {
            if (labyModVersions) {
              labyModVersions.textContent = 'Error al cargar versiones (API).';
            }
          });
      });
      labyLabel.append(labyInput, labyText);
      markHot(labyLabel, 'labymod-4', 'LabyMod-4');
      versions?.append(labyLabel);
      for (const client of clients) {
        const label = document.createElement('label');
        label.className = 'label';
        setClientCardIcon(label, client.id);
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'download-version';
        input.value = client.id;
        const text = document.createElement('p');
        text.className = 'texto';
        text.textContent = client.name;
        label.hidden = !matchesSearch(`${client.name} ${client.id}`, search);
        input.addEventListener('change', () => {
          selectedLabyMod = false;
          selectedVersion = client.id;
          selectedRequiredJava = client.requiredJavaVersion ?? '';
          if (create) {
            create.style.visibility = 'visible';
          }
        });
        label.append(input, text);
        markIncompatible(input, label, client.folderName, client.requiredJavaVersion);
        markHot(label, client.id, client.folderName);
        versions?.append(label);
      }
      return;
    }
    const catalog = selectedLoader ? downloadCatalog : await loadCatalog();
    const loaderEntries = (catalog?.launcher ?? []).filter(
      (entry) =>
        entry.type.toLowerCase() === selectedLoader ||
        entry.version.toLowerCase().endsWith(`-${selectedLoader}`),
    );
    const officialLoader = [
      'fabric',
      'forge',
      'legacyfabric',
      'neoforge',
      'optifine',
      'quilt',
    ].includes(selectedLoader)
      ? (selectedLoader as MinecraftLoaderKind)
      : null;
    const loaderValues =
      selectedLoader === 'horizon'
        ? [horizonMinecraftVersion]
        : officialLoader
          ? await loaderCatalog
              .gameVersions(officialLoader)
              .then((snapshot) => snapshot.versions.map((entry) => entry.version))
          : [...new Set(loaderEntries.map((entry) => entry.realVersion))];
    if (!current()) {
      return;
    }
    const versionFragment = document.createDocumentFragment();
    const values = selectedLoader
      ? loaderValues
      : (catalog?.minecraft ?? [])
          .filter((entry) => entry.type === vanillaType)
          .map((entry) => entry.id);
    if (!values.length && versions) {
      const empty = emptyState('No hay versiones de este tipo en el catálogo disponible.');
      empty.classList.add('download-version-empty');
      versions.append(empty);
    }
    for (const value of values) {
      const label = document.createElement('label');
      label.className = 'label';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'download-version';
      input.value = value;
      markIncompatible(input, label, value);
      if (selectedLoader === 'horizon') {
        const { platform, architecture } = await downloadAppInfo;
        if (!current()) {
          return;
        }
        if (!horizonArchive(platform, architecture ?? '')) {
          input.disabled = true;
          label.classList.add('download-incompatible');
          label.title = 'Horizon no está disponible para esta plataforma.';
        }
      }
      const text = document.createElement('p');
      text.className = 'texto';
      text.textContent = value;
      label.hidden = !matchesSearch(value, search);
      if (officialLoader) {
        const preloadBuilds = (): void => {
          void loaderCatalog.builds(officialLoader, value).catch(() => undefined);
        };
        label.addEventListener('pointerenter', preloadBuilds, { once: true });
        input.addEventListener('focus', preloadBuilds, { once: true });
      }
      input.addEventListener('change', () => {
        const buildRevision = ++buildsRevision;
        void (async () => {
          selectedVersion = value;
          selectedRequiredJava =
            loaderEntries.find((entry) => entry.realVersion === value)?.requiredJavaVersion ?? '';
          if (officialLoader) {
            selectedLoaderVersion = null;
            if (downloadCard && !loadingMinHeight) {
              loadingMinHeight = {
                value: downloadCard.style.getPropertyValue('min-height'),
                priority: downloadCard.style.getPropertyPriority('min-height'),
              };
              downloadCard.style.minHeight = `${downloadCard.getBoundingClientRect().height}px`;
            }
            loaderVersions?.replaceChildren();
            if (loaderVersions) {
              loaderVersions.scrollTop = 0;
              loaderVersions.textContent = `Cargando subversiones de ${selectedLoader}…`;
            }
            if (loaderVersionTitle) {
              const loaderName =
                selectedLoader === 'optifine'
                  ? 'OptiFine'
                  : selectedLoader === 'legacyfabric'
                    ? 'LegacyFabric'
                    : selectedLoader.charAt(0).toUpperCase() + selectedLoader.slice(1);
              loaderVersionTitle.textContent = `Selecciona la subversión de ${loaderName} que quieres descargar`;
            }
            if (optiForgeRow) {
              optiForgeRow.hidden = true;
            }
            if (optiForge) {
              optiForge.checked = false;
            }
            if (create) {
              create.style.visibility = 'hidden';
            }
            showPage('loaderVersions');
            const [builds, optiFineBuilds] = await Promise.all([
              loaderCatalog
                .builds(officialLoader, value)
                .then((snapshot) => snapshot.builds.map((build) => build.version))
                .catch((): readonly string[] => []),
              selectedLoader === 'forge'
                ? loaderCatalog
                    .builds('optifine', value)
                    .then((snapshot) => snapshot.builds)
                    .catch(() => [])
                : Promise.resolve([]),
            ]);
            if (
              buildRevision !== buildsRevision ||
              !current() ||
              activePage !== 'loaderVersions' ||
              selectedVersion !== value ||
              selectedLoader !== officialLoader
            ) {
              return;
            }
            if (optiForgeRow) {
              optiForgeRow.hidden = !optiFineBuilds.some(
                (build) => typeof build.forgeVersion === 'string',
              );
            }
            const buildFragment = document.createDocumentFragment();
            if (!builds.length && loaderVersions) {
              const empty = document.createElement('p');
              empty.textContent = `No se encontraron subversiones de ${selectedLoader}.`;
              buildFragment.append(empty);
            }
            for (const build of builds) {
              const buildLabel = document.createElement('label');
              buildLabel.className = 'label';
              const buildInput = document.createElement('input');
              buildInput.type = 'radio';
              buildInput.name = 'download-loader-version';
              buildInput.value = build;
              const buildText = document.createElement('p');
              buildText.className = 'texto';
              setUiText(
                buildText,
                selectedLoader === 'optifine' ? `HD ${build.replaceAll('_', ' ')}` : build,
              );
              buildLabel.hidden = !matchesSearch(build, loaderVersionSearch);
              buildInput.addEventListener('change', () => {
                selectedLoaderVersion = build;
                if (create) {
                  create.style.visibility = 'visible';
                }
              });
              buildLabel.append(buildInput, buildText);
              buildFragment.append(buildLabel);
            }
            panelTransition.run(() => {
              loaderVersions?.replaceChildren(buildFragment);
              if (loaderVersions) {
                loaderVersions.scrollTop = 0;
              }
              releaseLoadingHeight();
            });
          } else if (create) {
            create.style.visibility = 'visible';
          }
        })();
      });
      label.append(input, text);
      markHot(label, selectedLoader ? `${value}-${selectedLoader}` : value);
      versionFragment.append(label);
    }
    versions?.append(versionFragment);
  };

  document.querySelectorAll<HTMLInputElement>('input[name="download-loader"]').forEach((input) => {
    input.addEventListener('change', () => {
      selectedLoader = input.value;
      selectedLabyMod = false;
      ++battlyBuildsRevision;
      selectedVersion = '';
      selectedLoaderVersion = null;
      selectedRequiredJava = '';
      if (optiForge) {
        optiForge.checked = false;
      }
      if (optiForgeRow) {
        optiForgeRow.hidden = true;
      }
      if (!selectedLoader) {
        showPage('vanilla');
        return;
      }
      if (selectedLoader === 'battly-client') {
        showPage('battlyClient');
        void renderBattlyClientBuilds();
        return;
      }
      void renderVersions().catch(() => {
        if (versions) {
          versions.innerHTML = '<p>No se pudo cargar el catálogo.</p>';
        }
      });
      showPage('versions');
    });
  });
  document
    .querySelectorAll<HTMLInputElement>('input[name="download-vanilla-type"]')
    .forEach((input) => {
      input.addEventListener('change', () => {
        selectedLoader = '';
        selectedVersion = '';
        void renderVersions(input.value).catch(() => {
          if (versions) {
            versions.innerHTML = '<p>No se pudo cargar el catálogo.</p>';
          }
        });
        showPage('versions');
      });
    });
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    versions?.querySelectorAll<HTMLElement>('label').forEach((label) => {
      label.hidden = !label.textContent?.toLowerCase().includes(query);
    });
  });
  loaderVersionSearch?.addEventListener('input', () => {
    const query = loaderVersionSearch.value.trim().toLowerCase();
    loaderVersions?.querySelectorAll<HTMLElement>('label').forEach((label) => {
      label.hidden = !label.textContent?.toLowerCase().includes(query);
    });
  });
  labyModSearch?.addEventListener('input', () => {
    const query = labyModSearch.value.trim().toLowerCase();
    labyModVersions?.querySelectorAll<HTMLElement>('label').forEach((label) => {
      label.hidden = !label.textContent?.toLowerCase().includes(query);
    });
  });
  back?.addEventListener('click', () => {
    ++buildsRevision;
    const previous = history.pop();
    if (!previous) {
      return;
    }
    if (previous === 'loaders' || previous === 'vanilla') {
      ++versionsRevision;
    }
    showPage(previous, false);
    selectedVersion = '';
    selectedLoaderVersion = null;
    selectedLabyMod = false;
    ++battlyBuildsRevision;
    pages[previous]?.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
      input.checked = false;
    });
    if (create) {
      create.style.visibility = 'hidden';
    }
  });
  create?.addEventListener('click', () => {
    if (!selectedVersion) {
      return;
    }
    if (showActiveMinecraftNotice()) {
      return;
    }
    create.disabled = true;
    create.textContent = 'Preparando…';
    const selectedClientName = versions
      ?.querySelector<HTMLInputElement>('input:checked')
      ?.closest('label')
      ?.querySelector('.texto')?.textContent;
    const label =
      selectedLoader === 'horizon'
        ? `Horizon ${selectedVersion}`
        : selectedLoader === 'battly-client'
          ? 'Battly Client'
          : selectedLoader === 'clients'
            ? selectedClientName || selectedVersion
            : `${selectedVersion}${selectedLoader ? ` ${selectedLoader}` : ''}`;
    const launchDialog = document.querySelector<HTMLDialogElement>('[data-launch-dialog]');
    launchDialog?.classList.add('is-installing');
    if (launchDialog && !launchDialog.open) {
      launchDialog.showModal();
    }
    const launchTitle = document.querySelector<HTMLElement>('#launch-title');
    const launchStatus = launchStatusElement();
    const launchFiles = document.querySelector<HTMLElement>('[data-launch-files]');
    const launchProgress = document.querySelector<HTMLProgressElement>('[data-launch-progress]');
    const launchPercent = document.querySelector<HTMLElement>('[data-launch-percent]');
    const launchLog = document.querySelector<HTMLElement>('[data-launch-log]');
    const launchDetails = document.querySelector<HTMLButtonElement>('[data-launch-details-toggle]');
    document.body.dataset.launchState = 'preparing';
    activeLaunchSurface = 'play';
    launchLogLines = [];
    launchLogDecoder = new Log4jLogDecoder();
    lastLaunchProgressLog = '';
    currentLaunchPhase = selectedLabyMod ? 'labymod' : 'preparing';
    const launchPhase = document.querySelector<HTMLElement>('[data-launch-phase]');
    if (launchPhase) {
      launchPhase.textContent = 'Preparando instalación…';
    }
    if (launchLog) {
      launchLog.textContent = '';
    }
    if (launchLog) {
      launchLog.hidden = false;
    }
    if (launchDetails) {
      launchDetails.hidden = false;
    }
    if (launchTitle) {
      launchTitle.textContent = 'Minecraft está instalándose...';
    }
    const downloadTitle = document.querySelector<HTMLElement>('[data-launch-download-title]');
    if (downloadTitle) {
      downloadTitle.textContent = `Descargando ${label}...`;
    }
    if (launchStatus) {
      launchStatus.textContent = `Preparando ${label}…`;
    }
    if (launchFiles) {
      launchFiles.textContent = 'Comprobando archivos...';
    }
    renderLaunchMeter(launchProgress, launchPercent, null);
    const operation =
      selectedLoader === 'battly-client'
        ? window.battly.installBattlyClient(selectedVersion).then((installed) => {
            startPlayVersion(
              {
                version: installed.minecraftVersion,
                custom: true,
                customVersion: installed.customVersion,
                loader: 'vanilla',
                loaderVersion: '',
                requiredJavaVersion: installed.requiredJavaVersion,
                safeMode: false,
              },
              `Battly Client ${installed.minecraftVersion}`,
              true,
            );
          })
        : selectedLabyMod
          ? window.battly.installLabyMod(selectedVersion).then((installed) => {
              startPlayVersion(
                {
                  version: installed.minecraftVersion,
                  custom: true,
                  customVersion: installed.customVersion,
                  loader: 'vanilla',
                  loaderVersion: '',
                  requiredJavaVersion: '21',
                  safeMode: false,
                },
                `LabyMod ${installed.minecraftVersion}`,
                true,
              );
            })
          : selectedLoader === 'clients'
            ? window.battly.getCustomClients().then(async (clients) => {
                const client = clients.find((candidate) => candidate.id === selectedVersion);
                if (!client) {
                  throw new Error('Cliente no disponible');
                }
                await window.battly.installPlayClient(client.id);
                startPlayVersion(
                  {
                    version: client.folderName,
                    custom: true,
                    customVersion: client.folderName,
                    loader: 'vanilla',
                    loaderVersion: '',
                    requiredJavaVersion: client.requiredJavaVersion ?? '',
                    safeMode: false,
                  },
                  client.name,
                  true,
                );
              })
            : Promise.resolve().then(() => {
                startPlayVersion(
                  {
                    version: selectedVersion,
                    custom: false,
                    customVersion: '',
                    loader: selectedLoader || 'vanilla',
                    loaderVersion:
                      selectedLoaderVersion ??
                      (selectedLoader && selectedLoader !== 'horizon' ? 'latest' : ''),
                    installOptiForge: selectedLoader === 'forge' && optiForge?.checked === true,
                    requiredJavaVersion: selectedRequiredJava,
                    safeMode: false,
                  },
                  label,
                  true,
                );
              });
    hideLegacyModal(dialog);
    void operation
      .then(() => showTypes())
      .catch((error: unknown) => {
        launchDialog?.close();
        showLegacyModal(dialog);
        create.textContent = 'Error al descargar';
        showToast(
          'Error al descargar',
          error instanceof Error
            ? error.message
            : 'No se pudo descargar el cliente. Vuelve a intentarlo.',
          'error',
        );
      })
      .finally(() => {
        create.disabled = false;
        if (create.textContent !== 'Error al descargar') {
          create.textContent = 'Descargar';
        }
      });
  });
  document
    .querySelectorAll<HTMLElement>('[data-download-close]')
    .forEach((close) => close.addEventListener('click', () => hideLegacyModal(dialog)));
  document.querySelectorAll<HTMLElement>('[data-downloads-open]').forEach((open) =>
    open.addEventListener('click', () => {
      showTypes();
      // Reuse the ready catalogue while checking for new releases in the background.
      void loadCatalog(true).catch(() => undefined);
      void loaderCatalog.preload();
      showLegacyModal(dialog);
      void downloadArchitecture.then(async (architecture) => {
        if (
          !is32BitArchitecture(architecture) ||
          architectureNoticeOpen ||
          privateStorage.getItem('battly.minecraft-32bit-notice.3.1.0')
        ) {
          return;
        }
        architectureNoticeOpen = true;
        await askBattly({
          title: 'Compatibilidad de Minecraft en 32 bits',
          text: minecraft32BitNotice,
          confirmText: 'Entendido',
          hideCancel: true,
        });
        privateStorage.setItem('battly.minecraft-32bit-notice.3.1.0', '1');
      });
    }),
  );
}

function showBypackImport(source?: string | File): void {
  void openBypackImportFlow(
    source,
    (instance) =>
      renderInstances([...knownInstances.filter((value) => value.id !== instance.id), instance]),
    async (instance) => {
      await activatePanel('home');
      startInstance(instance);
    },
  );
}

function bindInstances(): void {
  window.battly.onBypackOpenRequested((path) => showBypackImport(path));
  document
    .querySelector<HTMLButtonElement>('[data-bypack-import]')
    ?.addEventListener('click', () => {
      showBypackImport();
    });
  const dialog = document.querySelector<HTMLElement>('[data-instances-dialog]');
  const status = document.querySelector<HTMLElement>('[data-instances-status]');
  const instancesTourSession = tutorialSession();
  const ensureTutorialInstanceEditor = (): void => {
    document.querySelector<HTMLDialogElement>('.instance-content-dialog')?.close();
    const editor = document.querySelector<HTMLElement>('[data-instance-editor-dialog]');
    if (!editor?.classList.contains('is-active')) {
      dialog?.querySelector<HTMLElement>('[data-instance-create-open]')?.click();
    }
  };
  const ensureTutorialInstanceContent = async (kind = 'mods'): Promise<void> => {
    hideLegacyModal(document.querySelector<HTMLElement>('[data-instance-editor-dialog]'));
    if (!document.querySelector<HTMLDialogElement>('.instance-content-dialog[open]')) {
      const first = await waitForTutorialElement(
        '.instance-title-content, .instance-open-content',
        dialog ?? document,
      );
      if (!first) {
        throw new Error('TUTORIAL_INSTANCE_UNAVAILABLE');
      }
      first.click();
    }
    const deadline = performance.now() + 5000;
    let tab = document.querySelector<HTMLButtonElement>(
      '.instance-content-dialog [data-kind="' + kind + '"]',
    );
    while ((!tab || tab.disabled) && performance.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      tab = document.querySelector<HTMLButtonElement>(
        '.instance-content-dialog [data-kind="' + kind + '"]',
      );
    }
    if (!tab || tab.disabled) {
      throw new Error('TUTORIAL_INSTANCE_CONTENT_UNAVAILABLE');
    }
    if (tab.getAttribute('aria-pressed') !== 'true') {
      tab.click();
    }
  };
  const tutorial = dialog
    ? mountGuidedTutorial({
        id: 'instances',
        label: 'Tutorial de instancias',
        root: dialog,
        storageKey: 'battly.instances-tutorial.v1',
        onStart: instancesTourSession.start,
        onFinish: instancesTourSession.finish,
        promptTitle: 'Gestiona tus instancias',
        promptText: 'Descubre cómo gestionar contenido, compartir packs y crear accesos directos.',
        steps: [
          {
            title: 'Cada instancia tiene sus propios archivos',
            text: 'Mantén separados tus mods, configuraciones y mundos para cada versión de Minecraft.',
          },
          {
            selector: '[data-instance-create-open]',
            title: 'Crear o importar',
            text: 'Crea una instancia o importa un .bypack para recuperar su configuración y contenido.',
          },
          {
            selector: '[data-instance-form] input[name="name"]',
            scope: 'document',
            title: 'Nombre y configuración',
            text: 'Pon un nombre a la instancia y revisa su configuración antes de crearla. Este recorrido no guardará ninguna instancia.',
            onEnter: ensureTutorialInstanceEditor,
          },
          {
            selector: '[data-instance-form] [data-instance-version]',
            scope: 'document',
            title: 'Versión y loader',
            text: 'Elige Minecraft y el loader para mantener separados los archivos de cada configuración.',
            onEnter: ensureTutorialInstanceEditor,
          },
          ...[
            [
              'mods',
              'Gestionar los mods',
              'Activa, desactiva o archiva los mods de esta instancia. Estos cambios no afectan a tus otras instancias.',
            ],
            [
              'resourcepacks',
              'Paquetes de recursos',
              'Añade y organiza los paquetes de recursos de esta instancia.',
            ],
            [
              'shaderpacks',
              'Shaders',
              'Gestiona aquí los archivos de shaders que usarás en esta configuración.',
            ],
            [
              'saves',
              'Mundos y copias',
              'Consulta los mundos de la instancia y las opciones de copia antes de modificar sus archivos.',
            ],
          ].map(([kind, title, text]) => ({
            id: kind,
            selector: '.instance-content-dialog .instance-content-list',
            scope: 'document' as const,
            title,
            text,
            onEnter: () => ensureTutorialInstanceContent(kind),
            unavailableText:
              'Todavía no hay una instancia disponible. Crea o importa una para recorrer su contenido.',
          })),
          {
            selector: '[data-instance-export], [data-instance-shortcut]',
            title: 'Compartir y abrir desde el escritorio',
            text: 'Exporta un .bypack o crea un acceso directo desde estas acciones. El tutorial solo te muestra dónde están.',
            onEnter: () => {
              document.querySelector<HTMLDialogElement>('.instance-content-dialog')?.close();
              const action = dialog?.querySelector<HTMLElement>(
                '[data-instance-export], [data-instance-shortcut]',
              );
              if (action && !action.getClientRects().length) {
                action.closest('.card')?.querySelector<HTMLElement>('.card-header-icon')?.click();
              }
            },
            unavailableText:
              'Estas acciones aparecen en la tarjeta de cada instancia cuando tengas una creada.',
          },
        ],
      })
    : undefined;
  const openDialog = (): void => {
    if (!dialog) {
      return;
    }
    showLegacyModal(dialog);
    tutorial?.offer();
    resetInstanceEditor();
    if (status) {
      status.textContent = 'Cargando…';
    }
    const instanceList = document.querySelector<HTMLElement>('[data-instances-list]');
    if (instanceList) {
      instanceList.setAttribute('aria-busy', 'true');
      instanceList.innerHTML =
        '<div class="instance-loading" aria-label="Cargando instancias"><span></span><span></span><span></span></div>';
    }
    void window.battly
      .getInstances()
      .then((instances) => {
        renderInstances(instances);
        if (status) {
          status.textContent = '';
        }
      })
      .catch((error: unknown) => {
        if (status) {
          setUiText(
            status,
            error instanceof Error && error.message === 'BATTLY_PRIVATE_DATA_UNREADABLE'
              ? 'Battly no puede leer las instancias con la clave de este perfil. Las carpetas se conservan. Para recuperarlas, restaura una copia del perfil original de Battly.'
              : 'No se pudieron cargar las instancias',
          );
        }
        instanceList?.replaceChildren();
      })
      .finally(() => {
        instanceList?.setAttribute('aria-busy', 'false');
      });
  };
  document
    .querySelectorAll<HTMLButtonElement>('[data-instances-open]')
    .forEach((button) => button.addEventListener('click', openDialog));
  document
    .querySelectorAll<HTMLButtonElement>('[data-play-open]')
    .forEach((button) => button.addEventListener('click', () => void openPlaySelector()));
  document.querySelectorAll<HTMLElement>('[data-play-close]').forEach((close) =>
    close.addEventListener('click', () => {
      playSelectorRevision += 1;
      hideLegacyModal(document.querySelector<HTMLElement>('[data-play-dialog]'));
    }),
  );
  document
    .querySelector<HTMLSelectElement>('[data-play-version]')
    ?.addEventListener('change', (event) =>
      renderPlayLoaders((event.currentTarget as HTMLSelectElement).value),
    );
  for (const selector of ['[data-play-sort]', '[data-play-sort-direction]']) {
    document.querySelector<HTMLSelectElement>(selector)?.addEventListener('change', () => {
      if (playVersionSnapshot) {
        renderPlaySelector(playVersionSnapshot);
      }
    });
  }
  bindPlaySortPopover();
  document.querySelector<HTMLButtonElement>('[data-play-start]')?.addEventListener('click', () => {
    if (!selectedPlayRequest) {
      return;
    }
    const label =
      document
        .querySelector<HTMLElement>('[data-play-status]')
        ?.textContent?.replace(/^Iniciarás la versión:\s*/, '') ||
      selectedPlayRequest.customVersion ||
      selectedPlayRequest.version;
    startPlayVersion({ ...selectedPlayRequest, safeMode: false }, label);
  });
  document.querySelector<HTMLButtonElement>('[data-play-safe]')?.addEventListener('click', () => {
    if (!selectedPlayRequest) {
      return;
    }
    const label =
      document
        .querySelector<HTMLElement>('[data-play-status]')
        ?.textContent?.replace(/^Iniciarás la versión:\s*/, '') ||
      selectedPlayRequest.customVersion ||
      selectedPlayRequest.version;
    startPlayVersion({ ...selectedPlayRequest, safeMode: true }, label);
  });
  document
    .querySelector<HTMLButtonElement>('[data-play-shortcut]')
    ?.addEventListener('click', () => {
      if (!selectedPlayRequest) {
        return;
      }
      const request = { ...selectedPlayRequest, safeMode: false };
      const label =
        document
          .querySelector<HTMLElement>('[data-play-status]')
          ?.textContent?.replace(/^Iniciarás la versión:\s*/, '') ||
        request.customVersion ||
        request.version;
      void askBattly({
        title: 'Crear acceso directo',
        text: `¿Crear un acceso directo de ${label} en el escritorio?`,
        confirmText: 'Crear',
        danger: false,
      }).then((accepted) => {
        if (!accepted) {
          return;
        }
        void window.battly
          .createPlayShortcut(request, label)
          .then((path) => {
            const status = document.querySelector<HTMLElement>('[data-play-status]');
            if (status) {
              status.textContent = `Acceso directo creado: ${path}`;
            }
          })
          .catch((error: unknown) => {
            const status = document.querySelector<HTMLElement>('[data-play-status]');
            if (status) {
              status.textContent =
                error instanceof Error ? error.message : 'No se pudo crear el acceso directo';
            }
          });
      });
    });
  document
    .querySelectorAll<HTMLElement>('[data-instances-close]')
    .forEach((close) => close.addEventListener('click', () => hideLegacyModal(dialog)));
  document
    .querySelector<HTMLButtonElement>('[data-instances-list-view]')
    ?.addEventListener('click', () => setInstanceView('list'));
  document
    .querySelector<HTMLButtonElement>('[data-instances-grid-view]')
    ?.addEventListener('click', () => setInstanceView('grid'));
  setInstanceView(savedInstanceView());
  bindPlaySortPopover(document, 'instances');
  for (const selector of [
    '[data-instances-loader-filter]',
    '[data-instances-version-filter]',
    '[data-instances-sort]',
    '[data-instances-sort-direction]',
  ]) {
    document
      .querySelector<HTMLSelectElement>(selector)
      ?.addEventListener('change', () => renderInstances(knownInstances));
  }
  document
    .querySelector<HTMLInputElement>('[data-instances-search]')
    ?.addEventListener('input', () => renderInstances(knownInstances));

  const form = document.querySelector<HTMLFormElement>('[data-instance-form]');
  const loader = form?.querySelector<HTMLSelectElement>('[data-instance-loader]');
  const loaderVersion = form?.querySelector<HTMLSelectElement>('[data-instance-loader-version]');
  const loaderVersionField = form?.querySelector<HTMLElement>(
    '[data-instance-loader-version-field]',
  );
  const versionSelect = form?.querySelector<HTMLSelectElement>('[data-instance-version]');
  const imageInput = form?.querySelector<HTMLInputElement>('[data-instance-image]');
  const imagePreview = form?.querySelector<HTMLImageElement>('[data-instance-image-preview]');
  const runtimeDetails = form?.querySelector<HTMLDetailsElement>('.instance-runtime-details');
  const runtimeToggle = form?.querySelector<HTMLElement>('[data-instance-runtime-toggle]');
  const toggleRuntimeDetails = (): void => {
    if (!runtimeDetails) {
      return;
    }
    runtimeDetails.open = !runtimeDetails.open;
    runtimeToggle?.setAttribute('aria-pressed', String(runtimeDetails.open));
  };
  runtimeToggle?.addEventListener('click', toggleRuntimeDetails);
  runtimeToggle?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    toggleRuntimeDetails();
  });
  if (imagePreview) {
    imagePreview.src = defaultMinecraftIconUrl;
  }
  let instanceCatalog: DownloadCatalogSnapshot | null = null;
  const populateInstanceVersions = async (): Promise<void> => {
    if (!form || !versionSelect || !loader) {
      return;
    }
    instanceCatalog ??= await window.battly.getDownloadCatalog();
    const selectedType =
      form.querySelector<HTMLInputElement>('input[name="instanceVersionType"]:checked')?.value ??
      'release';
    const previousVersion = versionSelect.value;
    versionSelect.replaceChildren();
    for (const entry of instanceCatalog.minecraft.filter(
      (candidate) => candidate.type === selectedType,
    )) {
      const option = document.createElement('option');
      option.value = entry.id;
      setUserText(option, entry.id);
      versionSelect.append(option);
    }
    if ([...versionSelect.options].some((option) => option.value === previousVersion)) {
      versionSelect.value = previousVersion;
    }
    const allowed =
      selectedType === 'snapshot'
        ? ['', 'fabric', 'quilt']
        : selectedType === 'old_beta' || selectedType === 'old_alpha'
          ? ['']
          : ['', 'forge', 'fabric', 'quilt', 'neoforge'];
    const previousLoader = loader.value;
    for (const option of loader.options) {
      option.hidden = !allowed.includes(option.value);
    }
    loader.value = allowed.includes(previousLoader) ? previousLoader : '';
    loader.dispatchEvent(new Event('change'));
  };
  let loaderBuildRequest = 0;
  const updateLoaderVersion = async (): Promise<void> => {
    if (!loaderVersion || !loader || !versionSelect) {
      return;
    }
    const request = ++loaderBuildRequest;
    const selectedLoader = loader.value;
    const selectedMinecraftVersion = versionSelect.value;
    const previous = loaderVersion.dataset.preferred ?? loaderVersion.value;
    delete loaderVersion.dataset.preferred;
    loaderVersion.disabled = !selectedLoader;
    if (loaderVersionField) {
      loaderVersionField.hidden = !selectedLoader;
    }
    loaderVersion.replaceChildren();
    if (!selectedLoader) {
      loaderVersion.append(new Option('Ninguna', ''));
      return;
    }
    if (!selectedMinecraftVersion) {
      loaderVersion.replaceChildren(new Option('Selecciona una versión de Minecraft', ''));
      loaderVersion.disabled = true;
      return;
    }
    // Keep the form usable while remote loader metadata is being refreshed. All
    // installers understand `latest`, and the exact builds replace this option as
    // soon as the catalog responds.
    loaderVersion.append(new Option('Última (cargando versiones…)', 'latest'));
    loaderVersion.disabled = false;
    try {
      const snapshot = await window.battly.getLoaderBuilds(
        selectedLoader as 'fabric' | 'forge' | 'legacyfabric' | 'neoforge' | 'quilt',
        selectedMinecraftVersion,
      );
      if (
        request !== loaderBuildRequest ||
        loader.value !== selectedLoader ||
        versionSelect.value !== selectedMinecraftVersion
      ) {
        return;
      }
      loaderVersion.replaceChildren();
      const recommended = snapshot.builds.find((build) => build.isStable) ?? snapshot.builds[0];
      if (recommended) {
        loaderVersion.append(new Option('Recomendada', recommended.version));
      }
      if (selectedLoader === 'neoforge') {
        loaderVersion.append(new Option('Última', 'latest'));
      }
      for (const build of snapshot.builds) {
        loaderVersion.append(new Option(build.version, build.version));
      }
      if (!snapshot.builds.length) {
        loaderVersion.append(new Option('Última', 'latest'));
      }
      if ([...loaderVersion.options].some((option) => option.value === previous)) {
        loaderVersion.value = previous;
      }
    } catch {
      if (request !== loaderBuildRequest) {
        return;
      }
      loaderVersion.replaceChildren(new Option('Error / Última', 'latest'));
    } finally {
      loaderVersion.disabled = false;
    }
  };
  loader?.addEventListener('change', () => void updateLoaderVersion());
  versionSelect?.addEventListener('change', () => void updateLoaderVersion());
  form?.querySelectorAll<HTMLInputElement>('input[name="instanceVersionType"]').forEach((input) => {
    input.addEventListener('change', () => void populateInstanceVersions());
  });
  imageInput?.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file || !imagePreview) {
      return;
    }
    void readInstanceIcon(file)
      .then((iconDataUrl) => {
        if (iconDataUrl) {
          imagePreview.src = iconDataUrl;
          imagePreview.alt = `Vista previa de ${file.name}`;
          imagePreview.dataset.customIcon = 'true';
          const name = form?.querySelector<HTMLElement>('[data-instance-image-name]');
          if (name) {
            setUserText(name, file.name);
          }
        }
      })
      .catch((error: unknown) => {
        const status = document.querySelector<HTMLElement>('[data-instance-status]');
        if (status) {
          status.textContent =
            error instanceof Error ? error.message : 'No se pudo previsualizar la imagen';
        }
      });
  });
  form
    ?.querySelector<HTMLSelectElement>('[data-instance-ram-mode]')
    ?.addEventListener('change', () => updateInstanceRuntimeControls(form));
  form
    ?.querySelector<HTMLSelectElement>('[data-instance-java-mode]')
    ?.addEventListener('change', () => updateInstanceRuntimeControls(form));
  form
    ?.querySelector<HTMLButtonElement>('[data-instance-java-select]')
    ?.addEventListener('click', () => {
      void window.battly.selectJavaExecutable().then((path) => {
        const input = form.elements.namedItem('javaPath');
        if (path && input instanceof HTMLInputElement) {
          input.value = path;
        }
      });
    });
  document
    .querySelector<HTMLButtonElement>('[data-instance-create-open]')
    ?.addEventListener('click', () => {
      resetInstanceEditor();
      showLegacyModal(document.querySelector<HTMLElement>('[data-instance-editor-dialog]'));
      void populateInstanceVersions().then(() =>
        form?.querySelector<HTMLInputElement>('input[name="name"]')?.focus(),
      );
    });
  document.querySelectorAll<HTMLElement>('[data-instance-editor-close]').forEach((close) => {
    close.addEventListener('click', resetInstanceEditor);
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const editing = form.dataset.editing;
    if (status) {
      status.textContent = 'Guardando instancia…';
    }
    void readInstanceIcon(imageInput?.files?.[0])
      .then((iconDataUrl) => {
        const draft = instanceDraftFromForm(form, iconDataUrl);
        return editing
          ? window.battly.updateInstance(editing, draft)
          : window.battly.createInstance(draft);
      })
      .then((instances) => {
        renderInstances(instances);
        resetInstanceEditor();
        if (status) {
          status.textContent = 'Instancia guardada correctamente';
        }
      })
      .catch(() => {
        if (status) {
          status.textContent = 'No se pudo guardar la instancia';
        }
      });
  });
}

function bindLaunchLifecycle(): void {
  for (const selector of ['[data-instance-launch-dialog]', '[data-launch-dialog]']) {
    const dialog = document.querySelector<HTMLElement>(selector);
    if (dialog && !dialog.querySelector('[data-prepare-background]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.prepareBackground = '';
      button.className = 'button is-info is-outlined is-small launch-prepare-background';
      button.textContent = 'Preparar en segundo plano';
      button.onclick = () => {
        void window.battly.minimizeWindow();
      };
      (dialog.querySelector('.launch-log-actions, footer') || dialog).append(button);
    }
  }
  const launcherSettings = document.querySelector('#b-settings-panel-launcher');
  if (
    launcherSettings &&
    !launcherSettings.querySelector('[data-setting="minimizeWhilePreparing"]')
  ) {
    const label = document.createElement('label');
    label.className = 'launcher-setting-row';
    label.innerHTML =
      '<span>Minimizar al preparar Minecraft</span><input type="checkbox" data-setting="minimizeWhilePreparing">';
    (launcherSettings.querySelector('[data-settings-group="General"]') ?? launcherSettings).append(
      label,
    );
  }
  window.battly.onLaunchEvent(renderLaunchEvent);
  window.battly.onCrashReport(showCrashReport);
  document
    .querySelectorAll<HTMLElement>('[data-instance-phase-card] .card-header')
    .forEach((header) => {
      header.addEventListener('click', () =>
        header.closest<HTMLElement>('[data-instance-phase-card]')?.classList.toggle('is-expanded'),
      );
    });
  window.battly.onDirectPlayRequested((request) => {
    if (request.instanceId) {
      void window.battly
        .getInstances()
        .then((instances) => {
          const instance = instances.find((item) => item.id === request.instanceId);
          if (!instance) {
            throw new Error('La instancia del acceso directo ya no existe');
          }
          startInstance(instance);
        })
        .catch((error) => {
          void askBattly({
            text: error instanceof Error ? error.message : 'No se pudo abrir la instancia',
          });
        });
      return;
    }
    const label = playVersionLabel(
      request.customVersion || request.version,
      request.loader,
      request.loaderVersion,
      request.custom,
    );
    startPlayVersion(request, label);
  });
  window.battly.onRemoteLaunchRequested((request) => {
    void window.battly
      .getInstances()
      .then((instances) => {
        const instance = instances.find((candidate) => candidate.id === request.instanceId);
        if (!instance) {
          throw new Error('Remote instance is unavailable');
        }
        startInstance(instance, false, null, request.javaPath);
      })
      .catch(() => {
        const status = launchStatusElement();
        if (status) {
          status.textContent = 'La instancia solicitada por control remoto no existe';
        }
      });
  });
  document
    .querySelector<HTMLButtonElement>('[data-launch-cancel]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const status = launchStatusElement();
      button.disabled = true;
      button.textContent = 'Cancelando…';
      void window.battly
        .cancelLaunch()
        .then((accepted) => {
          if (accepted) {
            if (status) {
              status.textContent = 'Cancelación solicitada. Esperando al core…';
            }
            appendLaunchLog('[Battly] Cancelación solicitada');
            return;
          }
          if (status) {
            status.textContent = 'Este core no permite cancelar en este momento';
          }
          appendLaunchLog('[Battly] El core rechazó la cancelación');
          button.disabled = false;
          button.textContent = 'Cancelar';
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo solicitar la cancelación';
          }
          button.disabled = false;
          button.textContent = 'Cancelar';
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-instance-launch-cancel]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const dialog = document.querySelector<HTMLDialogElement>('[data-instance-launch-dialog]');
      const status = document.querySelector<HTMLElement>('[data-instance-launch-message]');
      if (document.body.dataset.launchState === 'failed') {
        activeLaunchSurface = null;
        dialog?.close();
        return;
      }
      button.disabled = true;
      button.textContent = 'Cancelando…';
      void window.battly
        .cancelLaunch()
        .then((accepted) => {
          if (accepted) {
            if (status) {
              status.textContent = 'Cancelación solicitada. Esperando al core…';
            }
            return;
          }
          if (status) {
            status.textContent = 'Este core no permite cancelar en este momento';
          }
          button.disabled = false;
          button.textContent = 'Cancelar';
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo solicitar la cancelación';
          }
          button.disabled = false;
          button.textContent = 'Cancelar';
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-launch-details-toggle]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const log = document.querySelector<HTMLElement>('[data-launch-log]');
      if (!log) {
        return;
      }
      log.hidden = !log.hidden;
      button.setAttribute('aria-expanded', String(!log.hidden));
      button.innerHTML = `<i class="fa-solid fa-terminal" aria-hidden="true"></i> ${log.hidden ? 'Mostrar' : 'Ocultar'} detalles`;
    });
  document
    .querySelector<HTMLButtonElement>('[data-launch-close]')
    ?.addEventListener('click', () =>
      document.querySelector<HTMLDialogElement>('[data-launch-dialog]')?.close(),
    );
  document
    .querySelector<HTMLButtonElement>('[data-launch-open-logs]')
    ?.addEventListener('click', () => {
      const status = launchStatusElement();
      void window.battly.openLaunchLogs().catch(() => {
        if (status) {
          status.textContent = 'No se pudo abrir la carpeta de registros';
        }
      });
    });
  document.querySelectorAll<HTMLButtonElement>('[data-crash-report-close]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector<HTMLDialogElement>('[data-crash-report-dialog]')?.close();
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-crash-log-toggle]')
    ?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const content = document.querySelector<HTMLElement>('[data-crash-log-content]');
      if (!content) {
        return;
      }
      content.hidden = !content.hidden;
      button.setAttribute('aria-expanded', String(!content.hidden));
      const icon = button.querySelector('i');
      icon?.classList.toggle('fa-angle-down', content.hidden);
      icon?.classList.toggle('fa-angle-up', !content.hidden);
    });
  document
    .querySelector<HTMLButtonElement>('[data-crash-focus-solutions]')
    ?.addEventListener('click', () => {
      document
        .querySelector<HTMLElement>('.crash-report-solutions')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  document
    .querySelector<HTMLButtonElement>('[data-crash-save-logs]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-crash-report-status]');
      void window.battly
        .openLaunchLogs()
        .then(() => {
          if (status) {
            status.textContent = 'Los registros están guardados en la carpeta de Battly.';
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo abrir la carpeta de registros.';
          }
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-crash-discord]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-crash-report-status]');
      void window.battly.openDiscord().catch(() => {
        if (status) {
          status.textContent = 'No se pudo abrir Discord.';
        }
      });
    });
}

let modsOffset = 0;
let modsTotal = 0;
let modsSearchGeneration = 0;
let modsNetworkOnline = navigator.onLine;
const modsPageSize = 40;

function isCurseForgeCatalog(): boolean {
  return document.querySelector<HTMLSelectElement>('[data-mod-provider]')?.value === 'curseforge';
}

function syncModCatalogFilters(): void {
  const curseForge = isCurseForgeCatalog();
  const type = document.querySelector<HTMLSelectElement>('[data-mod-project-type]')?.value;
  const category = document.querySelector<HTMLSelectElement>('[data-mod-category]');
  if (category) {
    category.disabled = Boolean(type && type !== 'mod');
  }
  const sort = document.querySelector<HTMLSelectElement>('[data-mod-sort]');
  const follows = sort?.querySelector<HTMLOptionElement>('option[value="follows"]');
  if (sort && follows) {
    follows.disabled = curseForge;
    if (curseForge && sort.value === 'follows') {
      sort.value = 'relevance';
    }
  }
  const credit = document.querySelector<HTMLElement>('[data-mod-provider-credit]');
  if (credit) {
    const provider = document.querySelector<HTMLSelectElement>('[data-mod-provider]')?.value;
    const names =
      provider === 'all' ? ['Modrinth', 'CurseForge'] : [curseForge ? 'CurseForge' : 'Modrinth'];
    const parts = new Intl.ListFormat(document.documentElement.lang || 'es').formatToParts(names);
    credit.replaceChildren(
      ...parts.map(({ type, value }) => {
        if (type === 'literal') {
          return document.createTextNode(value);
        }
        const name = document.createElement('strong');
        name.dataset.catalogCredit = value.toLowerCase();
        name.textContent = value;
        return name;
      }),
    );
  }
}

function modSearchRequest(): ModSearchRequest {
  const value = (selector: string): string =>
    document.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? '';
  const projectType = value('[data-mod-project-type]');
  const loader = value('[data-mod-loader]');
  const provider = value('[data-mod-provider]');
  const gameVersions = [...document.querySelectorAll<HTMLInputElement>('[data-mod-game-version]')]
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
  return {
    provider: provider === 'modrinth' || provider === 'curseforge' ? provider : 'all',
    query: value('[data-mod-query]'),
    sort: value('[data-mod-sort]') as ModSearchRequest['sort'],
    loader: loader || null,
    category: !projectType || projectType === 'mod' ? value('[data-mod-category]') || null : null,
    projectType: (projectType || null) as ModProjectType | null,
    gameVersions,
    offset: modsOffset,
    limit: modsPageSize,
  };
}

function installModProject(
  project: ModProjectSummary,
  button: HTMLButtonElement,
  selectedRequest?: ModInstallRequest,
): void {
  const status = document.querySelector<HTMLElement>('[data-mod-status]');
  const detailStatus = document.querySelector<HTMLElement>('[data-mod-detail-status]');
  const downloadStatus = document.querySelector<HTMLElement>('[data-mod-download-status]');
  const setStatus = (value: string): void => {
    if (status) {
      status.textContent = value;
    }
    if (detailStatus && activeModProject?.id === project.id) {
      detailStatus.textContent = value;
    }
    if (downloadStatus && activeModProject?.id === project.id) {
      downloadStatus.textContent = value;
    }
  };
  const installRequest = selectedRequest ?? modInstallRequest(project);
  if (!installRequest) {
    setStatus('Indica una versión del juego para instalar');
    return;
  }
  button.disabled = true;
  setStatus(`Instalando ${project.title} y sus dependencias…`);
  const installingModpack = project.projectType === 'modpack';
  const installingSurface = document.querySelector<HTMLElement>('[data-mod-installing-surface]');
  const installingTitle = document.querySelector<HTMLElement>('[data-mod-installing-title]');
  const installingStatus = document.querySelector<HTMLElement>('[data-mod-installing-status]');
  const cancel = document.querySelector<HTMLButtonElement>('[data-mod-download-cancel]');
  if (installingModpack) {
    document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.close();
    openModpackInstallModal(project.title, project);
  } else {
    const installingIcon = document.querySelector<HTMLImageElement>('[data-mod-installing-icon]');
    if (installingIcon) {
      installingIcon.src = catalogImageUrl(project.iconUrl ?? '') || battlyIconUrl;
      installingIcon.onerror = () => {
        installingIcon.onerror = null;
        installingIcon.src = battlyIconUrl;
      };
    }
    if (installingTitle) {
      installingTitle.textContent = `Instalando ${project.title}`;
    }
    if (installingStatus) {
      installingStatus.textContent = 'Descargando archivos y resolviendo dependencias…';
    }
    if (installingSurface) {
      installingSurface.hidden = false;
    }
    if (cancel) {
      cancel.disabled = true;
    }
  }
  void window.battly
    .installMod(installRequest)
    .then((result) => {
      setStatus('');
      button.textContent = 'Instalado';
      if (installingModpack) {
        if (activeModProject?.id === project.id) {
          document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]')?.close();
        }
        finishModpackInstallModal(`${project.title} instalado`, true);
        if (result.instance) {
          void offerOpenInstalledModpack(result.instance);
        }
      } else {
        if (installingSurface) {
          installingSurface.hidden = true;
        }
        document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.close();
        document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]')?.close();
        const dependencies = Math.max(0, result.installed.length - 1);
        const message = translateUiText(`Se ha instalado ${project.title}.`);
        const note =
          dependencies === 0
            ? ''
            : translateUiText(
                dependencies === 1
                  ? 'Se ha instalado 1 dependencia.'
                  : `Se han instalado ${dependencies} dependencias.`,
              );
        showToast('Instalación completada', note ? `${message} ${note}` : message, 'success');
      }
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : `No se pudo instalar ${project.title}`;
      setStatus(translateUiText(userErrorMessage(message)));
      if (installingModpack) {
        finishModpackInstallModal(message, false);
      }
      button.disabled = false;
    })
    .finally(() => {
      if (!installingModpack && installingSurface) {
        installingSurface.hidden = true;
      }
      if (cancel) {
        cancel.disabled = false;
      }
    });
}

function modInstallRequest(project: ModProjectSummary): ModInstallRequest | null {
  const request = modSearchRequest();
  const gameVersion = request.gameVersions[0] ?? project.gameVersions[0];
  const loader =
    request.loader ??
    project.categories.find((category) =>
      ['fabric', 'forge', 'quilt', 'neoforge'].includes(category),
    );
  return gameVersion
    ? {
        projectId: project.id,
        gameVersion,
        loader: project.projectType === 'datapack' ? 'datapack' : (loader ?? 'minecraft'),
        projectType: project.projectType,
      }
    : null;
}

let activeModProject: ModProjectSummary | null = null;
let activeModDetailRequest: ModInstallRequest | null = null;
let modDetailRevision = 0;

const modMarkdown = new Marked({ gfm: true, breaks: false, async: false });

function renderModMarkdown(target: HTMLElement, markdown: string): void {
  const rendered = modMarkdown.parse(markdown);
  const sanitized = DOMPurify.sanitize(typeof rendered === 'string' ? rendered : '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'form',
      'iframe',
      'object',
      'embed',
      'style',
      'video',
      'audio',
      'source',
      'track',
      'input',
      'link',
    ],
    FORBID_ATTR: ['style', 'srcset', 'poster', 'background', 'ping'],
    RETURN_DOM_FRAGMENT: true,
  });
  sanitized.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const src = catalogImageUrl(image.getAttribute('src') ?? '');
    if (src) {
      image.src = src;
    } else {
      image.remove();
    }
  });
  target.replaceChildren(sanitized);
  target.querySelectorAll('table').forEach((table) => {
    const scroll = document.createElement('div');
    scroll.className = 'mod-markdown-table-scroll';
    table.before(scroll);
    scroll.append(table);
  });
  target.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  target.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    bindModImageZoom(image);
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      image.hidden = true;
      image.closest('a')?.classList.add('mod-detail-image-unavailable');
    });
  });
}

function selectModDetailTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mod-detail-tab]').forEach((button) => {
    const active = button.dataset.modDetailTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll<HTMLElement>('[data-mod-detail-panel]').forEach((panel) => {
    const active = panel.dataset.modDetailPanel === tab;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
}

function modDetailLink(label: string, url: string | null, icon: string): HTMLAnchorElement | null {
  if (!url) {
    return null;
  }
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
  const text = document.createElement('span');
  text.textContent = label;
  link.append(text);
  return link;
}

function readableModDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(uiLocale(), { dateStyle: 'medium' }).format(date);
}

function renderModDetail(detail: ModProjectDetail): void {
  const versions = document.querySelector<HTMLElement>('[data-mod-detail-versions]');
  const dependencies = document.querySelector<HTMLElement>('[data-mod-detail-dependencies]');
  const compatibility = document.querySelector<HTMLElement>('[data-mod-detail-compatibility]');
  versions?.replaceChildren();
  dependencies?.replaceChildren();
  if (compatibility) {
    compatibility.textContent = `${detail.gameVersion} · ${detail.loader} · ${detail.versions.length} versiones`;
  }
  const downloads = document.querySelector<HTMLElement>('[data-mod-detail-downloads]');
  const followers = document.querySelector<HTMLElement>('[data-mod-detail-followers]');
  const loaders = document.querySelector<HTMLElement>('[data-mod-detail-loaders]');
  const body = document.querySelector<HTMLElement>('[data-mod-detail-body]');
  const gallery = document.querySelector<HTMLElement>('[data-mod-detail-gallery]');
  const links = document.querySelector<HTMLElement>('[data-mod-detail-links]');
  const categories = document.querySelector<HTMLElement>('[data-mod-detail-categories]');
  const creators = document.querySelector<HTMLElement>('[data-mod-detail-creators]');
  const metadata = document.querySelector<HTMLElement>('[data-mod-detail-metadata]');
  if (downloads) {
    downloads.textContent = formatCount(detail.downloads);
  }
  if (followers) {
    followers.textContent = formatCount(detail.followers);
  }
  if (loaders) {
    loaders.textContent = detail.loaders
      .map((loader) => loader.charAt(0).toUpperCase() + loader.slice(1))
      .join(', ');
  }
  if (body) {
    renderModMarkdown(body, detail.body);
  }
  gallery?.replaceChildren();
  for (const image of detail.gallery) {
    const card = document.createElement('figure');
    const picture = document.createElement('img');
    picture.src = catalogImageUrl(image.url) || battlyIconUrl;
    picture.alt = image.title ?? image.description ?? '';
    picture.loading = 'lazy';
    picture.referrerPolicy = 'no-referrer';
    bindModImageZoom(picture);
    const caption = document.createElement('figcaption');
    const title = document.createElement('strong');
    setUserText(title, image.title ?? image.description, 'Captura del proyecto');
    const date = document.createElement('span');
    date.innerHTML = '<i class="fa-regular fa-calendar" aria-hidden="true"></i>';
    date.append(` ${readableModDate(image.created)}`);
    caption.append(title, date);
    card.append(picture, caption);
    gallery?.append(card);
  }
  if (!detail.gallery.length && gallery) {
    gallery.textContent = 'Este proyecto no tiene galería.';
  }

  links?.replaceChildren();
  const projectLinks = [
    modDetailLink('Servidor de Discord', detail.discordUrl, 'fa-brands fa-discord'),
    modDetailLink('Código fuente', detail.sourceUrl, 'fa-solid fa-code-branch'),
    modDetailLink('Wiki', detail.wikiUrl, 'fa-solid fa-book'),
  ].filter((link): link is HTMLAnchorElement => Boolean(link));
  links?.append(...projectLinks);
  if (!projectLinks.length && links) {
    links.textContent = 'No hay enlaces públicos.';
  }

  categories?.replaceChildren();
  detail.categories.forEach((category) => {
    const tag = document.createElement('span');
    tag.textContent = category;
    categories?.append(tag);
  });
  creators?.replaceChildren();
  detail.creators.forEach((creator) => {
    const row = document.createElement('div');
    row.className = 'mod-detail-creator';
    const avatar = document.createElement('img');
    avatar.src = catalogImageUrl(creator.avatarUrl ?? '') || battlyIconUrl;
    avatar.alt = '';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    setUserText(name, creator.name || creator.username);
    const role = document.createElement('small');
    setUserText(role, creator.role);
    copy.append(name, role);
    row.append(avatar, copy);
    creators?.append(row);
  });
  metadata?.replaceChildren();
  const metadataRows = [
    ['fa-regular fa-clipboard', `Licencia ${detail.licenseName || detail.licenseId}`],
    ['fa-regular fa-calendar', `Publicado: ${readableModDate(detail.published)}`],
    ['fa-solid fa-wave-square', `Actualizado: ${readableModDate(detail.updated)}`],
  ] as const;
  metadataRows.forEach(([icon, text]) => {
    const row = document.createElement('p');
    row.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
    row.append(` ${text}`);
    metadata?.append(row);
  });
  detail.versions.forEach((version, index) => {
    const row = document.createElement('article');
    row.className = 'mod-detail-version';
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    setUserText(title, version.name || version.versionNumber || version.filename);
    const metadata = document.createElement('small');
    metadata.textContent = `${version.versionNumber} · ${readableModDate(version.datePublished)} · ${formatCount(version.downloads)} descargas`;
    copy.append(title, metadata);
    if (version.changelog) {
      const changelog = document.createElement('div');
      changelog.className = 'mod-changelog content';
      renderModMarkdown(changelog, version.changelog);
      copy.append(changelog);
    }
    const install = document.createElement('button');
    install.type = 'button';
    install.innerHTML = '<i class="fa-solid fa-download" aria-hidden="true"></i> Descargar';
    install.addEventListener('click', () => {
      if (!activeModProject) {
        return;
      }
      if (
        activeModProject.projectType === 'modpack' ||
        activeModProject.projectType === 'datapack'
      ) {
        void openModDownloadDialog(activeModProject);
        return;
      }
      const request = activeModDetailRequest;
      if (request) {
        installModProject(activeModProject, install, { ...request, versionId: version.id });
      }
    });
    if (index === 0) {
      row.classList.add('is-recommended');
    }
    row.append(copy, install);
    versions?.append(row);
  });
  const allDependencies = detail.versions[0]?.dependencies ?? [];
  allDependencies.forEach((dependency) => {
    const row = document.createElement('article');
    row.className = `mod-detail-dependency is-${dependency.type}`;
    const label = document.createElement('strong');
    label.textContent = dependency.projectId ?? dependency.versionId ?? 'Dependencia incluida';
    const type = document.createElement('span');
    type.textContent =
      dependency.type === 'required'
        ? 'Obligatoria'
        : dependency.type === 'optional'
          ? 'Opcional'
          : dependency.type === 'incompatible'
            ? 'Incompatible'
            : 'Incluida';
    row.append(label, type);
    dependencies?.append(row);
  });
  if (!detail.versions.length && versions) {
    versions.textContent = 'No hay versiones compatibles.';
  }
  if (!allDependencies.length && dependencies) {
    dependencies.textContent = 'Esta versión no declara dependencias.';
  }
}

function openModDetail(project: ModProjectSummary): void {
  const revision = ++modDetailRevision;
  const dialog = document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]');
  const status = document.querySelector<HTMLElement>('[data-mod-detail-status]');
  const icon = document.querySelector<HTMLImageElement>('[data-mod-detail-icon]');
  activeModProject = project;
  activeModDetailRequest = null;
  const current = (): boolean => revision === modDetailRevision && Boolean(dialog?.open);
  const busy = (value: boolean): void => {
    dialog?.setAttribute('aria-busy', String(value));
    dialog?.querySelectorAll<HTMLButtonElement>('[data-mod-detail-tab]').forEach((button) => {
      button.disabled = value;
    });
  };
  busy(true);
  dialog
    ?.querySelectorAll<HTMLElement>(
      '[data-mod-detail-downloads], [data-mod-detail-followers], [data-mod-detail-loaders], [data-mod-detail-compatibility], [data-mod-detail-gallery], [data-mod-detail-versions], [data-mod-detail-dependencies], [data-mod-detail-links], [data-mod-detail-categories], [data-mod-detail-creators], [data-mod-detail-metadata]',
    )
    .forEach((element) => element.replaceChildren());
  const install = dialog?.querySelector<HTMLButtonElement>('[data-mod-detail-install]');
  dialog?.querySelector('[data-basket-detail]')?.remove();
  const curseForge = Boolean(curseForgeProjectId(project.id));
  const detailBasket = curseForge ? null : modBasket.button(project);
  const external = dialog?.querySelector<HTMLButtonElement>('[data-mod-detail-info]');
  if (external) {
    const label = translateUiText(curseForge ? 'Abrir en CurseForge' : 'Abrir en Modrinth');
    external.title = label;
    external.setAttribute('aria-label', label);
  }
  if (detailBasket) {
    detailBasket.dataset.basketDetail = '';
    install?.after(detailBasket);
  }
  if (install) {
    install.disabled = true;
  }
  if (icon) {
    icon.src = catalogImageUrl(project.iconUrl ?? '') || battlyIconUrl;
  }
  const set = (selector: string, value: string): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) {
      element.textContent = value;
    }
  };
  set('[data-mod-detail-title]', project.title);
  set('[data-mod-detail-author]', project.author);
  set('[data-mod-detail-type]', project.projectType.toUpperCase());
  set('[data-mod-detail-description]', project.description);
  selectModDetailTab('description');
  dialog?.showModal();
  if (status) {
    status.textContent = 'Buscando versiones compatibles…';
  }
  const detailBody = document.querySelector<HTMLElement>('[data-mod-detail-body]');
  if (detailBody) {
    detailBody.replaceChildren(steveLoader('Cargando…'));
  }
  const request = modInstallRequest(project);
  if (!request) {
    busy(false);
    detailBody?.replaceChildren();
    if (status) {
      status.textContent = 'Indica una versión del juego antes de abrir el detalle.';
    }
    return;
  }
  void window.battly
    .getModVersionCatalog(project.id)
    .then((catalog) => {
      if (!current()) {
        return null;
      }
      const filters = modSearchRequest();
      const selected = catalog.find(
        (version) =>
          (!filters.loader || version.loaders.includes(filters.loader)) &&
          (!filters.gameVersions.length ||
            filters.gameVersions.some((game) => version.gameVersions.includes(game))),
      );
      const detailRequest = selected
        ? {
            ...request,
            gameVersion:
              filters.gameVersions.find((game) => selected.gameVersions.includes(game)) ??
              selected.gameVersions[0] ??
              request.gameVersion,
            loader: filters.loader ?? selected.loaders[0] ?? 'minecraft',
          }
        : request;
      if (activeModProject?.id === project.id) {
        activeModDetailRequest = detailRequest;
      }
      return window.battly.getModProjectDetails(detailRequest);
    })
    .then((detail) => {
      if (!detail || !current()) {
        return;
      }
      renderModDetail(detail);
      busy(false);
      if (install) {
        install.disabled = !detail.versions.length;
      }
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      if (!current()) {
        return;
      }
      busy(false);
      detailBody?.replaceChildren();
      if (status) {
        status.textContent = 'No se pudieron cargar las versiones compatibles.';
      }
    });
}

let modDownloadRevision = 0;
async function openModDownloadDialog(project: ModProjectSummary): Promise<void> {
  const revision = ++modDownloadRevision;
  const curseForge = Boolean(curseForgeProjectId(project.id));
  const dialog = document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]');
  const loaders = document.querySelector<HTMLElement>('[data-mod-download-loaders]');
  const game = document.querySelector<HTMLSelectElement>('[data-mod-download-game]');
  const versions = document.querySelector<HTMLSelectElement>('[data-mod-download-version]');
  const confirm = document.querySelector<HTMLButtonElement>('[data-mod-download-confirm]');
  const status = document.querySelector<HTMLElement>('[data-mod-download-status]');
  const title = document.querySelector<HTMLElement>('[data-mod-download-title]');
  const destinationSection = document.querySelector<HTMLElement>(
    '[data-mod-download-destination-section]',
  );
  const destination = document.querySelector<HTMLSelectElement>('[data-mod-download-destination]');
  const worldsSection = document.querySelector<HTMLElement>('[data-mod-download-world-section]');
  const world = document.querySelector<HTMLSelectElement>('[data-mod-download-world]');
  const destinationWarning = document.querySelector<HTMLElement>(
    '[data-mod-download-destination-warning]',
  );
  if (!dialog || !loaders || !game || !versions || !confirm) {
    return;
  }
  if (title) {
    title.textContent = `Descargar ${project.title}`;
  }
  if (status) {
    status.textContent = '';
  }
  const needsWorld = project.projectType === 'datapack';
  if (worldsSection) {
    worldsSection.hidden = !needsWorld;
  }
  world?.replaceChildren();
  if (destinationSection) {
    destinationSection.hidden = false;
  }
  if (destination) {
    destination.replaceChildren(
      new Option(
        project.projectType === 'modpack' ? translateUiText('Nueva instancia') : 'Predeterminado',
        '',
      ),
    );
    destination.disabled = true;
    destination.onchange = null;
  }
  if (destinationWarning) {
    destinationWarning.style.display = 'none';
  }
  loaders.replaceChildren();
  game.replaceChildren(new Option('Cargando versiones…', ''));
  versions.replaceChildren(new Option('Cargando versiones…', ''));
  confirm.disabled = true;
  game.onchange = null;
  versions.onchange = null;
  if (!dialog.open) {
    dialog.showModal();
  }
  let catalog: Awaited<ReturnType<typeof window.battly.getModVersionCatalog>>;
  let instances: readonly InstanceSummary[];
  let worlds: Awaited<ReturnType<typeof window.battly.getBackupWorlds>>;
  try {
    [catalog, instances, worlds] = await Promise.all([
      window.battly.getModVersionCatalog(project.id),
      destination && project.projectType !== 'modpack'
        ? window.battly.getInstances().catch(() => [])
        : [],
      needsWorld ? window.battly.getBackupWorlds().catch(() => []) : [],
    ]);
  } catch {
    if (revision !== modDownloadRevision || !dialog.open) {
      return;
    }
    game.replaceChildren(new Option('No se pudo cargar el catálogo', ''));
    versions.replaceChildren(new Option('Vuelve a abrir para reintentar', ''));
    if (status) {
      status.textContent = curseForge
        ? translateUiText('No se pudo consultar el catálogo de CurseForge. Inténtalo de nuevo.')
        : 'Error al consultar Modrinth. No se ha comprobado la compatibilidad.';
    }
    return;
  }
  if (revision !== modDownloadRevision || !dialog.open) {
    return;
  }
  const serverDestinations =
    (project.projectType === 'mod' && !curseForge) || project.projectType === 'modpack'
      ? await window.battly.getServers().catch(() => [])
      : [];
  if (revision !== modDownloadRevision || !dialog.open) {
    return;
  }
  if (destination) {
    instances.forEach((instance) => destination.add(new Option(instance.name, instance.id)));
    const group = document.createElement('optgroup');
    group.label = 'Servidores';
    serverDestinations
      .filter(
        (server) =>
          project.projectType === 'modpack' ||
          Boolean(
            server.software.installedAt &&
            ['fabric', 'forge', 'neoforge'].includes(server.software.kind),
          ),
      )
      .forEach((server) => {
        const version =
          project.projectType === 'modpack'
            ? server.version
            : (server.software.gameVersion ?? server.version);
        const compatible = catalog.some(
          (entry) =>
            entry.gameVersions.includes(version) &&
            (project.projectType === 'modpack'
              ? entry.loaders.some((loader) =>
                  ['forge', 'fabric', 'neoforge', 'minecraft'].includes(loader),
                )
              : entry.loaders.includes(server.software.kind)),
        );
        const option = new Option(
          compatible
            ? `${server.name} · ${version} · ${server.software.kind}`
            : `${server.name} · ${version} · ${server.software.kind} · sin versión compatible`,
          `server:${server.id}`,
        );
        option.disabled = !compatible;
        group.append(option);
      });
    if (group.children.length) {
      destination.append(group);
    }
    destination.disabled = false;
  }
  if (project.projectType === 'datapack') {
    catalog = catalog
      .filter((entry) => entry.loaders.includes('datapack'))
      .map((entry) => ({
        ...entry,
        loaders: ['datapack'],
      }));
  }
  const supportedLoaders = [...new Set(catalog.flatMap((version) => [...version.loaders]))];
  if (!supportedLoaders.length) {
    supportedLoaders.push('minecraft');
  }
  loaders.replaceChildren();
  supportedLoaders.forEach((loader, index) => {
    const label = document.createElement('label');
    label.className = 'b-mods-radio';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'radio_loader';
    input.value = loader;
    input.checked = index === 0;
    const name = document.createElement('span');
    name.className = 'b-mods-name';
    name.textContent = loader.charAt(0).toUpperCase() + loader.slice(1);
    label.append(input, name);
    loaders.append(label);
  });
  versions.replaceChildren(new Option('Elige la versión del mod', ''));
  confirm.disabled = true;
  const selectedLoader = (): string =>
    loaders.querySelector<HTMLInputElement>('input:checked')?.value ?? supportedLoaders[0];
  let versionRevision = 0;
  const buildGameOptions = (): void => {
    versionRevision++;
    game.replaceChildren(new Option('Elige la versión de Minecraft', ''));
    [
      ...new Set(
        catalog
          .filter(
            (version) => !version.loaders.length || version.loaders.includes(selectedLoader()),
          )
          .flatMap((version) => [...version.gameVersions]),
      ),
    ]
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .forEach((version) => game.add(new Option(version, version)));
    versions.replaceChildren(new Option('Elige la versión del mod', ''));
    confirm.disabled = true;
  };
  buildGameOptions();
  const loadVersions = (): void => {
    const current = ++versionRevision;
    confirm.disabled = true;
    const gameVersion = game.value;
    if (!gameVersion) {
      versions.replaceChildren(new Option('Elige la versión del mod', ''));
      confirm.disabled = true;
      return;
    }
    versions.replaceChildren(new Option('Cargando versiones…', ''));
    if (status) {
      status.textContent = '';
    }
    void window.battly
      .getModProjectDetails({
        projectId: project.id,
        projectType: project.projectType,
        gameVersion,
        loader: selectedLoader(),
      })
      .then((detail) => {
        if (current !== versionRevision || revision !== modDownloadRevision || !dialog.open) {
          return;
        }
        versions.replaceChildren(new Option('Elige la versión del mod', ''));
        detail.versions.forEach((version, index) =>
          versions.add(
            new Option(
              index === 0 ? `Última compatible · ${version.filename}` : version.filename,
              version.id,
            ),
          ),
        );
        if (!detail.versions.length && status) {
          status.textContent = 'No hay versiones compatibles';
        }
      })
      .catch(() => {
        if (current !== versionRevision || revision !== modDownloadRevision || !dialog.open) {
          return;
        }
        versions.replaceChildren(new Option('Error al cargar versiones', ''));
        if (status) {
          status.textContent = 'No se pudieron cargar las versiones';
        }
      });
  };
  if (destination) {
    const updateWorlds = (): void => {
      if (!needsWorld || !world) {
        return;
      }
      const available = worlds.filter((entry) => (entry.instanceId ?? '') === destination.value);
      world.replaceChildren(
        new Option(
          translateUiText(
            available.length ? 'Elige un mundo' : 'No hay mundos en esta instalación.',
          ),
          '',
        ),
      );
      available.forEach((entry) => world.add(new Option(entry.name, entry.name)));
      if (available.length === 1) {
        world.value = available[0].name;
      }
      confirm.disabled = true;
    };
    updateWorlds();
    destination.onchange = () => {
      const server = serverDestinations.find((entry) => `server:${entry.id}` === destination.value);
      const instance =
        curseForge || needsWorld
          ? instances.find((entry) => entry.id === destination.value)
          : undefined;
      const packServer = server && project.projectType === 'modpack';
      const targetLoader =
        (packServer ? undefined : server?.software.kind) ??
        (project.projectType === 'mod' ? instance?.loader?.toLowerCase() : selectedLoader());
      game.disabled = Boolean(server || instance);
      const loaderInputs = Array.from(loaders.querySelectorAll<HTMLInputElement>('input'));
      loaderInputs.forEach((input) => {
        input.disabled = packServer
          ? !['forge', 'fabric', 'neoforge', 'minecraft'].includes(input.value) ||
            !catalog.some(
              (entry) =>
                entry.gameVersions.includes(server.version) && entry.loaders.includes(input.value),
            )
          : Boolean(server || instance);
        if ((server && !packServer) || instance) {
          input.checked = input.value === targetLoader;
        }
      });
      if (packServer && !loaderInputs.some((input) => input.checked && !input.disabled)) {
        const firstCompatible = loaderInputs.find((input) => !input.disabled);
        if (firstCompatible) {
          firstCompatible.checked = true;
        }
      }
      if (destinationWarning) {
        destinationWarning.style.display = destination.value ? 'block' : 'none';
        destinationWarning.textContent = server
          ? project.projectType === 'modpack'
            ? 'Detén el servidor. Se instalará la versión que pide el modpack.'
            : 'Se instalará en los mods de este servidor. Debe estar detenido.'
          : 'Comprueba que la versión y el loader coinciden con la instancia.';
      }
      buildGameOptions();
      updateWorlds();
      if (server || instance) {
        game.value = server
          ? packServer
            ? server.version
            : (server.software.gameVersion ?? server.version)
          : (instance?.version ?? '');
        loadVersions();
      }
    };
  }
  game.disabled = false;
  game.onchange = loadVersions;
  loaders.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.onchange = () => {
      const server = serverDestinations.find(
        (entry) => destination?.value === 'server:' + entry.id,
      );
      buildGameOptions();
      if (server) {
        game.value =
          project.projectType === 'modpack'
            ? server.version
            : (server.software.gameVersion ?? server.version);
        loadVersions();
      }
    };
  });
  const updateConfirm = () => {
    confirm.disabled = !versions.value || (needsWorld && !world?.value);
  };
  versions.onchange = updateConfirm;
  if (world) {
    world.onchange = updateConfirm;
  }
}

function renderModProjects(projects: readonly ModProjectSummary[]): void {
  const grid = document.querySelector<HTMLElement>('[data-mod-grid]');
  grid?.classList.remove('is-message-state');
  grid?.replaceChildren();
  for (const project of projects) {
    const card = document.createElement('div');
    card.className = 'b-mods-mod-item';
    card.classList.toggle('is-battly-recommended', project.recommendedByBattly === true);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Ver detalles de ${project.title}`);
    const icon = document.createElement('img');
    icon.src = catalogImageUrl(project.iconUrl ?? '') || battlyIconUrl;
    icon.alt = project.title;
    icon.onerror = () => {
      icon.onerror = null;
      icon.src = battlyIconUrl;
    };
    icon.loading = 'lazy';
    icon.referrerPolicy = 'no-referrer';
    const copy = document.createElement('div');
    copy.className = 'b-mods-mod-info';
    const title = document.createElement('h3');
    const projectName = document.createElement('strong');
    projectName.className = 'b-mod-project-title';
    setUserText(projectName, project.title);
    title.append(projectName);
    const author = document.createElement('span');
    author.className = 'b-mod-project-author';
    const authorLabel = document.createElement('span');
    setUiText(authorLabel, 'Por');
    const authorName = document.createElement('span');
    setUserText(authorName, project.author);
    author.append(authorLabel, authorName);
    title.append(author);
    const description = document.createElement('p');
    setUserText(description, project.description);
    const tags = document.createElement('div');
    tags.className = 'b-mods-tags';
    project.categories.forEach((category) => {
      const tag = document.createElement('span');
      tag.className = 'b-mods-tag';
      tag.textContent = category;
      tags.append(tag);
    });
    copy.append(title, description, tags);
    if (project.recommendedByBattly) {
      const recommendation = document.createElement('span');
      recommendation.className = 'battly-mod-recommendation';
      setUiText(recommendation, 'Recomendado por Battly');
      title.append(recommendation);
    }
    const providerLogo = document.createElement('img');
    providerLogo.className = 'b-mod-provider-logo';
    const fromCurseForge = Boolean(curseForgeProjectId(project.id));
    providerLogo.src = fromCurseForge ? curseforgeMark : modrinthMark;
    providerLogo.alt = fromCurseForge ? 'CurseForge' : 'Modrinth';
    providerLogo.title = providerLogo.alt;
    card.append(icon, copy, providerLogo);
    const basketButton = curseForgeProjectId(project.id) ? null : modBasket.button(project);
    if (basketButton) {
      card.append(basketButton);
    }
    card.addEventListener('click', () => openModDetail(project));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModDetail(project);
      }
    });
    grid?.append(card);
  }
  if (projects.length === 0 && grid) {
    renderModsMessageState(
      'empty',
      'No hay resultados',
      'Prueba con otra búsqueda o limpia los filtros seleccionados.',
    );
  }
}

function resetModsControls(): void {
  const set = (selector: string, value: string): void => {
    const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (control) {
      control.value = value;
    }
  };
  set('[data-mod-query]', '');
  set('[data-mod-sort]', 'relevance');
  set('[data-mod-loader]', '');
  set('[data-mod-category]', '');
  set('[data-mod-project-type]', '');
  document.querySelectorAll<HTMLInputElement>('[data-mod-game-version]').forEach((checkbox) => {
    checkbox.checked = false;
  });
  document
    .querySelector('[data-panel-view="mods"]')
    ?.dispatchEvent(new Event('battly:mod-filters-reset'));
}

function renderModsMessageState(
  kind: 'empty' | 'error' | 'offline',
  titleText: string,
  message: string,
): void {
  const grid = document.querySelector<HTMLElement>('[data-mod-grid]');
  if (!grid) {
    return;
  }
  grid.classList.add('is-message-state');
  const state = document.createElement('article');
  state.className = 'mods-message-state';
  state.dataset.modState = kind;
  const icon = document.createElement('i');
  icon.className =
    kind === 'offline'
      ? 'fa-solid fa-wifi'
      : kind === 'error'
        ? 'fa-solid fa-triangle-exclamation'
        : 'fa-solid fa-magnifying-glass';
  icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = titleText;
  const description = document.createElement('p');
  description.textContent = message;
  copy.append(title, description);
  const action = document.createElement('button');
  action.type = 'button';
  action.textContent = kind === 'empty' ? 'Limpiar filtros' : 'Reintentar';
  action.addEventListener('click', () => {
    if (kind === 'empty') {
      resetModsControls();
    }
    modsOffset = 0;
    searchMods();
  });
  state.append(kind === 'empty' ? thinkingSteveImage() : icon, copy, action);
  grid.replaceChildren(state);
}

function searchMods(): void {
  const generation = ++modsSearchGeneration;
  syncModCatalogFilters();
  const request = modSearchRequest();
  const curseForge = request.provider === 'curseforge';
  const status = document.querySelector<HTMLElement>('[data-mod-status]');
  if (status) {
    status.textContent = translateUiText(
      request.provider === 'all'
        ? 'Buscando contenido…'
        : curseForge
          ? 'Buscando en CurseForge…'
          : 'Buscando en Modrinth…',
    );
  }
  void window.battly
    .searchMods(request)
    .then((result) => {
      if (generation !== modsSearchGeneration) {
        return;
      }
      modsTotal = result.total;
      renderModProjects(result.projects);
      const currentPage = Math.floor(result.offset / result.limit) + 1;
      const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
      const start = result.total ? result.offset + 1 : 0;
      const end = result.total ? Math.min(result.offset + result.limit, result.total) : 0;
      const count = document.querySelector<HTMLElement>('[data-mod-results-count]');
      if (count) {
        count.textContent = result.total
          ? `${start}-${end} de ${result.total.toLocaleString(uiLocale())} resultados`
          : '0 resultados';
      }
      const page = document.querySelector<HTMLElement>('[data-mod-page-info]');
      if (page) {
        page.textContent = `Página ${currentPage} de ${totalPages}`;
      }
      const previous = document.querySelector<HTMLButtonElement>('[data-mod-page="previous"]');
      const next = document.querySelector<HTMLButtonElement>('[data-mod-page="next"]');
      if (previous) {
        previous.disabled = currentPage <= 1 || !result.total;
      }
      if (next) {
        next.disabled = currentPage >= totalPages || !result.total;
      }
      if (status) {
        status.textContent = '';
      }
    })
    .catch((error: unknown) => {
      if (generation !== modsSearchGeneration) {
        return;
      }
      const offline = !modsNetworkOnline;
      const message = offline
        ? 'Sin conexión. Tus mods locales siguen disponibles desde «Mis mods».'
        : translateUiText(userErrorMessage(error, 'No se pudo cargar el catálogo de mods.'));
      renderModsMessageState(
        offline ? 'offline' : 'error',
        offline ? 'Estás sin conexión' : 'No se pudo cargar el catálogo de mods.',
        message,
      );
      if (status) {
        status.textContent = '';
      }
    });
}

let localModsSnapshot: readonly LocalModSummary[] = [];
let localModInspections: readonly LocalModInspection[] = [];
let localModControls: LocalModControls | undefined;

function renderLocalMods(
  mods: readonly LocalModSummary[],
  inspections: readonly LocalModInspection[] = [],
): void {
  const list = document.querySelector<HTMLElement>('[data-local-mods-list]');
  localModsSnapshot = mods;
  localModInspections = inspections;
  localModControls ??= new LocalModControls(
    () => renderLocalMods(localModsSnapshot, localModInspections),
    refreshLocalMods,
  );
  localModControls.setData(mods, inspections);
  const visible = localModControls.visible();
  const byFilename = new Map(inspections.map((entry) => [entry.filename, entry]));
  list?.replaceChildren();
  for (const mod of visible) {
    const inspection = byFilename.get(mod.filename);
    const row = document.createElement('div');
    row.className = 'card local-mod-row';
    row.dataset.enabled = String(mod.enabled);
    const selection = localModControls.checkbox(mod);
    row.classList.toggle('is-selected', selection.checked);
    const header = document.createElement('header');
    header.className = 'card-header is-flex';
    const icon = document.createElement('img');
    const isOptiFine =
      inspection?.id === 'optifine' || /^(?:preview_)?optifine(?:[._ -]|$)/i.test(mod.filename);
    icon.src = inspection?.iconDataUrl ?? (isOptiFine ? optiFineIconUrl : defaultMinecraftIconUrl);
    icon.alt = '';
    icon.className = 'local-mod-icon';
    const name = document.createElement('p');
    name.className = 'card-header-title';
    const title = document.createElement('span');
    setUserText(title, inspection?.name ?? mod.filename);
    title.title = title.textContent;
    const loader = document.createElement('span');
    loader.className = 'local-mod-loader';
    loader.textContent = inspection?.loader ?? 'unknown';
    const state = document.createElement('span');
    state.className = 'local-mod-state';
    state.textContent = mod.enabled ? 'Activo' : 'Inactivo';
    name.append(title, loader, state);
    if (inspection?.gameVersion) {
      const badge = document.createElement('span');
      badge.className = 'b-mods-mc-version-badge';
      const supported =
        inspection.requirements
          ?.find((requirement) => requirement.id === 'minecraft')
          ?.ranges.join(' | ') ?? inspection.gameVersion;
      badge.textContent = `MC ${supported}`;
      badge.title = badge.textContent;
      name.append(badge);
    }
    const actions = document.createElement('div');
    actions.className = 'buttons buttons-no-margin';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'local-mod-icon-action';
    toggle.dataset.localModToggle = '';
    toggle.title = mod.enabled ? 'Desactivar' : 'Activar';
    toggle.innerHTML = `<i class="fa-solid ${mod.enabled ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    toggle.addEventListener('click', () => {
      toggle.disabled = true;
      void toggleModWithDependents(mod.filename, mod.enabled)
        .then(() => refreshLocalMods())
        .catch(() => {
          const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
          if (status) {
            status.textContent = 'No se pudo cambiar el estado del mod';
          }
        })
        .finally(() => {
          toggle.disabled = false;
        });
    });
    const archive = document.createElement('button');
    archive.type = 'button';
    archive.className = 'local-mod-icon-action';
    archive.title = 'Eliminar';
    archive.innerHTML = '<i class="fa-solid fa-trash"></i>';
    archive.addEventListener(
      'click',
      voidAsyncEvent(async () => {
        if (await askBattly({ text: `¿Archivar ${mod.filename}?` })) {
          void window.battly
            .archiveLocalMod(mod.filename)
            .then(() => refreshLocalMods())
            .catch(() => {
              const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
              if (status) {
                status.textContent = 'No se pudo archivar el mod';
              }
            });
        }
      }),
    );
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'local-mod-icon-action';
    open.title = 'Mostrar en carpeta';
    open.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
    open.addEventListener('click', () => void window.battly.revealLocalMod(mod.filename));
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'local-mod-icon-action';
    expand.title = 'Más información';
    expand.setAttribute('aria-expanded', 'false');
    expand.innerHTML = '<i class="fa-solid fa-angle-down"></i>';
    actions.append(toggle, open, archive, expand);
    for (const action of [toggle, open, archive, expand]) {
      action.setAttribute('aria-label', `${action.title}: ${title.textContent}`);
      action.querySelector('i')?.setAttribute('aria-hidden', 'true');
    }
    header.append(selection, icon, name, actions);
    const content = document.createElement('div');
    content.className = 'card-content local-mod-details';
    content.hidden = true;
    const details = document.createElement('dl');
    details.className = 'local-mod-metadata';
    const detailRows = [
      ['ID', inspection?.id ?? '—'],
      ['Versión mod', inspection?.version ?? '—'],
      ['Loader', inspection?.loader ?? '—'],
      [
        'Minecraft',
        inspection?.requirements
          ?.find((requirement) => requirement.id === 'minecraft')
          ?.ranges.join(' | ') ??
          inspection?.gameVersion ??
          '—',
      ],
    ];
    for (const [label, value] of detailRows) {
      const field = document.createElement('div');
      field.className = 'local-mod-metadata-field';
      const term = document.createElement('dt');
      term.textContent = label;
      const definition = document.createElement('dd');
      setUserText(definition, value);
      field.append(term, definition);
      details.append(field);
    }
    const dependencies = document.createElement('div');
    dependencies.className = 'local-mod-metadata-field local-mod-dependencies';
    const dependencyLabel = document.createElement('dt');
    dependencyLabel.textContent = 'Dependencias';
    const dependencyValues = document.createElement('dd');
    for (const dependency of inspection?.dependencies ?? []) {
      const chip = document.createElement('span');
      chip.className = 'local-mod-dependency';
      setUserText(chip, dependency);
      dependencyValues.append(chip);
    }
    if (!dependencyValues.childElementCount) {
      dependencyValues.textContent = '—';
    }
    dependencies.append(dependencyLabel, dependencyValues);
    const file = document.createElement('div');
    file.className = 'local-mod-metadata-field local-mod-file';
    const fileLabel = document.createElement('dt');
    fileLabel.innerHTML = '<i class="fa-regular fa-file" aria-hidden="true"></i> ';
    fileLabel.append('Archivo');
    const fileValue = document.createElement('dd');
    const filename = document.createElement('span');
    filename.className = 'local-mod-filename';
    setUserText(filename, mod.filename);
    const size = document.createElement('span');
    size.className = 'local-mod-file-size';
    setUserText(size, (mod.size / 1024).toFixed(1) + ' KiB');
    fileValue.append(filename, size);
    file.append(fileLabel, fileValue);
    details.append(dependencies, file);
    content.append(details);
    expand.addEventListener('click', () => {
      const open = !content.hidden;
      content.hidden = open;
      expand.setAttribute('aria-expanded', String(!open));
      expand.innerHTML = `<i class="fa-solid fa-angle-${open ? 'down' : 'up'}" aria-hidden="true"></i>`;
    });
    row.append(header, content);
    list?.append(row);
  }
  if (visible.length === 0 && list) {
    const empty = emptyState(mods.length ? 'Sin resultados' : 'No hay mods instalados');
    list.append(empty);
  }
}

async function refreshLocalMods(): Promise<void> {
  const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
  if (status) {
    status.replaceChildren(steveLoader('Cargando mods locales…'));
  }
  const list = document.querySelector<HTMLElement>('[data-local-mods-list]');
  if (list) {
    list.setAttribute('aria-busy', 'true');
  }
  try {
    const [mods, report] = await Promise.all([
      window.battly.getLocalMods(),
      window.battly.analyzeLocalMods(),
    ]);
    renderLocalMods(mods, report.mods);
    if (status) {
      status.textContent = '';
    }
    const panel = document.querySelector<HTMLElement>('[data-mod-compatibility-report]');
    if (panel && !panel.hidden) {
      renderModCompatibility(createCompatibilityReport(report.mods, localModControls?.target()));
    }
  } catch {
    if (status) {
      status.textContent = 'No se pudieron cargar los mods instalados';
    }
  } finally {
    list?.setAttribute('aria-busy', 'false');
  }
}

function compatibilityIssueText(entry: LocalModCompatibilityIssue): string {
  switch (entry.kind) {
    case 'dependency-version':
      return `Versión incompatible: ${entry.detected ?? '?'} → ${entry.expected ?? '?'}`;
    case 'disabled-dependency':
      return `Dependencia desactivada: ${entry.detected ?? '?'} → ${entry.expected ?? '?'}`;
    case 'conflict':
      return `Conflicto declarado: ${entry.detected ?? '?'} → ${entry.expected ?? '?'}`;
    case 'unverified':
      return `Sin verificar: ${entry.expected ?? entry.detected ?? '?'}`;
    case 'environment':
      return 'Este mod está declarado solo para servidor';
    case 'duplicate-id':
      return `ID duplicado: ${entry.detected ?? 'desconocido'}`;
    case 'game-version-mismatch':
      return `Minecraft ${entry.detected ?? '?'}; el conjunto usa ${entry.expected ?? '?'}`;
    case 'loader-mismatch':
      return `${entry.detected ?? 'Loader desconocido'}; el conjunto usa ${entry.expected ?? '?'}`;
    case 'missing-dependency':
      return `Falta la dependencia ${entry.expected ?? 'desconocida'}`;
    case 'unknown-metadata':
      return 'ZIP válido, pero no declara metadatos de un loader reconocido';
    case 'unreadable':
      return 'El JAR no contiene metadatos compatibles o está dañado';
  }
}

let localModsAnalysisBusy = false;
let localModsRepairBusy = false;

function compatibilitySuggestion(entry: LocalModCompatibilityIssue): string {
  switch (entry.kind) {
    case 'duplicate-id':
      return 'Hay varias copias activas. Conserva una sola versión compatible y desactiva las demás.';
    case 'missing-dependency':
      return 'Instala una versión compatible de la dependencia indicada. Puedes revisarlo desde las soluciones.';
    case 'disabled-dependency':
      return 'La dependencia está instalada, pero desactivada. Revisa las soluciones para activarla si es compatible.';
    case 'loader-mismatch':
    case 'game-version-mismatch':
      return 'Usa una edición para el Minecraft y loader elegidos, o desactiva este archivo.';
    case 'dependency-version':
      return 'Actualiza el mod o su dependencia para que sus versiones sean compatibles entre sí.';
    case 'conflict':
      return 'Estos mods declaran un conflicto. Desactiva uno o busca versiones compatibles entre sí.';
    case 'unreadable':
      return 'Vuelve a descargar este archivo o desactívalo antes de jugar.';
    case 'unverified':
      return 'Configura Minecraft, loader y Java en el análisis para comprobar este requisito.';
    default:
      return 'Revisa los metadatos del mod antes de usarlo en esta instalación.';
  }
}

async function disableCompatibilityFile(
  filename: string,
  button: HTMLButtonElement,
): Promise<void> {
  if (localModsRepairBusy || localModsAnalysisBusy) {
    return;
  }
  localModsRepairBusy = true;
  const controls = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-mod-compatibility-report] button, [data-local-mods-analyze]',
    ),
  ].map((control) => ({ control, disabled: control.disabled }));
  controls.forEach(({ control }) => {
    control.disabled = true;
  });
  button.disabled = true;
  try {
    const accepted = await askBattly({
      title: 'Desactivar',
      text: filename,
      note: 'El archivo se conservará y podrás volver a activarlo desde Mis mods.',
      confirmText: 'Desactivar',
      cancelText: 'Cancelar',
    });
    if (!accepted) {
      return;
    }
    setUiText(button, 'Aplicando soluciones…');
    const failed = await window.battly.batchLocalMods('disable', [filename]);
    if (failed.length) {
      throw new Error('No se pudo cambiar el estado del mod');
    }
    await refreshLocalMods();
  } catch (error) {
    const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
    if (status) {
      setUiText(status, userErrorMessage(error));
    }
  } finally {
    localModsRepairBusy = false;
    controls.forEach(({ control, disabled }) => {
      control.disabled = disabled;
    });
    button.disabled = false;
    setUiText(button, 'Desactivar');
  }
}

function renderModCompatibility(report: LocalModCompatibilityReport): void {
  const panel = document.querySelector<HTMLElement>('[data-mod-compatibility-report]');
  const summary = document.querySelector<HTMLElement>('[data-mod-compatibility-summary]');
  const context = document.querySelector<HTMLElement>('[data-mod-compatibility-context]');
  const issues = document.querySelector<HTMLElement>('[data-mod-compatibility-issues]');
  const fix = document.querySelector<HTMLButtonElement>('[data-mod-compatibility-fix]');
  if (!panel || !summary || !context || !issues || !fix) {
    return;
  }
  panel.hidden = false;
  panel.removeAttribute('aria-busy');
  panel.classList.remove('is-analyzing');
  const groups = groupCompatibilityIssues(report.issues);
  const errors = groups.filter((entry) => entry.severity === 'error');
  const warnings = groups.filter((entry) => entry.severity === 'warning');
  const problemCount =
    errors.length === 1 ? '1 problema' : '{0} problemas'.replace('{0}', String(errors.length));
  const warningCount =
    warnings.length === 1 ? '1 aviso' : '{0} avisos'.replace('{0}', String(warnings.length));
  setUiText(summary, problemCount + ' · ' + warningCount);
  summary.setAttribute('role', 'status');
  context.textContent = [
    report.primaryLoader ? 'Loader principal: ' + report.primaryLoader : null,
    report.primaryGameVersion ? 'Minecraft: ' + report.primaryGameVersion : null,
    report.mods.filter((mod) => mod.enabled).length + ' mods activos analizados',
  ]
    .filter(Boolean)
    .join(' · ');
  issues.replaceChildren();
  const warningDetails = document.createElement('details');
  warningDetails.className = 'mod-compatibility-warnings';
  const warningTitle = document.createElement('summary');
  setUiText(warningTitle, 'Sin verificar / avisos');
  warningDetails.append(warningTitle);
  for (const [index, group] of groups.entries()) {
    const entry = group.issues[0];
    const row = document.createElement('article');
    row.className = 'mod-compatibility-issue is-' + group.kind + ' is-' + group.severity;
    row.style.setProperty('--issue-delay', Math.min(index, 5) * 35 + 'ms');
    const icon = document.createElement('i');
    icon.className =
      group.severity === 'warning' ? 'fa-solid fa-circle-info' : 'fa-solid fa-triangle-exclamation';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'mod-compatibility-copy';
    const title = document.createElement('strong');
    setUserText(title, entry.modName);
    const description = document.createElement('span');
    setUiText(description, [...new Set(group.issues.map(compatibilityIssueText))].join('\n'));
    const suggestion = document.createElement('p');
    suggestion.className = 'mod-compatibility-suggestion';
    setUiText(suggestion, [...new Set(group.issues.map(compatibilitySuggestion))].join('\n'));
    copy.append(title, description, suggestion);
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'button is-small';
    setUiText(show, 'Mostrar');
    show.onclick = () => localModControls?.showFile(entry.filename);
    row.append(icon, copy, show);
    if (
      group.kind === 'duplicate-id' ||
      (group.severity === 'error' &&
        group.issues.some((issue) =>
          ['loader-mismatch', 'game-version-mismatch', 'unreadable', 'conflict'].includes(
            issue.kind,
          ),
        ))
    ) {
      const files = document.createElement('div');
      files.className = 'mod-compatibility-files';
      for (const filename of [...new Set(group.issues.map((item) => item.filename))]) {
        const file = document.createElement('div');
        file.className = 'mod-compatibility-file';
        const label = document.createElement('span');
        setUserText(label, filename);
        const disable = document.createElement('button');
        disable.type = 'button';
        disable.className = 'button is-small';
        setUiText(disable, 'Desactivar');
        disable.setAttribute('aria-label', 'Desactivar ' + filename);
        disable.onclick = () => {
          void disableCompatibilityFile(filename, disable);
        };
        file.append(label, disable);
        files.append(file);
      }
      row.append(files);
    }
    if (group.severity === 'warning') {
      warningDetails.append(row);
    } else {
      issues.append(row);
    }
  }
  if (warnings.length) {
    issues.append(warningDetails);
  }
  if (!errors.length) {
    const empty = document.createElement('p');
    empty.className = 'mod-compatibility-ok';
    setUiText(
      empty,
      warnings.length
        ? 'No hay errores confirmados. Revisa los avisos antes de jugar.'
        : 'No se encontraron problemas en los metadatos de tus mods.',
    );
    issues.prepend(empty);
  }
  const onlyDuplicates =
    errors.length > 0 && errors.every((entry) => entry.kind === 'duplicate-id');
  setUiText(fix, onlyDuplicates ? 'Elegir versiones' : 'Revisar soluciones');
  fix.hidden = !errors.length;
  fix.onclick = () => {
    if (onlyDuplicates) {
      const choice = issues.querySelector<HTMLButtonElement>('.mod-compatibility-files button');
      choice?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      choice?.focus({ preventScroll: true });
    } else {
      openModRepair(report);
    }
  };
  let hide = panel.querySelector<HTMLButtonElement>('[data-compatibility-hide]');
  if (!hide) {
    hide = document.createElement('button');
    hide.type = 'button';
    hide.dataset.compatibilityHide = '';
    setUiText(hide, 'Ocultar');
    hide.onclick = () => {
      panel.hidden = true;
    };
    panel.querySelector('.mod-compatibility-heading')?.append(hide);
  }
}

function openModRepair(report: LocalModCompatibilityReport): void {
  if (
    localModsAnalysisBusy ||
    localModsRepairBusy ||
    document.querySelector('.mod-repair-dialog')
  ) {
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'mod-repair-dialog';
  const form = document.createElement('form');
  form.innerHTML = /* HTML */ `<h2>Preparar tus mods</h2>
    <p>
      Elige dónde vas a jugar. Los mods incompatibles se desactivan, conservando sus archivos. Se
      activan dependencias compatibles y se descargan las dependencias conocidas desde Modrinth con
      sus hashes verificados.
    </p>
    <label
      >Minecraft<input
        name="gameVersion"
        required
        maxlength="60"
        placeholder="1.21.1"
        pattern="[A-Za-z0-9](?:[A-Za-z0-9._]|-)*" /></label
    ><label
      >Loader<select
        name="loader"
        required
      >
        <option value="">Selecciona un loader</option>
        <option>fabric</option>
        <option>forge</option>
        <option>neoforge</option>
        <option>quilt</option>
      </select></label
    >
    <p
      role="status"
      data-repair-status
    ></p>
    <footer>
      <button
        type="button"
        data-repair-close
      >
        Cancelar</button
      ><button type="submit">Aplicar soluciones</button>
    </footer>`;
  const game = form.elements.namedItem('gameVersion') as HTMLInputElement;
  const loader = form.elements.namedItem('loader') as HTMLSelectElement;
  game.value = localModControls?.target().gameVersion ?? report.primaryGameVersion ?? '';
  loader.value = localModControls?.target().loader ?? report.primaryLoader ?? '';
  if (report.issues.some((entry) => entry.kind === 'duplicate-id')) {
    const note = document.createElement('p');
    setUiText(
      note,
      'Las copias duplicadas se eligen en el informe. Esta acción no decide qué versión conservar.',
    );
    form.querySelector('footer')?.before(note);
  }
  const preview = document.createElement('div');
  preview.className = 'mod-repair-preview';
  const updatePreview = (): void => {
    preview.replaceChildren();
    if (!game.value.trim() || !loader.value) {
      return;
    }
    const chosen = createCompatibilityReport(report.mods, {
      ...localModControls?.target(),
      gameVersion: game.value.trim(),
      loader: loader.value as 'fabric' | 'forge' | 'neoforge' | 'quilt',
    });
    const filenames = [
      ...new Set(
        chosen.issues
          .filter((issue) =>
            ['unreadable', 'game-version-mismatch', 'loader-mismatch', 'conflict'].includes(
              issue.kind,
            ),
          )
          .map((issue) => issue.filename),
      ),
    ];
    const heading = document.createElement('p');
    setUiText(
      heading,
      filenames.length
        ? 'Se desactivarán estos archivos:'
        : 'No hay archivos incompatibles que desactivar para este destino.',
    );
    preview.append(heading);
    if (filenames.length) {
      const list = document.createElement('ul');
      for (const filename of filenames) {
        const item = document.createElement('li');
        setUserText(item, filename);
        list.append(item);
      }
      preview.append(list);
    }
  };
  form.querySelector('footer')?.before(preview);
  game.addEventListener('input', updatePreview);
  loader.addEventListener('change', updatePreview);
  updatePreview();
  form.querySelector('[data-repair-close]')?.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity() || localModsRepairBusy) {
      return;
    }
    localModsRepairBusy = true;
    game.disabled = true;
    loader.disabled = true;
    const close = form.querySelector<HTMLButtonElement>('[data-repair-close]')!;
    close.disabled = true;
    const status = form.querySelector<HTMLElement>('[data-repair-status]')!;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    status.replaceChildren(steveLoader('Aplicando soluciones…'));
    localModControls?.setTarget(game.value.trim(), loader.value);
    void window.battly
      .disableIncompatibleMods({
        ...localModControls?.target(),
        gameVersion: game.value.trim(),
        loader: loader.value as 'fabric' | 'forge' | 'neoforge' | 'quilt',
      })
      .then(async (result) => {
        await refreshLocalMods();
        renderModCompatibility(
          createCompatibilityReport(result.report.mods, localModControls?.target()),
        );
        const remaining = result.report.issues.filter(
          (issue) => issue.severity !== 'warning',
        ).length;
        const totals = document.createElement('span');
        const conclusion = document.createElement('span');
        setUiText(
          totals,
          `${result.disabled.length} desactivados · ${result.enabled?.length ?? 0} activados · ${result.installed?.length ?? 0} descargados. `,
        );
        setUiText(
          conclusion,
          remaining
            ? `${remaining} problemas pendientes: consulta el informe.`
            : 'No quedan errores detectados en los metadatos.',
        );
        status.replaceChildren(totals, conclusion);
        button.hidden = true;
        form.querySelector('[data-repair-close]')!.textContent = 'Cerrar';
      })
      .catch((error: unknown) => {
        status.textContent = userErrorMessage(error);
        button.disabled = false;
      })
      .finally(() => {
        localModsRepairBusy = false;
        game.disabled = false;
        loader.disabled = false;
        close.disabled = false;
      });
  });
  dialog.addEventListener('cancel', (event) => {
    if (localModsRepairBusy) {
      event.preventDefault();
    }
  });
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

async function analyzeLocalMods(): Promise<void> {
  if (localModsAnalysisBusy || localModsRepairBusy) {
    return;
  }
  localModsAnalysisBusy = true;
  const button = document.querySelector<HTMLButtonElement>('[data-local-mods-analyze]');
  const panel = document.querySelector<HTMLElement>('[data-mod-compatibility-report]');
  const summary = document.querySelector<HTMLElement>('[data-mod-compatibility-summary]');
  const context = document.querySelector<HTMLElement>('[data-mod-compatibility-context]');
  const issues = document.querySelector<HTMLElement>('[data-mod-compatibility-issues]');
  const fix = document.querySelector<HTMLButtonElement>('[data-mod-compatibility-fix]');
  const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
  const previous = button ? [...button.childNodes].map((node) => node.cloneNode(true)) : [];
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-analyzing');
    button.replaceChildren();
    const spinner = document.createElement('i');
    spinner.className = 'fa-solid fa-spinner fa-spin';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    setUiText(text, 'Analizando…');
    button.append(spinner, text);
  }
  if (panel) {
    panel.hidden = false;
    panel.setAttribute('aria-busy', 'true');
    panel.classList.add('is-analyzing');
  }
  if (fix) {
    fix.hidden = true;
  }
  if (summary) {
    setUiText(summary, 'Analizando metadatos de los mods…');
  }
  if (context) {
    context.textContent = '';
  }
  if (issues) {
    issues.replaceChildren(steveLoader('Analizando metadatos de los mods…'));
  }
  if (status) {
    status.textContent = '';
  }
  try {
    const [report] = await Promise.all([
      window.battly.analyzeLocalMods(),
      new Promise<void>((resolve) => setTimeout(resolve, 400)),
    ]);
    localModInspections = report.mods;
    renderModCompatibility(createCompatibilityReport(report.mods, localModControls?.target()));
  } catch {
    if (summary) {
      setUiText(summary, 'No se pudo completar el análisis de compatibilidad');
    }
    if (issues) {
      issues.replaceChildren();
    }
  } finally {
    localModsAnalysisBusy = false;
    panel?.removeAttribute('aria-busy');
    panel?.classList.remove('is-analyzing');
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      button.classList.remove('is-analyzing');
      button.replaceChildren(...previous);
    }
  }
}

function setInstallArtwork(
  container: Element | null,
  name: string,
  banner?: string | null,
  icon?: string | null,
): void {
  const hero = container?.querySelector<HTMLElement>('[data-install-artwork]');
  if (!hero) {
    return;
  }
  hero.querySelector<HTMLElement>('strong')!.textContent = name;
  const cover = hero.querySelector<HTMLImageElement>('[data-install-banner]')!;
  const logo = hero.querySelector<HTMLImageElement>('[data-install-icon]')!;
  cover.onerror = () => {
    cover.hidden = true;
  };
  cover.hidden = !banner;
  if (banner) {
    cover.src = banner;
  } else {
    cover.removeAttribute('src');
  }
  logo.onerror = () => {
    logo.onerror = null;
    logo.src = defaultMinecraftIconUrl;
  };
  logo.src = icon || defaultMinecraftIconUrl;
}

function openModpackInstallModal(name: string, project?: ModProjectSummary): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]');
  const status = document.querySelector<HTMLElement>('[data-modpack-install-status]');
  const progress = document.querySelector<HTMLProgressElement>('[data-modpack-install-progress]');
  const log = document.querySelector<HTMLTextAreaElement>('[data-modpack-install-log]');
  const item = document.querySelector<HTMLElement>('[data-modpack-install-item]');
  const percent = document.querySelector<HTMLElement>('[data-modpack-install-percent]');
  const close = document.querySelector<HTMLButtonElement>('[data-modpack-install-close]');
  setInstallArtwork(
    dialog,
    name,
    catalogImageUrl(project?.featuredGallery || project?.gallery?.[0] || '') ||
      instanceLoaderBanner(null),
    catalogImageUrl(project?.iconUrl ?? ''),
  );
  dialog?.removeAttribute('data-failed');
  const heading = document.querySelector<HTMLElement>('#modpack-install-title');
  if (heading) {
    heading.textContent = 'Instalando ModPack, esto puede tardar';
  }
  dialog?.querySelector('details')?.removeAttribute('open');
  if (progress) {
    progress.hidden = false;
  }
  lastModpackProgressLog = '';
  modpackProgressLines = [`Preparando ${name}`, 'Leyendo el manifiesto del ModPack...'];
  if (status) {
    status.textContent = 'Preparando instalación…';
  }
  if (item) {
    item.textContent = name;
  }
  if (percent) {
    percent.textContent = '0%';
  }
  if (progress) {
    progress.max = 100;
    progress.value = 0;
  }
  if (log) {
    log.value = modpackProgressLines.join('\n');
  }
  if (close) {
    close.hidden = true;
  }
  if (dialog && !dialog.open) {
    dialog.showModal();
  }
}

let lastModpackProgressLog = '';
let modpackProgressLines: string[] = [];

function modpackPhaseLabel(event: ModpackInstallProgress): string {
  const labels: Record<ModpackInstallProgress['phase'], string> = {
    reading: 'Leyendo ModPack…',
    'downloading-archive': 'Descargando ModPack…',
    extracting: 'Extrayendo archivos…',
    'downloading-files': 'Instalando mods…',
    writing: 'Guardando instancia…',
    complete: 'ModPack instalado',
  };
  return labels[event.phase];
}

function renderModpackInstallProgress(event: ModpackInstallProgress): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]');
  const status = document.querySelector<HTMLElement>('[data-modpack-install-status]');
  const progress = document.querySelector<HTMLProgressElement>('[data-modpack-install-progress]');
  const item = document.querySelector<HTMLElement>('[data-modpack-install-item]');
  const percent = document.querySelector<HTMLElement>('[data-modpack-install-percent]');
  const log = document.querySelector<HTMLTextAreaElement>('[data-modpack-install-log]');
  const close = document.querySelector<HTMLButtonElement>('[data-modpack-install-close]');
  if (dialog && !dialog.open) {
    openModpackInstallModal(event.item || 'ModPack');
  }
  if (event.pack) {
    setInstallArtwork(
      dialog,
      event.pack.name,
      event.pack.artwork?.coverUrl ||
        event.pack.artwork?.coverUrls?.[0] ||
        instanceLoaderBanner(event.pack.loader),
      event.pack.iconDataUrl || event.pack.artwork?.iconUrl,
    );
  }
  if (status) {
    status.textContent = modpackPhaseLabel(event);
  }
  if (item) {
    item.textContent = event.item;
    item.title = event.item;
  }
  const value = modpackInstallPercent(event);
  if (progress) {
    progress.max = 100;
    progress.value = value;
  }
  if (percent) {
    percent.textContent = `${Math.round(value)}%`;
  }
  if (close) {
    close.hidden = true;
  }
  const logKey = `${event.phase}|${event.item}|${value}`;
  if (log && logKey !== lastModpackProgressLog) {
    lastModpackProgressLog = logKey;
    modpackProgressLines.push(`[${value}%] ${event.message}`);
    modpackProgressLines = modpackProgressLines.slice(-120);
    log.value = modpackProgressLines.join('\n');
    log.scrollTop = log.scrollHeight;
  }
}

function finishModpackInstallModal(message: string, ok: boolean): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]');
  dialog?.toggleAttribute('data-failed', !ok);
  const heading = document.querySelector<HTMLElement>('#modpack-install-title');
  if (heading) {
    heading.textContent = ok ? 'Instalación completada' : 'Instalación interrumpida';
  }
  const status = document.querySelector<HTMLElement>('[data-modpack-install-status]');
  const progress = document.querySelector<HTMLProgressElement>('[data-modpack-install-progress]');
  const log = document.querySelector<HTMLTextAreaElement>('[data-modpack-install-log]');
  const close = document.querySelector<HTMLButtonElement>('[data-modpack-install-close]');
  if (status) {
    status.textContent = ok ? 'ModPack instalado correctamente' : 'No se pudo instalar el ModPack';
  }
  if (progress) {
    progress.max = 1;
    progress.value = ok ? 1 : 0;
  }
  const item = document.querySelector<HTMLElement>('[data-modpack-install-item]');
  const percent = document.querySelector<HTMLElement>('[data-modpack-install-percent]');
  if (item) {
    item.textContent = ok ? message : userErrorMessage(message);
  }
  if (progress) {
    progress.hidden = !ok;
  }
  if (percent) {
    percent.textContent = ok ? '100%' : 'Error';
  }
  if (log) {
    modpackProgressLines.push(ok ? 'Instalación completada' : `Error: ${message}`);
    modpackProgressLines = modpackProgressLines.slice(-120);
    log.value = modpackProgressLines.join('\n');
    log.scrollTop = log.scrollHeight;
  }
  if (close) {
    close.hidden = ok;
  }
  if (ok) {
    window.setTimeout(() => {
      document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]')?.close();
    }, 700);
  }
}

async function offerOpenInstalledModpack(instance: InstanceSummary): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 760));
  const accepted = await askBattly({
    title: 'ModPack instalado',
    text: `${instance.name} se ha instalado correctamente.\n\n¿Quieres iniciar el modpack ahora?`,
    confirmText: 'Sí, abrir',
    cancelText: 'No, gracias',
    danger: false,
  });
  if (!accepted) {
    return;
  }
  await activatePanel('home');
  const installed = await window.battly.getInstances().catch(() => []);
  startInstance(installed.find((candidate) => candidate.id === instance.id) || instance);
}

function bindMods(): void {
  modBasket.mount();
  let loaded = false;
  const modsPanel = document.querySelector<HTMLElement>('[data-panel-view="mods"]');
  if (modsPanel) {
    mountModVersionFilter(
      modsPanel,
      () => window.battly.getMinecraftVersionList(),
      () => {
        modsOffset = 0;
        searchMods();
      },
    );
  }
  const workspaceSession = tutorialSession();
  const ensureTutorialProject = async (): Promise<void> => {
    document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.close();
    const detail = document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]');
    if (!detail?.open) {
      document.querySelector<HTMLDialogElement>('[data-local-mods-dialog]')?.close();
      const first = await waitForTutorialElement(
        '[data-mod-grid] .b-mods-mod-item',
        modsPanel ?? document,
      );
      if (!first) {
        throw new Error('TUTORIAL_PROJECT_UNAVAILABLE');
      }
      first.click();
    }
    const deadline = performance.now() + 12000;
    while (
      detail?.open &&
      detail.getAttribute('aria-busy') === 'true' &&
      performance.now() < deadline
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  };
  const tutorialProjectTab = (tab: string) => async (): Promise<void> => {
    await ensureTutorialProject();
    selectModDetailTab(tab);
    document
      .querySelector<HTMLElement>('[data-mod-detail-panel="' + tab + '"]')
      ?.scrollTo({ top: 0 });
  };
  const ensureTutorialLocalMods = async (): Promise<void> => {
    document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]')?.close();
    document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.close();
    const local = document.querySelector<HTMLDialogElement>('[data-local-mods-dialog]');
    if (!local?.open) {
      modsPanel?.querySelector<HTMLButtonElement>('[data-local-mods-open]')?.click();
    }
    await waitForTutorialElement('.local-mods-toolbar', local ?? document);
  };
  const tutorial = modsPanel
    ? mountGuidedTutorial({
        id: 'mods',
        replayHost: '.friends-header-actions',
        label: 'Tutorial de Mods',
        promptTitle: '¿Primera vez en Mods?',
        promptText: 'Aprende a buscar, filtrar e instalar contenido.',
        root: modsPanel,
        storageKey: 'modsTutorialCompleted',
        onStart: workspaceSession.start,
        onFinish: workspaceSession.finish,
        helpSteps: [
          {
            id: 'toggle-local',
            selector: '[data-local-mod-toggle]',
            scope: 'document',
            title: 'Activar o desactivar un mod',
            text: 'El icono del ojo cambia el estado de este mod sin borrar el archivo. Revisa las dependencias que Battly te indique antes de confirmar.',
            onEnter: ensureTutorialLocalMods,
            unavailableText:
              'Todavía no hay mods en esta biblioteca. Cuando instales uno, verás el icono del ojo junto a su nombre.',
          },
          {
            id: 'basket-add',
            selector: '[data-mod-detail-dialog] .mod-basket-add',
            scope: 'document',
            title: 'Añadir a la cesta',
            text: 'Usa este botón para añadir o quitar el proyecto de la cesta. Puedes seguir buscando otros mods antes de elegir dónde instalarlos.',
            onEnter: tutorialProjectTab('description'),
            unavailableText:
              'No hay un proyecto disponible para abrir. Con conexión y resultados en Workspace podrás consultar su ficha.',
          },
        ],
        steps: [
          {
            title: 'Bienvenido al sistema de mods',
            text: 'Busca e instala mods, shaders, packs y datapacks desde Modrinth.',
          },
          {
            selector: '[data-mod-query]',
            title: 'Buscar contenido',
            text: 'Escribe el nombre del proyecto que quieres encontrar.',
          },
          {
            selector: '[data-mod-project-type]',
            title: 'Filtrar por contenido',
            text: 'Limita los resultados a mods, shaders, resource packs o datapacks.',
          },
          {
            selector: '[data-mod-loader]',
            title: 'Elegir loader',
            text: 'Selecciona Fabric, Forge, NeoForge o Quilt para obtener resultados compatibles.',
          },
          {
            selector: '.mod-version-popover',
            onEnter: () => {
              const picker = modsPanel?.querySelector<HTMLDetailsElement>('.mod-version-picker');
              if (picker) {
                picker.open = true;
              }
            },
            onLeave: () => {
              const picker = modsPanel?.querySelector<HTMLDetailsElement>('.mod-version-picker');
              if (picker) {
                picker.open = false;
              }
            },
            title: 'Versión de Minecraft',
            text: 'Indica la versión exacta que usará tu instancia.',
          },
          {
            selector: '[data-mod-sort]',
            title: 'Ordenar resultados',
            text: 'Prioriza relevancia, descargas, favoritos o proyectos recientes.',
          },
          {
            selector: '[data-mod-grid]',
            title: 'Abrir un proyecto',
            text: 'Pulsa un mod para consultar su descripción, capturas y versiones antes de instalarlo.',
          },
          {
            selector: '[data-mod-detail-panel="description"]',
            scope: 'document',
            title: 'La ficha del mod',
            text: 'Aquí puedes leer qué hace el mod y consultar las indicaciones de su autor.',
            onEnter: tutorialProjectTab('description'),
            unavailableText:
              'No hay un proyecto disponible para abrir. Con conexión y resultados en Workspace podrás consultar su ficha.',
          },
          {
            selector: '[data-mod-detail-panel="gallery"]',
            scope: 'document',
            title: 'Capturas del proyecto',
            text: 'La galería muestra las imágenes que haya publicado el autor. Algunos proyectos no incluyen capturas.',
            onEnter: tutorialProjectTab('gallery'),
          },
          {
            selector: '[data-mod-detail-panel="releases"]',
            scope: 'document',
            title: 'Versiones y cambios',
            text: 'Revisa las versiones publicadas y sus cambios antes de elegir cuál instalar.',
            onEnter: tutorialProjectTab('releases'),
          },
          {
            selector: '[data-mod-detail-panel="details"]',
            scope: 'document',
            title: 'Dependencias y enlaces',
            text: 'Consulta las dependencias, los autores, la licencia y los enlaces oficiales del proyecto.',
            onEnter: tutorialProjectTab('details'),
          },
          {
            selector: '[data-mod-detail-install]',
            scope: 'document',
            title: 'Elegir cómo instalarlo',
            text: 'Este botón abre la selección de destino, loader y versión. El tutorial no descargará ni instalará contenido.',
            onEnter: tutorialProjectTab('description'),
          },
          {
            selector: '[data-mod-download-destination-section]',
            scope: 'document',
            title: 'Destino de instalación',
            text: 'Elige una instalación normal, una instancia o un servidor compatible antes de confirmar la descarga.',
            onEnter: async () => {
              await ensureTutorialProject();
              if (activeModProject) {
                await openModDownloadDialog(activeModProject);
              }
            },
          },
          {
            selector: '[data-mod-download-loaders]',
            scope: 'document',
            title: 'Loader y Minecraft',
            text: 'Comprueba el loader y la versión de Minecraft. Battly utiliza estos datos para buscar ediciones compatibles.',
            onEnter: async () => {
              if (
                !document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.open &&
                activeModProject
              ) {
                await openModDownloadDialog(activeModProject);
              }
            },
          },
          {
            selector: '.local-mods-toolbar',
            scope: 'document',
            title: 'Tus mods locales',
            text: 'Busca entre tus archivos instalados y filtra por estado o loader. Puedes activarlos o desactivarlos sin borrar sus archivos.',
            onEnter: ensureTutorialLocalMods,
          },
          {
            selector: '[data-mod-compatibility-report]',
            scope: 'document',
            title: 'Comprobar compatibilidad',
            text: 'El análisis agrupa los problemas por mod y propone qué revisar. Las copias duplicadas se eligen una a una.',
            onEnter: async () => {
              await ensureTutorialLocalMods();
              await analyzeLocalMods();
            },
          },
          {
            selector: '.mod-basket-modal .mod-basket-body',
            scope: 'document',
            title: 'Cesta de mods',
            text: 'Añade proyectos a la cesta para preparar varios juntos. Podrás elegir el destino y revisar su compatibilidad antes de instalar.',
            onEnter: async () => {
              document.querySelector<HTMLDialogElement>('[data-local-mods-dialog]')?.close();
              document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]')?.close();
              document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]')?.close();
              await modBasket.open();
            },
            onLeave: () => document.querySelector<HTMLDialogElement>('.mod-basket-modal')?.close(),
          },
          {
            title: 'Todo listo',
            text: 'Ya puedes explorar el catálogo, revisar cada proyecto y gestionar tus mods instalados.',
            onEnter: workspaceSession.finish,
          },
        ],
      })
    : null;
  const dropHint = document.querySelector<HTMLElement>('[data-mrpack-drop-hint]');
  const showMrpackResult = (message: string): void => {
    const status = document.querySelector<HTMLElement>('[data-mod-status]');
    if (status) {
      status.textContent = message;
    }
  };
  window.battly.onModpackInstallProgress(renderModpackInstallProgress);
  window.addEventListener('offline', () => {
    modsNetworkOnline = false;
    modsSearchGeneration += 1;
    const message = 'Sin conexión. Tus mods locales siguen disponibles desde «Mis mods».';
    renderModsMessageState('offline', 'Estás sin conexión', message);
    const status = document.querySelector<HTMLElement>('[data-mod-status]');
    if (status) {
      status.textContent = message;
    }
  });
  window.addEventListener('online', () => {
    modsNetworkOnline = true;
    if (!modsPanel?.hidden) {
      searchMods();
    }
  });
  const importDroppedMrpack = (file: File): void => {
    if (/\.bypack$/i.test(file.name)) {
      showBypackImport(file);
      return;
    }
    showMrpackResult(`Instalando ${file.name}…`);
    openModpackInstallModal(file.name);
    void window.battly
      .importDroppedMrpack(file)
      .then((instance) => {
        if (!instance) {
          document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]')?.close();
          return;
        }
        showMrpackResult(`${instance.name} instalado`);
        finishModpackInstallModal(`${instance.name} instalado`, true);
        void offerOpenInstalledModpack(instance);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'No se pudo instalar el archivo';
        showMrpackResult(userErrorMessage(message));
        finishModpackInstallModal(message, false);
      });
  };
  modsPanel?.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dropHint?.classList.add('is-dragging');
  });
  modsPanel?.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  modsPanel?.addEventListener('dragleave', (event) => {
    if (!modsPanel.contains(event.relatedTarget as Node | null)) {
      dropHint?.classList.remove('is-dragging');
    }
  });
  modsPanel?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropHint?.classList.remove('is-dragging');
    const files = [...(event.dataTransfer?.files ?? [])];
    const modpack = files.find((file) => /\.(?:bypack|mrpack|zip)$/i.test(file.name));
    if (modpack) {
      importDroppedMrpack(modpack);
    } else {
      showMrpackResult('Suelta un .bypack, .mrpack o .zip de CurseForge válido');
    }
  });
  window.battly.onMrpackImportEvent((event) => {
    void activatePanel('mods', false);
    showMrpackResult(event.ok ? `${event.instance.name} instalado` : event.message);
    openModpackInstallModal(event.ok ? event.instance.name : 'ModPack externo');
    finishModpackInstallModal(
      event.ok ? `${event.instance.name} instalado` : event.message,
      event.ok,
    );
    if (event.ok) {
      void offerOpenInstalledModpack(event.instance);
    }
  });
  modsPanel?.addEventListener('battly:panel-enter', () => {
    if (!loaded) {
      loaded = true;
      searchMods();
    }
    window.setTimeout(() => tutorial?.offer(), 900);
  });
  document
    .querySelector<HTMLInputElement>('[data-mod-query]')
    ?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      modsOffset = 0;
      searchMods();
    });
  document
    .querySelector<HTMLButtonElement>('[data-mod-search-submit]')
    ?.addEventListener('click', () => {
      modsOffset = 0;
      searchMods();
    });
  document
    .querySelectorAll<HTMLSelectElement>(
      '[data-mod-sort], [data-mod-loader], [data-mod-project-type], [data-mod-provider], [data-mod-category]',
    )
    .forEach((select) =>
      select.addEventListener('change', () => {
        modsOffset = 0;
        searchMods();
      }),
    );
  document.querySelectorAll<HTMLInputElement>('[data-mod-game-version]').forEach((checkbox) =>
    checkbox.addEventListener('change', () => {
      modsOffset = 0;
      searchMods();
    }),
  );
  document.querySelector<HTMLButtonElement>('[data-mod-reset]')?.addEventListener('click', () => {
    resetModsControls();
    modsOffset = 0;
    searchMods();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-mod-page]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.modPage === 'previous') {
        modsOffset = Math.max(0, modsOffset - modsPageSize);
      } else if (modsOffset + modsPageSize < modsTotal) {
        modsOffset += modsPageSize;
      }
      searchMods();
    });
  });
  document.querySelector<HTMLButtonElement>('[data-mod-go-page]')?.addEventListener('click', () => {
    const page = Number(
      document.querySelector<HTMLInputElement>('[data-mod-go-page-input]')?.value ?? '',
    );
    const totalPages = Math.max(1, Math.ceil(modsTotal / modsPageSize));
    if (!Number.isInteger(page) || page < 1 || page > totalPages) {
      return;
    }
    modsOffset = (page - 1) * modsPageSize;
    searchMods();
  });
  const localDialog = document.querySelector<HTMLDialogElement>('[data-local-mods-dialog]');
  const detailDialog = document.querySelector<HTMLDialogElement>('[data-mod-detail-dialog]');
  document
    .querySelector<HTMLButtonElement>('[data-mod-detail-close]')
    ?.addEventListener('click', () => detailDialog?.close());
  document
    .querySelector<HTMLButtonElement>('[data-mod-detail-install]')
    ?.addEventListener('click', () => {
      if (!activeModProject) {
        return;
      }
      void openModDownloadDialog(activeModProject);
    });
  document
    .querySelector<HTMLButtonElement>('[data-mod-detail-info]')
    ?.addEventListener('click', () => {
      if (activeModProject) {
        void window.battly.openModrinthProject(activeModProject.id, activeModProject.projectType);
      }
    });
  document.querySelectorAll<HTMLButtonElement>('[data-mod-detail-tab]').forEach((button) => {
    button.addEventListener('click', () =>
      selectModDetailTab(button.dataset.modDetailTab ?? 'description'),
    );
  });
  const downloadDialog = document.querySelector<HTMLDialogElement>('[data-mod-download-dialog]');
  document
    .querySelector<HTMLButtonElement>('[data-mod-download-cancel]')
    ?.addEventListener('click', () => downloadDialog?.close());
  document
    .querySelector<HTMLButtonElement>('[data-mod-download-confirm]')
    ?.addEventListener('click', (event) => {
      if (!activeModProject) {
        return;
      }
      const gameVersion = document.querySelector<HTMLSelectElement>(
        '[data-mod-download-game]',
      )?.value;
      const loader = document.querySelector<HTMLInputElement>(
        '[data-mod-download-loaders] input:checked',
      )?.value;
      const versionId = document.querySelector<HTMLSelectElement>(
        '[data-mod-download-version]',
      )?.value;
      const destinationInstanceId = document.querySelector<HTMLSelectElement>(
        '[data-mod-download-destination]',
      )?.value;
      const destinationWorld =
        activeModProject.projectType === 'datapack'
          ? document.querySelector<HTMLSelectElement>('[data-mod-download-world]')?.value
          : undefined;
      if (
        !gameVersion ||
        !loader ||
        !versionId ||
        (activeModProject.projectType === 'datapack' && !destinationWorld)
      ) {
        return;
      }
      const button = event.currentTarget as HTMLButtonElement;
      installModProject(activeModProject, button, {
        projectId: activeModProject.id,
        projectType: activeModProject.projectType,
        gameVersion,
        loader,
        versionId,
        ...(destinationWorld ? { destinationWorld } : {}),
        ...(destinationInstanceId?.startsWith('server:')
          ? { destinationServerId: destinationInstanceId.slice(7) }
          : destinationInstanceId
            ? { destinationInstanceId }
            : {}),
      });
    });
  document
    .querySelector<HTMLButtonElement>('[data-local-mods-open]')
    ?.addEventListener('click', () => {
      localDialog?.showModal();
      void refreshLocalMods().catch(() => {
        const status = document.querySelector<HTMLElement>('[data-local-mods-status]');
        if (status) {
          setUiText(status, 'No se pudieron cargar los mods instalados');
        }
      });
    });
  document
    .querySelector<HTMLButtonElement>('[data-local-mods-close]')
    ?.addEventListener('click', () => localDialog?.close());
  document
    .querySelector<HTMLButtonElement>('[data-local-mods-folder]')
    ?.addEventListener('click', () => void window.battly.openModsFolder());
  document
    .querySelector<HTMLButtonElement>('[data-local-mods-analyze]')
    ?.addEventListener('click', () => {
      void analyzeLocalMods();
    });
  document
    .querySelector<HTMLButtonElement>('[data-mrpack-import]')
    ?.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>('[data-mod-status]');
      void window.battly
        .importMrpack()
        .then((instance) => {
          if (status) {
            status.textContent = instance ? `${instance.name} instalado` : 'Instalación cancelada';
          }
          if (instance) {
            finishModpackInstallModal(`${instance.name} instalado`, true);
            void offerOpenInstalledModpack(instance);
          } else {
            document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]')?.close();
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'No se pudo instalar el ModPack';
          openModpackInstallModal('ModPack');
          if (status) {
            status.textContent = userErrorMessage(message);
          }
          finishModpackInstallModal(message, false);
        });
    });
  document
    .querySelector<HTMLButtonElement>('[data-modpack-install-close]')
    ?.addEventListener('click', () =>
      document.querySelector<HTMLDialogElement>('[data-modpack-install-dialog]')?.close(),
    );
}

let socialSnapshot: SocialSnapshot = { friends: [], receivedRequests: [], sentRequests: [] };
let socialRealtimeState: SocialRealtimeState = 'disconnected';
type SocialScope = 'all' | 'favorites' | 'offline' | 'online' | 'playing';
type SocialSort = 'name' | 'recent' | 'status';
const socialFavoritesStorageKey = 'battly_favorite_friends';
let socialScope: SocialScope = 'all';
let socialSort: SocialSort = 'status';
let socialContextFriend: SocialFriend | null = null;

function readSocialFavorites(): Set<string> {
  try {
    const value = JSON.parse(privateStorage.getItem(socialFavoritesStorageKey) ?? '[]') as unknown;
    if (!Array.isArray(value)) {
      return new Set();
    }
    return new Set(
      value
        .slice(0, 500)
        .filter(
          (username): username is string =>
            typeof username === 'string' && /^[A-Za-z0-9_.+-]{1,64}$/.test(username),
        ),
    );
  } catch {
    return new Set();
  }
}

const socialFavorites = readSocialFavorites();

function toggleSocialFavorite(username: string): void {
  if (socialFavorites.has(username)) {
    socialFavorites.delete(username);
  } else {
    socialFavorites.add(username);
  }
  privateStorage.setItem(socialFavoritesStorageKey, JSON.stringify([...socialFavorites]));
  renderSocial(socialSnapshot);
}

function socialActionButton(
  label: string,
  action: SocialAction,
  username: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button is-small';
  button.textContent = label;
  button.addEventListener('click', () => {
    if (button.disabled) {
      return;
    }
    const actions = button.closest('.legacy-friends-request-actions');
    const buttons = actions ? [...actions.querySelectorAll<HTMLButtonElement>('button')] : [button];
    const disabledBefore = buttons.map((item) => item.disabled);
    buttons.forEach((item) => {
      item.disabled = true;
    });
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    void window.battly
      .socialAction(action, username)
      .then(renderSocial)
      .catch(() => {
        const status = document.querySelector<HTMLElement>('[data-social-status]');
        if (status) {
          status.textContent = 'No se pudo completar la acción';
        }
      })
      .finally(() => {
        buttons.forEach((item, index) => {
          item.disabled = disabledBefore[index];
        });
        button.classList.remove('is-loading');
        button.removeAttribute('aria-busy');
      });
  });
  return button;
}

let socialJoinPending = false;
function joinSocialFriend(friend: SocialFriend): void {
  if (document.body.dataset.panel === 'login' || socialJoinPending || showActiveMinecraftNotice()) {
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-social-status]');
  const server = friend.server;
  if (friend.status !== 'online' || !server) {
    if (status) {
      status.textContent = 'Este amigo no comparte un servidor al que puedas unirte';
    }
    return;
  }
  const version = friend.gameVersion || friend.activity;
  if (!parseWorldsVersion(version)) {
    void openPlaySelector(server);
    return;
  }
  socialJoinPending = true;
  const accountKey = realtimeAccountKey;
  const isCurrent = (): boolean =>
    accountKey === realtimeAccountKey && document.body.dataset.panel !== 'login';
  void prepareWorldsPlayRequest(window.battly, version, '', isCurrent, (message) => {
    if (status) {
      status.textContent = message;
    }
  })
    .then((request) => {
      if (!isCurrent() || showActiveMinecraftNotice()) {
        return;
      }
      startPlayVersion({ ...request, directConnect: server }, version);
    })
    .catch((error) => {
      if (status && isCurrent()) {
        status.textContent =
          error instanceof Error ? error.message : 'No se pudo completar la acción';
      }
    })
    .finally(() => {
      socialJoinPending = false;
    });
}

const socialProfileCache = new Map<string, SocialProfile>();
const socialProfileInFlight = new Map<string, Promise<SocialProfile>>();
const socialProfileQueue: Array<{
  readonly userId: string;
  readonly resolve: (profile: SocialProfile) => void;
  readonly reject: (error: unknown) => void;
}> = [];
let activeSocialProfileRequests = 0;
const maximumConcurrentSocialProfiles = 6;

function pumpSocialProfileQueue(): void {
  while (
    activeSocialProfileRequests < maximumConcurrentSocialProfiles &&
    socialProfileQueue.length
  ) {
    const pending = socialProfileQueue.shift();
    if (!pending) {
      return;
    }
    activeSocialProfileRequests += 1;
    void window.battly
      .getSocialProfile(pending.userId)
      .then((profile) => {
        socialProfileCache.set(pending.userId, profile);
        pending.resolve(profile);
      })
      .catch(pending.reject)
      .finally(() => {
        activeSocialProfileRequests -= 1;
        socialProfileInFlight.delete(pending.userId);
        pumpSocialProfileQueue();
      });
  }
}

function requestSocialProfile(userId: string): Promise<SocialProfile> {
  const cached = socialProfileCache.get(userId);
  if (cached) {
    return Promise.resolve(cached);
  }
  const running = socialProfileInFlight.get(userId);
  if (running) {
    return running;
  }
  const request = new Promise<SocialProfile>((resolve, reject) => {
    socialProfileQueue.push({ userId, resolve, reject });
    pumpSocialProfileQueue();
  });
  socialProfileInFlight.set(userId, request);
  return request;
}

function applySocialProfileCosmetics(container: HTMLElement, profile: SocialProfile): void {
  const customization = profile.customization;
  container.style.border = `${customization.borderWidth}px ${customization.borderStyle} ${customization.borderColor}`;
  container.style.backgroundColor = customization.backgroundColor;
  container.style.backgroundImage = profile.backgroundImageUrl
    ? `linear-gradient(rgb(5 9 15 / 72%), rgb(5 9 15 / 72%)), url(${JSON.stringify(profile.backgroundImageUrl)})`
    : '';
  container.style.backgroundSize = 'cover';
  container.style.backgroundPosition = 'center';
  const avatar = container.querySelector<HTMLElement>('.social-avatar, [data-social-profile-skin]');
  if (avatar) {
    if (profile.skinUrl) {
      avatar.style.backgroundImage = `url(${JSON.stringify(profile.skinUrl)})`;
    }
  }
  const name = container.querySelector<HTMLElement>(
    '.friend-name-text, strong, [data-social-profile-name]',
  );
  if (name) {
    name.style.color = customization.nameColor;
    name.style.textShadow = `0 0 10px ${customization.nameColor}55`;
  }
}

function loadSocialProfileCosmetics(userId: string, card: HTMLElement): void {
  void requestSocialProfile(userId)
    .then((profile) => {
      if (card.isConnected) {
        applySocialProfileCosmetics(card, profile);
      }
    })
    .catch(() => undefined);
}

function renderSocialFriend(friend: SocialFriend): HTMLElement {
  const card = document.createElement('div');
  card.className = 'friend-card';
  card.dataset.username = friend.username;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Ver perfil de ${friend.username}`);
  const isFavorite = socialFavorites.has(friend.username);
  if (isFavorite) {
    const badge = document.createElement('div');
    badge.className = 'friend-favorite-badge';
    badge.innerHTML = '<i class="fa-solid fa-star" aria-hidden="true"></i>';
    card.append(badge);
  }
  const header = document.createElement('div');
  header.className = 'friend-card-header';
  const avatarContainer = document.createElement('div');
  avatarContainer.className = 'friend-avatar-container';
  const avatar = document.createElement('div');
  avatar.className = 'friend-avatar mc-face-viewer-8x';
  avatar.style.backgroundImage = `url(${JSON.stringify(
    window.battly.skinImageUrl(friend.username),
  )})`;
  const presence = document.createElement('span');
  presence.className = `social-presence friend-status-indicator ${friend.status}`;
  avatarContainer.append(avatar, presence);
  const copy = document.createElement('div');
  copy.className = 'friend-info';
  const name = document.createElement('h3');
  name.className = 'friend-name';
  const nameText = document.createElement('span');
  nameText.className = 'friend-name-text';
  setUserText(nameText, friend.username);
  name.append(nameText);
  const activity = document.createElement('p');
  activity.className = 'friend-status-text';
  renderFriendActivity(
    activity,
    friend.status === 'offline' ? 'Offline' : friend.activity || 'En el menú principal',
  );
  copy.append(name, activity);
  const actions = document.createElement('div');
  actions.className = 'friend-card-actions';
  const profile = document.createElement('button');
  profile.type = 'button';
  profile.className = 'friend-action-btn';
  profile.dataset.socialProfileOpen = friend.userId;
  profile.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i><span>Perfil</span>';
  profile.addEventListener('click', (event) => {
    event.stopPropagation();
    showSocialProfile(friend.userId);
  });
  actions.append(profile);
  if (friend.status === 'online' && friend.server) {
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'friend-action-btn';
    join.innerHTML =
      '<i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i><span>Unirse</span>';
    join.setAttribute('aria-label', `Unirse a la partida de ${friend.username}`);
    join.addEventListener('click', (event) => {
      event.stopPropagation();
      joinSocialFriend(friend);
    });
    actions.append(join);
  }
  header.append(avatarContainer, copy);
  card.append(header, actions);
  card.addEventListener('click', () => showSocialProfile(friend.userId));
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    socialContextFriend = friend;
    const menu = document.querySelector<HTMLElement>('#friend-context-menu');
    if (!menu) {
      return;
    }
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - 330)}px`;
    menu.style.display = 'block';
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showSocialProfile(friend.userId);
    }
  });
  loadSocialProfileCosmetics(friend.userId, card);
  return card;
}

let socialProfileSkinViewer: SkinViewer | null = null;
let activeSocialProfile: SocialProfile | null = null;
let socialProfileDialogRequest = 0;

function renderSocialProfileSkin(canvas: HTMLCanvasElement, source: string): void {
  socialProfileSkinViewer?.dispose();
  socialProfileSkinViewer = new SkinViewer({
    canvas,
    width: 250,
    height: 500,
    skin: source,
  });
  socialProfileSkinViewer.animation = new WalkingAnimation();
  socialProfileSkinViewer.playerObject.rotateY(0.3);
  socialProfileSkinViewer.zoom = 0.8;
}

function updateSocialProfilePresence(): void {
  const presence = document.querySelector<HTMLElement>('[data-social-profile-presence]');
  if (!presence || !activeSocialProfile) {
    return;
  }
  const profile = activeSocialProfile;
  const friend = socialSnapshot.friends.find(
    (item) =>
      item.userId === profile.userId ||
      item.username.toLowerCase() === profile.username.toLowerCase(),
  );
  presence.dataset.state = friend?.status ?? 'unknown';
  if (!friend) {
    const selected = profileAccounts.find((account) => account.selected);
    const identity =
      profileAccounts.find(
        (account) => account.type === 'battly' && account.uuid === selected?.uuid,
      ) ??
      profileAccounts.find(
        (account) => account.type === 'battly' && account.name === selected?.name,
      ) ??
      profileAccounts.find((account) => account.type === 'battly');
    const ownAccount =
      identity?.name.toLowerCase() === profile.username.toLowerCase() &&
      socialRealtimeState === 'connected';
    presence.dataset.state = ownAccount ? 'online' : 'unknown';
    presence.textContent = ownAccount ? 'En Battly' : 'Estado no disponible';
  } else if (friend.status === 'offline') {
    presence.textContent = 'Desconectado';
  } else {
    renderFriendActivity(presence, friend.activity || friend.client || 'En Battly');
  }
}

function renderSocialProfileDialog(profile: SocialProfile): void {
  activeSocialProfile = profile;
  const dialog = document.querySelector<HTMLElement>('[data-social-profile-dialog]');
  if (!dialog) {
    return;
  }
  const name = dialog.querySelector<HTMLElement>('[data-social-profile-name]');
  const bio = dialog.querySelector<HTMLElement>('[data-social-profile-bio]');
  const skin = dialog.querySelector<HTMLCanvasElement>('[data-social-profile-skin]');
  const profileUserId = dialog.querySelector<HTMLElement>('[data-social-profile-user-id]');
  const createdAt = dialog.querySelector<HTMLElement>('[data-social-profile-created-at]');
  if (name) {
    setUserText(name, profile.username);
    name.title = profile.username;
  }
  updateSocialProfilePresence();
  const chat = dialog.querySelector<HTMLButtonElement>('[data-social-profile-chat]');
  if (chat) {
    chat.disabled = false;
    chat.hidden = true;
  }
  if (bio) {
    if (profile.bio) {
      setUserText(bio, profile.bio);
    } else {
      bio.removeAttribute('translate');
      setUiText(bio, 'Este usuario no ha establecido una biografía.');
    }
    bio.title = profile.bio || '';
  }
  if (skin) {
    skin.hidden = false;
    skin.setAttribute('aria-label', `Skin de ${profile.username}`);
    renderSocialProfileSkin(skin, profile.skinUrl ?? battlyIconUrl);
  }
  if (profileUserId) {
    profileUserId.textContent =
      profile.uuid ??
      profileAccounts.find(
        (account) =>
          account.type === 'battly' &&
          account.name.toLowerCase() === profile.username.toLowerCase(),
      )?.uuid ??
      'No disponible';
  }
  if (createdAt) {
    const date = profile.createdAt ? new Date(profile.createdAt) : null;
    createdAt.textContent =
      date && !Number.isNaN(date.valueOf())
        ? `${date.toLocaleDateString(uiLocale())} a las ${date.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })}`
        : 'Desconocida';
  }
  const hero = dialog.querySelector<HTMLElement>('.main-user-profile');
  if (hero) {
    hero.style.backgroundColor = profile.customization.backgroundColor;
    hero.style.backgroundImage = profile.backgroundImageUrl
      ? `linear-gradient(rgb(5 9 15 / 48%), rgb(5 9 15 / 72%)), url(${JSON.stringify(profile.backgroundImageUrl)})`
      : '';
    hero.style.backgroundPosition = 'center';
    hero.style.backgroundSize = 'cover';
  }
  if (name) {
    name.style.color = profile.customization.nameColor;
    name.style.textShadow = `0 0 10px ${profile.customization.nameColor}55`;
  }
  const card = dialog.querySelector<HTMLElement>('.social-modal-card');
  if (card) {
    card.style.border = `${profile.customization.borderWidth}px ${profile.customization.borderStyle} ${profile.customization.borderColor}`;
  }
}

function showSocialProfile(userId: string): void {
  const request = ++socialProfileDialogRequest;
  const dialog = document.querySelector<HTMLDialogElement>('[data-social-profile-dialog]');
  if (!dialog) {
    return;
  }
  const name = dialog?.querySelector<HTMLElement>('[data-social-profile-name]');
  dialog?.showModal();
  activeSocialProfile = null;
  socialProfileSkinViewer?.dispose();
  socialProfileSkinViewer = null;
  const skin = dialog.querySelector<HTMLElement>('[data-social-profile-skin]');
  if (skin) {
    skin.hidden = true;
  }
  dialog.querySelector<HTMLElement>('.main-user-profile')?.removeAttribute('style');
  dialog.querySelector<HTMLElement>('.social-modal-card')?.removeAttribute('style');
  name?.removeAttribute('style');
  if (name) {
    name.textContent = 'Cargando perfil…';
  }
  dialog
    ?.querySelectorAll<HTMLElement>(
      '[data-social-profile-bio], [data-social-profile-presence], [data-social-profile-user-id], [data-social-profile-created-at]',
    )
    .forEach((element) => {
      element.textContent = '';
    });
  const chat = dialog?.querySelector<HTMLButtonElement>('[data-social-profile-chat]');
  if (chat) {
    chat.disabled = true;
  }
  void requestSocialProfile(userId)
    .then((profile) => {
      if (request === socialProfileDialogRequest && dialog.open) {
        renderSocialProfileDialog(profile);
      }
    })
    .catch(() => {
      if (request !== socialProfileDialogRequest || !dialog.open) {
        return;
      }
      if (name) {
        name.textContent = 'No se pudo cargar el perfil';
      }
    });
}

let activeConversation: ChatConversation | undefined;
let chatConversations: ChatConversation[] = [];
let chatListRequest = 0;
let chatMessageRequest = 0;
let chatSelection = 0;
let chatRefreshTimer: number | undefined;
let chatSkinCleanup: (() => void) | undefined;
let chatRenderedSignature = '';
const chatAccountUsername = '';
const chatDrafts = new Map<string, string>();
interface PresentedChatMessage {
  readonly item: ChatMessage;
  state: ChatDeliveryState;
}
interface LocalChatMessage extends PresentedChatMessage {
  readonly knownServerIds: ReadonlySet<string>;
  confirmedServerId?: string;
}
const localChatMessages = new Map<string, LocalChatMessage[]>();
const knownChatMessageIds = new Map<string, Set<string>>();
const confirmedChatMessageIds = new Map<string, Set<string>>();
const serverChatMessages = new Map<string, readonly ChatMessage[]>();
const recoveredChatDrafts = new Map<string, string>();

function currentChatUsername(): string {
  return document.querySelector<HTMLElement>('[data-current-username]')?.textContent?.trim() ?? '';
}

function isOwnChatMessage(author: string): boolean {
  const selectedUsername = currentChatUsername();
  return (
    Boolean(selectedUsername) &&
    author.localeCompare(selectedUsername, undefined, { sensitivity: 'accent' }) === 0
  );
}

function chatDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>('[data-social-chat-dialog]');
}

function updateChatConnection(): void {
  const indicator = document.querySelector<HTMLElement>('[data-social-chat-connection]');
  if (!indicator) {
    return;
  }
  const labels: Record<SocialRealtimeState, string> = {
    connected: 'Conectado',
    connecting: 'Conectando…',
    disconnected: 'Sin conexión',
    error: 'Error de conexión',
    reconnecting: 'Reconectando…',
  };
  indicator.dataset.state = socialRealtimeState;
  indicator.textContent = labels[socialRealtimeState];
}

function updateChatPresence(): void {
  if (!activeConversation) {
    return;
  }
  const conversation = activeConversation;
  const friend = socialSnapshot.friends.find(
    (candidate) =>
      candidate.userId === conversation.recipientId ||
      candidate.username.toLowerCase() === conversation.username.toLowerCase(),
  );
  document
    .querySelectorAll<HTMLElement>(
      '[data-social-chat-presence], [data-social-chat-profile-presence]',
    )
    .forEach((presence) => {
      presence.dataset.state = friend?.status ?? 'unknown';
      if (!friend) {
        presence.textContent = 'Estado no disponible';
      } else if (friend.status === 'offline') {
        presence.textContent = 'Desconectado';
      } else {
        renderFriendActivity(presence, friend.activity || 'En línea');
      }
    });
}

function updateChatComposer(): void {
  const composer = document.querySelector<HTMLTextAreaElement>(
    '[data-social-message-form] textarea[name="content"]',
  );
  if (!composer) {
    return;
  }
  const limit = composer.maxLength > 0 ? composer.maxLength : 2_000;
  const send = document.querySelector<HTMLButtonElement>('[data-social-chat-send]');
  if (send) {
    send.disabled =
      !activeConversation ||
      !knownChatMessageIds.has(activeConversation.recipientId) ||
      !composer.value.trim() ||
      composer.value.length > limit;
  }
  const counter = document.querySelector<HTMLElement>('[data-social-chat-char-count]');
  if (counter) {
    counter.textContent = `${composer.value.length} / ${limit}`;
  }
  const maximumHeight = Number.parseFloat(getComputedStyle(composer).maxHeight) || 112;
  composer.style.height = 'auto';
  composer.style.height = `${Math.min(maximumHeight, Math.max(24, composer.scrollHeight))}px`;
  composer.style.overflowY = composer.scrollHeight > maximumHeight ? 'auto' : 'hidden';
}

function saveChatDraft(): void {
  const composer = document.querySelector<HTMLTextAreaElement>(
    '[data-social-message-form] textarea[name="content"]',
  );
  if (!activeConversation || !composer) {
    return;
  }
  if (composer.value) {
    chatDrafts.set(activeConversation.recipientId, composer.value);
  } else {
    chatDrafts.delete(activeConversation.recipientId);
  }
}

function filterChatConversations(): void {
  const query =
    document
      .querySelector<HTMLInputElement>('[data-social-chat-filter]')
      ?.value.trim()
      .toLocaleLowerCase() ?? '';
  let visible = 0;
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '[data-social-conversations] button[data-conversation-id]',
  );
  buttons.forEach((button) => {
    button.hidden = !(button.dataset.search ?? '').includes(query);
    if (!button.hidden) {
      visible += 1;
    }
  });
  const empty = document.querySelector<HTMLElement>('[data-social-chat-no-results]');
  if (empty) {
    empty.hidden = !query || !buttons.length || visible > 0;
  }
}

function renderChatConversations(): void {
  const list = document.querySelector<HTMLElement>('[data-social-conversations]');
  if (!list) {
    return;
  }
  const focusedId = list.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.conversationId
    : undefined;
  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  delete list.dataset.empty;
  for (const conversation of chatConversations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.conversationId = conversation.id;
    button.dataset.search = conversation.username.toLocaleLowerCase();
    const active = conversation.recipientId === activeConversation?.recipientId;
    button.classList.toggle('is-active', active);
    if (active) {
      button.setAttribute('aria-current', 'true');
    }
    button.setAttribute(
      'aria-label',
      `${conversation.username}${conversation.unread ? ` (${conversation.unread} sin leer)` : ''}`,
    );
    const avatar = document.createElement('img');
    avatar.src = window.battly.faceImageUrl(conversation.username);
    avatar.alt = '';
    avatar.width = 42;
    avatar.height = 42;
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    setUserText(name, conversation.username);
    const preview = document.createElement('small');
    setUserText(preview, conversation.lastMessage, 'Inicia la conversación');
    copy.append(name, preview);
    button.append(avatar, copy);
    if (conversation.unread) {
      const unread = document.createElement('b');
      setUserText(unread, conversation.unread > 99 ? '99+' : String(conversation.unread));
      button.append(unread);
    }
    button.addEventListener('click', () => openConversation(conversation));
    list.append(button);
  }
  if (!chatConversations.length) {
    renderChatEmpty(
      list,
      'empty',
      'Tu próxima partida empieza aquí',
      'Pulsa + para hablar con un amigo.',
    );
  }
  const count = document.querySelector<HTMLElement>('[data-social-chat-count]');
  if (count) {
    count.textContent = String(chatConversations.length);
  }
  filterChatConversations();
  if (focusedId) {
    list
      .querySelector<HTMLButtonElement>(`button[data-conversation-id="${CSS.escape(focusedId)}"]`)
      ?.focus({ preventScroll: true });
  }
}

function selectNewConversation(userId: string, username: string): void {
  const existing = chatConversations.find((item) => item.recipientId === userId);
  const conversation = existing ?? {
    id: userId,
    recipientId: userId,
    username,
    lastMessage: '',
    unread: 0,
  };
  if (!existing) {
    chatConversations.unshift(conversation);
  }
  openConversation(conversation);
  if (!knownChatMessageIds.has(conversation.recipientId)) {
    scheduleChatRefresh();
  }
  const picker = document.querySelector<HTMLElement>('[data-social-new-chat]');
  if (picker) {
    picker.hidden = true;
  }
  document.querySelector('[data-social-new-chat-toggle]')?.setAttribute('aria-expanded', 'false');
}

function renderNewChatFriends(): void {
  const list = document.querySelector<HTMLElement>('[data-social-new-chat-friends]');
  if (!list) {
    return;
  }
  list.replaceChildren();
  for (const friend of socialSnapshot.friends) {
    const button = document.createElement('button');
    button.type = 'button';
    const avatar = document.createElement('img');
    avatar.src = window.battly.faceImageUrl(friend.username);
    avatar.alt = '';
    const name = document.createElement('span');
    setUserText(name, friend.username);
    button.append(avatar, name);
    button.addEventListener('click', () => selectNewConversation(friend.userId, friend.username));
    list.append(button);
  }
  if (!list.childElementCount) {
    renderChatEmpty(
      list,
      'empty',
      'Todavía no hay amigos',
      'Añade amigos en Battly Social para empezar un chat.',
    );
  }
}

function appendChatMessage(
  messages: HTMLElement,
  item: ChatMessage,
  state: ChatDeliveryState = 'sent',
  follow = false,
): HTMLElement {
  const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 72;
  const row = appendPresentedChatMessage(
    messages,
    item,
    state !== 'sent' || isOwnChatMessage(item.author),
    state,
    window.battly.faceImageUrl(item.author),
  );
  if (follow || atBottom) {
    messages.scrollTop = messages.scrollHeight;
  }
  return row;
}

function renderChatMessages(
  items: readonly ChatMessage[],
  resetScroll = false,
  fetched = true,
): void {
  const messages = document.querySelector<HTMLElement>('[data-social-messages]');
  if (!messages || !activeConversation) {
    return;
  }
  const recipientId = activeConversation.recipientId;
  if (fetched) {
    const known = knownChatMessageIds.get(recipientId) ?? new Set<string>();
    items.forEach((item) => known.add(item.id));
    knownChatMessageIds.set(recipientId, known);
    serverChatMessages.set(recipientId, items);
  }
  const local = localChatMessages.get(recipientId) ?? [];
  const confirmed = confirmedChatMessageIds.get(recipientId) ?? new Set<string>();
  // A response can contain older identical messages. Only newly observed IDs
  // can confirm a send, and each server ID can confirm at most one local send.
  // Reconcile active attempts before failed ones whose response may have been lost.
  const attempts = [...local].sort(
    (a, b) => Number(a.state === 'failed') - Number(b.state === 'failed'),
  );
  for (const pending of attempts) {
    const echoed = items.find(
      (item) =>
        !pending.knownServerIds.has(item.id) &&
        !confirmed.has(item.id) &&
        item.author.toLowerCase() === pending.item.author.toLowerCase() &&
        item.content === pending.item.content,
    );
    if (!echoed) {
      continue;
    }
    pending.confirmedServerId = echoed.id;
    pending.state = 'sent';
    confirmed.add(echoed.id);
    // Remove only a draft restored by this failed attempt, never a draft the
    // user subsequently edited, even if its text happens to be identical.
    if (recoveredChatDrafts.get(recipientId) === pending.item.id) {
      recoveredChatDrafts.delete(recipientId);
      if (chatDrafts.get(recipientId) === pending.item.content) {
        chatDrafts.delete(recipientId);
        const composer = document.querySelector<HTMLTextAreaElement>(
          '[data-social-message-form] textarea[name="content"]',
        );
        if (composer?.value === pending.item.content) {
          composer.value = '';
        }
      }
    }
  }
  confirmedChatMessageIds.set(recipientId, confirmed);
  const remaining = local.filter((pending) => !pending.confirmedServerId);
  localChatMessages.set(recipientId, remaining);
  updateChatComposer();
  const unique = new Map<string, PresentedChatMessage>(
    items.map((item) => [item.id, { item, state: 'sent' }]),
  );
  remaining.forEach((pending) => unique.set(pending.item.id, pending));
  const ordered = [...unique.values()].sort((a, b) => {
    const aTime = Date.parse(a.item.createdAt);
    const bTime = Date.parse(b.item.createdAt);
    return Number.isFinite(aTime) && Number.isFinite(bTime) ? aTime - bTime : 0;
  });
  const signature = JSON.stringify(ordered);
  if (!resetScroll && chatRenderedSignature === signature) {
    return;
  }
  chatRenderedSignature = signature;
  const follow =
    resetScroll || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 72;
  const previousScroll = messages.scrollTop;
  const top = messages.getBoundingClientRect().top;
  const anchor = [...messages.querySelectorAll<HTMLElement>('[data-message-id]')].find(
    (row) => row.getBoundingClientRect().bottom > top,
  );
  const anchorId = anchor?.dataset.messageId;
  const anchorTop = anchor?.getBoundingClientRect().top;
  messages.replaceChildren();
  delete messages.dataset.empty;
  messages.setAttribute('aria-busy', 'false');
  for (const { item, state } of ordered) {
    appendPresentedChatMessage(
      messages,
      item,
      state !== 'sent' || isOwnChatMessage(item.author),
      state,
      window.battly.faceImageUrl(item.author),
    );
  }
  if (!ordered.length) {
    renderChatEmpty(
      messages,
      'empty',
      `Saluda a ${activeConversation.username}`,
      'Todavía no hay mensajes. Puedes enviar el primero.',
    );
  }
  if (follow) {
    messages.scrollTop = messages.scrollHeight;
  } else {
    messages.scrollTop = previousScroll;
    const nextAnchor = anchorId
      ? messages.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchorId)}"]`)
      : null;
    if (nextAnchor && anchorTop !== undefined) {
      messages.scrollTop += nextAnchor.getBoundingClientRect().top - anchorTop;
    }
  }
}

function refreshChatMessages(resetScroll = false): void {
  const conversation = activeConversation;
  const messages = document.querySelector<HTMLElement>('[data-social-messages]');
  if (!conversation || !messages || !chatDialog()?.open) {
    return;
  }
  const request = ++chatMessageRequest;
  const selection = chatSelection;
  if (conversation.id === conversation.recipientId && !conversation.lastMessage) {
    renderChatMessages([], resetScroll, false);
    return;
  }
  if (resetScroll) {
    renderChatEmpty(messages, 'loading', 'Cargando mensajes…', 'Preparando vuestra conversación.');
  }
  void window.battly
    .getChatMessages(conversation.id)
    .then((items) => {
      if (request !== chatMessageRequest || selection !== chatSelection || !chatDialog()?.open) {
        return;
      }
      delete messages.dataset.refreshState;
      renderChatMessages(items, resetScroll);
    })
    .catch(() => {
      if (request !== chatMessageRequest || selection !== chatSelection || !chatDialog()?.open) {
        return;
      }
      messages.setAttribute('aria-busy', 'false');
      messages.dataset.refreshState = 'error';
      if (messages.querySelector('[data-message-id]')) {
        return;
      }
      renderChatEmpty(
        messages,
        'error',
        'No se pudieron cargar los mensajes',
        'Vuelve a abrir esta conversación para intentarlo de nuevo.',
      );
    });
}

function openConversation(conversation: ChatConversation): void {
  saveChatDraft();
  chatSelection += 1;
  chatSkinCleanup?.();
  chatSkinCleanup = undefined;
  activeConversation = conversation;
  chatRenderedSignature = '';
  const dialog = chatDialog();
  if (dialog) {
    dialog.dataset.view = 'conversation';
  }
  const form = document.querySelector<HTMLFormElement>('[data-social-message-form]');
  const active = document.querySelector<HTMLElement>('[data-social-chat-active]');
  const name = document.querySelector<HTMLElement>('[data-social-chat-name]');
  const avatar = document.querySelector<HTMLImageElement>('[data-social-chat-avatar]');
  const profilePanel = document.querySelector<HTMLElement>('[data-social-chat-profile-panel]');
  const profileAvatar = document.querySelector<HTMLImageElement>(
    '[data-social-chat-profile-avatar]',
  );
  const profileName = document.querySelector<HTMLElement>('[data-social-chat-profile-name]');
  const profileBio = document.querySelector<HTMLElement>('[data-social-chat-profile-bio]');
  if (active) {
    active.hidden = false;
  }
  if (name) {
    setUserText(name, conversation.username);
  }
  if (avatar) {
    avatar.src = window.battly.faceImageUrl(conversation.username);
  }
  if (profilePanel) {
    profilePanel.hidden = false;
  }
  document
    .querySelector('[data-social-chat-details-toggle]')
    ?.setAttribute('aria-expanded', String(Boolean(profilePanel?.getClientRects().length)));
  if (profileAvatar) {
    profileAvatar.src = window.battly.faceImageUrl(conversation.username);
  }
  if (profileName) {
    setUserText(profileName, conversation.username);
  }
  if (profileBio) {
    profileBio.textContent = 'Amigo de Battly';
  }
  const stage = document.querySelector<HTMLElement>('.battly-chat-skin-stage');
  if (stage) {
    chatSkinCleanup = mountChatSkinPreview(
      stage,
      window.battly.skinImageUrl(conversation.username),
    );
  }
  const openProfile = document.querySelector<HTMLButtonElement>('[data-social-chat-profile-open]');
  if (openProfile) {
    openProfile.onclick = () => showSocialProfile(conversation.recipientId);
  }
  const selection = chatSelection;
  void requestSocialProfile(conversation.recipientId)
    .then((profile) => {
      if (selection !== chatSelection || !chatDialog()?.open) {
        return;
      }
      if (profileBio) {
        setUserText(profileBio, profile.bio, 'Amigo de Battly');
      }
      if (stage && profile.skinUrl) {
        chatSkinCleanup?.();
        chatSkinCleanup = mountChatSkinPreview(stage, profile.skinUrl);
      }
    })
    .catch(() => undefined);
  updateChatPresence();
  renderChatConversations();
  if (form) {
    form.hidden = false;
  }
  const composer = form?.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
  if (composer) {
    composer.value = chatDrafts.get(conversation.recipientId) ?? '';
    composer.placeholder = `Envía un mensaje a ${conversation.username}…`;
  }
  updateChatComposer();
  refreshChatMessages(true);
}

function leaveChatConversation(): void {
  saveChatDraft();
  activeConversation = undefined;
  chatSelection += 1;
  chatMessageRequest += 1;
  chatSkinCleanup?.();
  chatSkinCleanup = undefined;
  const dialog = chatDialog();
  if (dialog) {
    delete dialog.dataset.view;
  }
  document
    .querySelectorAll<HTMLElement>(
      '[data-social-chat-active], [data-social-chat-profile-panel], [data-social-message-form]',
    )
    .forEach((element) => {
      element.hidden = true;
    });
  const messages = document.querySelector<HTMLElement>('[data-social-messages]');
  if (messages) {
    renderChatEmpty(
      messages,
      'empty',
      'Un «hola» puede ser el inicio de una gran partida.',
      'Elige una conversación o empieza una nueva con tus amigos de Battly.',
    );
  }
  renderChatConversations();
  updateChatComposer();
}

function refreshChatConversations(initial = false): void {
  const request = ++chatListRequest;
  const list = document.querySelector<HTMLElement>('[data-social-conversations]');
  if (initial && list && !chatConversations.length) {
    renderChatEmpty(
      list,
      'loading',
      'Cargando conversaciones…',
      'Buscando tus mensajes en Battly.',
    );
  }
  void window.battly
    .getChatConversations()
    .then((conversations) => {
      if (request !== chatListRequest || !chatDialog()?.open) {
        return;
      }
      chatConversations = [...conversations];
      if (activeConversation) {
        const canonical = conversations.find(
          (item) => item.recipientId === activeConversation?.recipientId,
        );
        if (canonical) {
          activeConversation = canonical;
        } else {
          chatConversations.unshift(activeConversation);
          // The list has now confirmed that this recipient has no server history.
          if (
            activeConversation.id === activeConversation.recipientId &&
            !activeConversation.lastMessage &&
            !knownChatMessageIds.has(activeConversation.recipientId)
          ) {
            knownChatMessageIds.set(activeConversation.recipientId, new Set());
            serverChatMessages.set(activeConversation.recipientId, []);
          }
        }
      }
      renderChatConversations();
      if (activeConversation) {
        refreshChatMessages();
      }
    })
    .catch(() => {
      if (request !== chatListRequest || !chatDialog()?.open) {
        return;
      }
      if (list && !chatConversations.length) {
        renderChatEmpty(
          list,
          'error',
          'No se pudieron cargar los chats',
          'Comprueba tu conexión y vuelve a abrir Battly Chat.',
        );
      }
      if (activeConversation) {
        refreshChatMessages();
      }
    });
}

function scheduleChatRefresh(): void {
  if (!chatDialog()?.open) {
    return;
  }
  if (chatRefreshTimer !== undefined) {
    window.clearTimeout(chatRefreshTimer);
  }
  chatRefreshTimer = window.setTimeout(() => {
    chatRefreshTimer = undefined;
    if (chatDialog()?.open) {
      refreshChatConversations();
    }
  }, 200);
}

function loadChat(_target?: { readonly userId: string; readonly username: string }): void {}

function loadSocialServers(): void {}

function renderSocial(snapshot: SocialSnapshot): void {
  socialSnapshot = snapshot;
  updateSocialProfilePresence();
  if (chatDialog()?.open) {
    updateChatPresence();
    renderNewChatFriends();
  }
  const query =
    document.querySelector<HTMLInputElement>('[data-social-filter]')?.value.toLowerCase() ?? '';
  const filtered = snapshot.friends.filter(
    (friend) =>
      friend.username.toLowerCase().includes(query) &&
      (socialScope === 'all' ||
        (socialScope === 'favorites' && socialFavorites.has(friend.username)) ||
        (socialScope === 'playing' &&
          friend.status === 'online' &&
          Boolean(friend.activity) &&
          friend.activity !== 'En el menú principal') ||
        friend.status === socialScope),
  );
  filtered.sort((left, right) => {
    if (socialSort === 'name') {
      return left.username.localeCompare(right.username, 'es');
    }
    if (socialSort === 'recent') {
      return 0;
    }
    const statusDifference = Number(right.status === 'online') - Number(left.status === 'online');
    // Legacy keeps the API order inside each status group. That order also
    // reflects the realtime presence feed, so alphabetizing it changes the
    // first cards every time the panel opens.
    return statusDifference;
  });
  const grid = document.querySelector<HTMLElement>('[data-social-grid]');
  grid?.replaceChildren(...filtered.map(renderSocialFriend));
  const loading = document.querySelector<HTMLElement>('#friends-loading');
  const empty = document.querySelector<HTMLElement>('#friends-empty');
  const noResults = document.querySelector<HTMLElement>('#friends-no-results');
  for (const container of [empty, noResults]) {
    const icon = container?.querySelector('.empty-icon');
    if (icon && !icon.querySelector('.empty-state-steve')) {
      icon.replaceChildren(thinkingSteveImage());
    }
  }
  if (loading) {
    loading.style.display = 'none';
  }
  if (grid) {
    grid.style.display = filtered.length ? 'grid' : 'none';
  }
  if (empty) {
    empty.style.display = snapshot.friends.length === 0 ? 'block' : 'none';
  }
  if (noResults) {
    noResults.style.display =
      snapshot.friends.length > 0 && filtered.length === 0 ? 'block' : 'none';
  }
  const count = document.querySelector<HTMLElement>('[data-social-count]');
  if (count) {
    count.textContent = `${snapshot.friends.length} amigos`;
  }
  const scopeCounts: Record<SocialScope, number> = {
    all: snapshot.friends.length,
    online: snapshot.friends.filter((friend) => friend.status === 'online').length,
    playing: snapshot.friends.filter(
      (friend) =>
        friend.status === 'online' &&
        Boolean(friend.activity) &&
        friend.activity !== 'En el menú principal',
    ).length,
    offline: snapshot.friends.filter((friend) => friend.status === 'offline').length,
    favorites: snapshot.friends.filter((friend) => socialFavorites.has(friend.username)).length,
  };
  for (const [scope, value] of Object.entries(scopeCounts)) {
    const output = document.querySelector<HTMLElement>(`[data-social-scope-count="${scope}"]`);
    if (output) {
      output.textContent = String(value);
    }
  }
  renderSocialRequestBadges(snapshot.receivedRequests.length);
  const list = document.querySelector<HTMLElement>('[data-social-requests-list]');
  list?.replaceChildren();
  const appendRequests = (
    titleText: string,
    usernames: readonly string[],
    direction: 'received' | 'sent',
  ): void => {
    if (!list || !usernames.length) {
      return;
    }
    const section = document.createElement('section');
    section.className = 'legacy-friends-request-section';
    const title = document.createElement('h2');
    title.innerHTML = /* HTML */ `<i
        class="fa-solid fa-arrow-${direction === 'received' ? 'down' : 'up'}"
        aria-hidden="true"
      ></i>
      ${titleText} (${usernames.length})`;
    section.append(title);
    for (const username of usernames) {
      const row = document.createElement('div');
      row.className = 'legacy-friends-request-row';
      const avatar = document.createElement('div');
      avatar.className = 'legacy-friends-request-avatar';
      avatar.classList.add('mc-face-viewer-8x');
      avatar.style.backgroundImage = `url(${JSON.stringify(window.battly.skinImageUrl(username))})`;
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = username;
      const description = document.createElement('span');
      description.textContent =
        direction === 'received' ? 'Quiere ser tu amigo' : 'Solicitud enviada';
      copy.append(name, description);
      const actions = document.createElement('div');
      actions.className = 'legacy-friends-request-actions';
      actions.append(
        ...(direction === 'received'
          ? [
              socialActionButton('Aceptar', 'accept', username),
              socialActionButton('Rechazar', 'reject', username),
            ]
          : [socialActionButton('Cancelar', 'cancel', username)]),
      );
      row.append(avatar, copy, actions);
      section.append(row);
    }
    list.append(section);
  };
  appendRequests('Recibidas', snapshot.receivedRequests, 'received');
  appendRequests('Enviadas', snapshot.sentRequests, 'sent');
  if (list && !list.childElementCount) {
    list.replaceChildren(emptyState('No hay solicitudes pendientes'));
  }
  const status = document.querySelector<HTMLElement>('[data-social-status]');
  if (status && socialRealtimeState === 'connected') {
    status.textContent = 'Conectado en tiempo real';
  }
}

function loadSocial(): void {
  const status = document.querySelector<HTMLElement>('[data-social-status]');
  if (status) {
    status.textContent = 'Cargando Battly Social…';
  }
  void window.battly
    .getSocial()
    .then(renderSocial)
    .catch(() => {
      if (status) {
        status.textContent = 'Inicia sesión con una cuenta de Battly para usar Social';
      }
    });
  void window.battly.startSocialRealtime().catch(() => {
    socialRealtimeState = 'error';
    document.body.dataset.socialRealtime = 'error';
    updateChatConnection();
    if (status) {
      status.textContent = 'No se pudo conectar con Battly Social';
    }
  });
}

function bindSocial(): void {
  const socialPanel = document.querySelector<HTMLElement>('[data-panel-view="social"]');
  const socialTourSession = tutorialSession();
  const tutorial = socialPanel
    ? mountGuidedTutorial({
        id: 'friends',
        replayHost: '.friends-header-actions',
        label: 'Tutorial de Amigos',
        promptTitle: '¿Primera vez en Battly Social?',
        promptText: 'Descubre cómo encontrar y organizar a tus amigos.',
        root: socialPanel,
        storageKey: 'friendsTutorialCompleted',
        onStart: socialTourSession.start,
        onFinish: socialTourSession.finish,
        steps: [
          {
            title: 'Bienvenido a Battly Social',
            text: 'Consulta la presencia, perfiles y actividad de tus amigos de Battly.',
          },
          {
            selector: '[data-social-filter]',
            title: 'Buscar amigos',
            text: 'Filtra al instante tu lista por nombre.',
          },
          {
            selector: '.filter-buttons',
            title: 'Filtros rápidos',
            text: 'Cambia entre todos, conectados, desconectados y favoritos.',
          },
          {
            selector: '[data-social-search-form] input',
            scope: 'document',
            title: 'Añadir amigo',
            text: 'Busca un usuario de Battly desde este formulario. La solicitud solo se envía cuando tú la confirmas.',
            onEnter: () => {
              socialPanel.querySelector<HTMLButtonElement>('[data-social-add]')?.click();
            },
            onLeave: () =>
              document.querySelector<HTMLDialogElement>('[data-social-add-dialog]')?.close(),
          },
          {
            selector: '[data-social-requests-dialog] .social-modal-card',
            scope: 'document',
            title: 'Solicitudes de amistad',
            text: 'Revisa las solicitudes recibidas y decide cuáles aceptar o rechazar.',
            onEnter: () => {
              socialPanel.querySelector<HTMLButtonElement>('[data-social-requests]')?.click();
            },
            onLeave: () =>
              document.querySelector<HTMLDialogElement>('[data-social-requests-dialog]')?.close(),
          },
          {
            selector: '[data-social-profile-dialog] .modal-card',
            scope: 'document',
            title: 'El perfil de un amigo',
            text: 'Aquí puedes consultar su perfil, actividad y opciones para conectar.',
            unavailableText:
              'Cuando tengas un amigo en la lista, pulsa Perfil para consultar su información y sus opciones de chat.',
            onEnter: async () => {
              const profile = await waitForTutorialElement(
                '[data-social-profile-open]',
                socialPanel,
              );
              profile?.click();
            },
            onLeave: () =>
              document.querySelector<HTMLDialogElement>('[data-social-profile-dialog]')?.close(),
          },
          {
            title: 'Todo listo',
            text: 'Ya sabes dónde buscar usuarios, revisar solicitudes y abrir el perfil de tus amigos.',
          },
        ],
      })
    : null;
  let socialRefreshRevision = 0;
  const socialRefresh = new CoalescedRefresh(async () => {
    const revision = socialRefreshRevision;
    const snapshot = await window.battly.getSocial();
    if (revision === socialRefreshRevision) {
      renderSocial(snapshot);
    }
  });
  const cancelSocialRefresh = (): void => {
    socialRefreshRevision += 1;
    socialRefresh.cancel();
  };
  window.addEventListener('battly:account-changed', cancelSocialRefresh);
  window.addEventListener('beforeunload', cancelSocialRefresh, { once: true });
  window.battly.onSocialChanged(() => {
    socialRefresh.request();
    scheduleChatRefresh();
  });
  window.battly.onSocialRealtimeState((state) => {
    socialRealtimeState = state;
    updateSocialProfilePresence();
    document.body.dataset.socialRealtime = state;
    updateChatConnection();
    if (state === 'connected') {
      scheduleChatRefresh();
    }
    const status = document.querySelector<HTMLElement>('[data-social-status]');
    if (!status) {
      return;
    }
    const labels = {
      connected: 'Conectado en tiempo real',
      connecting: 'Conectando con Battly Social…',
      disconnected: 'Sin conexión en tiempo real · se conserva la última lista',
      error: 'No se pudo conectar · reintentando en segundo plano',
      reconnecting: 'Reconectando · se conserva la última lista',
    } as const;
    status.textContent = labels[state];
  });
  socialPanel?.addEventListener('battly:panel-enter', () => {
    loadSocial();
    window.setTimeout(() => tutorial?.offer(), 900);
  });
  document
    .querySelector<HTMLInputElement>('[data-social-filter]')
    ?.addEventListener('input', () => renderSocial(socialSnapshot));
  document
    .querySelector<HTMLButtonElement>('#friends-search-clear')
    ?.addEventListener('click', () => {
      const input = document.querySelector<HTMLInputElement>('[data-social-filter]');
      if (input) {
        input.value = '';
      }
      renderSocial(socialSnapshot);
    });
  document
    .querySelector<HTMLSelectElement>('[data-social-sort]')
    ?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (value === 'name' || value === 'recent' || value === 'status') {
        socialSort = value;
      }
      renderSocial(socialSnapshot);
    });
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      document
        .querySelectorAll<HTMLButtonElement>('[data-view]')
        .forEach((candidate) => candidate.classList.toggle('active', candidate === button));
      document
        .querySelector<HTMLElement>('[data-social-grid]')
        ?.classList.toggle('view-list', button.dataset.view === 'list');
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-social-scope]').forEach((button) => {
    button.addEventListener('click', () => {
      const scope = button.dataset.socialScope;
      if (
        scope !== 'all' &&
        scope !== 'online' &&
        scope !== 'playing' &&
        scope !== 'offline' &&
        scope !== 'favorites'
      ) {
        return;
      }
      socialScope = scope;
      document.querySelectorAll<HTMLButtonElement>('[data-social-scope]').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      renderSocial(socialSnapshot);
    });
  });
  document
    .querySelectorAll('.empty-search-state > i')
    .forEach((icon) => icon.replaceWith(thinkingSteveImage()));
  const addDialog = document.querySelector<HTMLDialogElement>('[data-social-add-dialog]');
  const requestsDialog = document.querySelector<HTMLDialogElement>('[data-social-requests-dialog]');
  const contextMenu = document.querySelector<HTMLElement>('#friend-context-menu');
  contextMenu?.querySelectorAll<HTMLElement>('[data-action]').forEach((item) => {
    item.addEventListener('click', () => {
      const friend = socialContextFriend;
      contextMenu.style.display = 'none';
      if (!friend) {
        return;
      }
      const action = item.dataset.action;
      if (action === 'profile') {
        showSocialProfile(friend.userId);
      } else if (action === 'chat') {
        loadChat();
      } else if (action === 'join') {
        joinSocialFriend(friend);
      } else if (action === 'favorite') {
        toggleSocialFavorite(friend.username);
      } else if (action === 'remove') {
        void window.battly.socialAction('remove', friend.username).then(renderSocial);
      } else if (action === 'note' || action === 'block') {
        const status = document.querySelector<HTMLElement>('[data-social-status]');
        if (status) {
          status.textContent =
            action === 'note'
              ? 'El sistema de notas estará disponible próximamente'
              : 'El sistema de bloqueo estará disponible próximamente';
        }
      }
    });
  });
  document.addEventListener('click', (event) => {
    if (contextMenu && !contextMenu.contains(event.target as Node)) {
      contextMenu.style.display = 'none';
    }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-social-add]').forEach((button) =>
    button.addEventListener('click', () => {
      const form = document.querySelector<HTMLFormElement>('[data-social-search-form]');
      const results = document.querySelector<HTMLElement>('[data-social-search-results]');
      const status = document.querySelector<HTMLElement>('[data-social-search-status]');
      const empty = document.querySelector<HTMLElement>('[data-social-search-empty]');
      form?.reset();
      results?.replaceChildren();
      if (status) {
        status.textContent = '';
      }
      if (empty) {
        empty.hidden = false;
      }
      addDialog?.showModal();
      form?.querySelector<HTMLInputElement>('input')?.focus();
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>('[data-social-add-close]')
    .forEach((button) => button.addEventListener('click', () => addDialog?.close()));
  document
    .querySelector<HTMLButtonElement>('[data-social-requests]')
    ?.addEventListener('click', () => requestsDialog?.showModal());
  document
    .querySelector<HTMLButtonElement>('[data-social-requests-close]')
    ?.addEventListener('click', () => requestsDialog?.close());
  document
    .querySelector<HTMLButtonElement>('[data-social-profile-close]')
    ?.addEventListener('click', () => {
      socialProfileSkinViewer?.dispose();
      socialProfileSkinViewer = null;
      document.querySelector<HTMLDialogElement>('[data-social-profile-dialog]')?.close();
    });
  document
    .querySelector<HTMLButtonElement>('[data-social-chat]')
    ?.addEventListener('click', () => void activatePanel('chat'));
  document
    .querySelector<HTMLButtonElement>('[data-social-profile-chat]')
    ?.addEventListener('click', () => {
      if (!activeSocialProfile) {
        return;
      }
      document.querySelector<HTMLDialogElement>('[data-social-profile-dialog]')?.close();
      loadChat({
        userId: activeSocialProfile.userId,
        username: activeSocialProfile.username,
      });
    });
  const conversationDialog = chatDialog();
  conversationDialog?.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (
        !(image instanceof HTMLImageElement) ||
        !image.matches(
          '[data-social-chat-avatar], [data-social-chat-self-avatar], [data-social-chat-profile-avatar], ' +
            '[data-social-conversations] img, [data-social-new-chat-friends] img, .battly-chat-message > img',
        )
      ) {
        return;
      }
      const fallback = new URL(defaultChatFaceUrl, document.baseURI).href;
      if (image.src !== fallback) {
        image.src = fallback;
      }
    },
    true,
  );
  document
    .querySelector<HTMLButtonElement>('[data-social-chat-close]')
    ?.addEventListener('click', () => conversationDialog?.close());
  conversationDialog?.addEventListener('close', () => {
    leaveChatConversation();
    chatListRequest += 1;
    if (chatRefreshTimer !== undefined) {
      window.clearTimeout(chatRefreshTimer);
    }
    chatRefreshTimer = undefined;
    const picker = document.querySelector<HTMLElement>('[data-social-new-chat]');
    if (picker) {
      picker.hidden = true;
    }
    document.querySelector('[data-social-new-chat-toggle]')?.setAttribute('aria-expanded', 'false');
  });
  document
    .querySelector<HTMLButtonElement>('[data-social-chat-back]')
    ?.addEventListener('click', () => {
      leaveChatConversation();
      document.querySelector<HTMLInputElement>('[data-social-chat-filter]')?.focus();
    });
  const detailsToggle = document.querySelector<HTMLButtonElement>(
    '[data-social-chat-details-toggle]',
  );
  const syncDetailsToggle = (): void => {
    const panel = document.querySelector<HTMLElement>('[data-social-chat-profile-panel]');
    detailsToggle?.setAttribute(
      'aria-expanded',
      String(Boolean(panel?.getClientRects().length) && !panel?.hidden),
    );
  };
  detailsToggle?.addEventListener('click', () => {
    if (!conversationDialog || !activeConversation) {
      return;
    }
    const panel = document.querySelector<HTMLElement>('[data-social-chat-profile-panel]');
    const visible = Boolean(panel?.getClientRects().length) && !panel?.hidden;
    conversationDialog.dataset.details = visible ? 'hidden' : 'visible';
    syncDetailsToggle();
  });
  window.matchMedia('(max-width: 1120px)').addEventListener('change', syncDetailsToggle);
  window.addEventListener('resize', () => {
    if (conversationDialog?.open) {
      updateChatComposer();
    }
  });
  document
    .querySelector<HTMLButtonElement>('[data-social-new-chat-toggle]')
    ?.addEventListener('click', (event) => {
      const picker = document.querySelector<HTMLElement>('[data-social-new-chat]');
      if (!picker) {
        return;
      }
      picker.hidden = !picker.hidden;
      (event.currentTarget as HTMLButtonElement).setAttribute(
        'aria-expanded',
        String(!picker.hidden),
      );
      if (!picker.hidden) {
        renderNewChatFriends();
        picker.querySelector<HTMLButtonElement>('button')?.focus();
      }
    });
  document
    .querySelector<HTMLInputElement>('[data-social-chat-filter]')
    ?.addEventListener('input', filterChatConversations);
  document
    .querySelector<HTMLButtonElement>('[data-social-chat-profile]')
    ?.addEventListener('click', () => {
      if (activeConversation) {
        showSocialProfile(activeConversation.recipientId);
      }
    });
  const composer = document.querySelector<HTMLTextAreaElement>(
    '[data-social-message-form] textarea[name="content"]',
  );
  composer?.addEventListener('input', () => {
    if (activeConversation) {
      recoveredChatDrafts.delete(activeConversation.recipientId);
    }
    saveChatDraft();
    updateChatComposer();
  });
  composer?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    const send = document.querySelector<HTMLButtonElement>('[data-social-chat-send]');
    if (send && !send.disabled) {
      composer.form?.requestSubmit(send);
    }
  });
  document
    .querySelector<HTMLButtonElement>('[data-social-servers]')
    ?.addEventListener('click', loadSocialServers);
  document
    .querySelector<HTMLButtonElement>('[data-social-servers-close]')
    ?.addEventListener('click', () =>
      document.querySelector<HTMLDialogElement>('[data-social-servers-dialog]')?.close(),
    );
  document
    .querySelector<HTMLFormElement>('[data-social-message-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!activeConversation) {
        return;
      }
      const form = event.currentTarget as HTMLFormElement;
      const input = form.querySelector<HTMLTextAreaElement>('textarea[name="content"]');
      const content = input?.value.trim() ?? '';
      if (
        !content ||
        content.length > 2_000 ||
        !knownChatMessageIds.has(activeConversation.recipientId)
      ) {
        return;
      }
      const conversation = activeConversation;
      const messages = document.querySelector<HTMLElement>('[data-social-messages]');
      const author = currentChatUsername() || 'Tú';
      const account = chatAccountUsername;
      const pending: LocalChatMessage = {
        item: {
          id: `pending-${crypto.randomUUID()}`,
          author,
          content,
          createdAt: new Date().toISOString(),
        },
        state: 'pending',
        knownServerIds: new Set(knownChatMessageIds.get(conversation.recipientId)),
      };
      const previousLocal = localChatMessages.get(conversation.recipientId) ?? [];
      // Sending a recovered draft retries that content instead of leaving an
      // obsolete failed bubble beside the new attempt.
      const local = previousLocal.filter(
        (item) => item.state !== 'failed' || item.item.content !== content,
      );
      const retry = local.length !== previousLocal.length;
      local.push(pending);
      localChatMessages.set(conversation.recipientId, local);
      if (messages) {
        if (retry) {
          renderChatMessages(serverChatMessages.get(conversation.recipientId) ?? [], true, false);
        } else {
          appendChatMessage(messages, pending.item, 'pending', true);
        }
      }
      chatRenderedSignature = '';
      form.reset();
      chatDrafts.delete(conversation.recipientId);
      recoveredChatDrafts.delete(conversation.recipientId);
      updateChatComposer();
      input?.focus();
      const updateDelivery = (): void => {
        if (activeConversation?.recipientId !== conversation.recipientId) {
          return;
        }
        const row = messages?.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(pending.item.id)}"]`,
        );
        if (row) {
          row.dataset.deliveryState = pending.state;
        }
        const delivery = row?.querySelector<HTMLElement>('.battly-chat-delivery');
        if (delivery) {
          delivery.textContent = pending.state === 'failed' ? 'No enviado' : '';
        }
        chatRenderedSignature = '';
      };
      void window.battly
        .sendChatMessage(conversation.recipientId, content)
        .then(() => {
          if (account !== chatAccountUsername) {
            return;
          }
          pending.state = 'sent';
          updateDelivery();
          chatConversations = chatConversations.map((item) =>
            item.recipientId === conversation.recipientId
              ? { ...item, lastMessage: content }
              : item,
          );
          if (chatDialog()?.open) {
            renderChatConversations();
            scheduleChatRefresh();
          }
        })
        .catch(() => {
          if (account !== chatAccountUsername || pending.confirmedServerId) {
            return;
          }
          pending.state = 'failed';
          updateDelivery();
          if (!chatDrafts.has(conversation.recipientId)) {
            chatDrafts.set(conversation.recipientId, content);
            recoveredChatDrafts.set(conversation.recipientId, pending.item.id);
            if (
              input &&
              activeConversation?.recipientId === conversation.recipientId &&
              !input.value
            ) {
              input.value = content;
              updateChatComposer();
            }
          }
          scheduleChatRefresh();
        });
    });
  document
    .querySelector<HTMLFormElement>('[data-social-search-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const usernameValue = new FormData(form).get('username');
      const username = typeof usernameValue === 'string' ? usernameValue : '';
      const results = document.querySelector<HTMLElement>('[data-social-search-results]');
      const status = document.querySelector<HTMLElement>('[data-social-search-status]');
      const empty = document.querySelector<HTMLElement>('[data-social-search-empty]');
      if (status) {
        status.textContent = 'Buscando…';
      }
      if (empty) {
        empty.hidden = true;
      }
      void window.battly
        .searchSocialUsers(username)
        .then((users) => {
          const excluded = new Set([
            ...ownAccountNames,
            ...socialSnapshot.friends.map((friend) => friend.username.toLowerCase()),
            ...socialSnapshot.sentRequests.map((username) => username.toLowerCase()),
          ]);
          users = users.filter((user) => !excluded.has(user.toLowerCase()));
          results?.replaceChildren();
          for (const user of users) {
            const row = document.createElement('div');
            const avatar = document.createElement('div');
            avatar.className = 'legacy-friends-request-avatar';
            avatar.classList.add('mc-face-viewer-8x');
            avatar.style.backgroundImage = `url(${JSON.stringify(
              window.battly.skinImageUrl(user),
            )})`;
            const name = document.createElement('strong');
            name.textContent = user;
            row.append(avatar, name, socialActionButton('Añadir', 'send', user));
            results?.append(row);
          }
          if (status) {
            status.textContent = users.length ? '' : 'No se encontraron usuarios';
          }
          if (empty) {
            empty.hidden = users.length > 0;
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo completar la búsqueda';
          }
          if (empty) {
            empty.hidden = false;
          }
        });
    });
}

type MusicEqualizer = 'bass' | 'bright' | 'custom' | 'flat' | 'night' | 'voice';
interface MusicAudioSettings {
  readonly aggressivePreload: boolean;
  readonly autoQueue: boolean;
  readonly equalizer: MusicEqualizer;
  readonly equalizerBands: readonly number[];
  readonly explicitFilter: boolean;
  readonly normalization: boolean;
  readonly normalizerTarget: number;
  readonly quality: MusicQuality;
  readonly repeatQueue: boolean;
  readonly repeatTrack: boolean;
  readonly smartShuffle: boolean;
  readonly smartPlayback: boolean;
  readonly volume: number;
}

const musicAudioSettingsKey = 'battly.music.audio-settings.v1';
const defaultMusicAudioSettings: MusicAudioSettings = {
  aggressivePreload: false,
  autoQueue: false,
  equalizer: 'flat',
  equalizerBands: [0, 0, 0, 0, 0, 0],
  explicitFilter: false,
  normalization: false,
  normalizerTarget: 100,
  quality: 'auto',
  repeatQueue: false,
  repeatTrack: false,
  smartShuffle: false,
  smartPlayback: true,
  volume: 50,
};

function readMusicAudioSettings(): MusicAudioSettings {
  try {
    const value = JSON.parse(privateStorage.getItem(musicAudioSettingsKey) ?? '{}') as Record<
      string,
      unknown
    >;
    const bands = Array.isArray(value.equalizerBands)
      ? value.equalizerBands
          .slice(0, 6)
          .map((gain) => Math.max(-12, Math.min(12, Number(gain) || 0)))
      : [...defaultMusicAudioSettings.equalizerBands];
    while (bands.length < 6) {
      bands.push(0);
    }
    return {
      aggressivePreload: value.aggressivePreload === true,
      autoQueue: value.autoQueue === true,
      equalizer: ['bass', 'bright', 'custom', 'flat', 'night', 'voice'].includes(
        String(value.equalizer),
      )
        ? (value.equalizer as MusicEqualizer)
        : 'flat',
      equalizerBands: bands,
      explicitFilter: value.explicitFilter === true,
      normalization: value.normalization === true,
      normalizerTarget: Math.max(80, Math.min(130, Number(value.normalizerTarget) || 100)),
      quality: ['auto', 'high', 'low', 'medium'].includes(String(value.quality))
        ? (value.quality as MusicQuality)
        : 'auto',
      repeatQueue: value.repeatQueue === true,
      repeatTrack: value.repeatTrack === true,
      smartShuffle: value.smartShuffle === true,
      smartPlayback: value.smartPlayback !== false,
      volume: Number.isFinite(Number(value.volume))
        ? Math.max(0, Math.min(100, Number(value.volume)))
        : 50,
    };
  } catch {
    return defaultMusicAudioSettings;
  }
}

let musicAudioSettings = readMusicAudioSettings();
let musicAudioContext: AudioContext | null = null;
let musicLowFilter: BiquadFilterNode | null = null;
let musicMidFilter: BiquadFilterNode | null = null;
let musicHighFilter: BiquadFilterNode | null = null;
let musicCompressor: DynamicsCompressorNode | null = null;

function applyMusicAudioProcessing(): void {
  const audio = musicAudio();
  if (!audio) {
    return;
  }
  const needsProcessing =
    musicAudioSettings.normalization || musicAudioSettings.equalizer !== 'flat';
  if (!needsProcessing && !musicAudioContext) {
    return;
  }
  if (!musicAudioContext) {
    musicAudioContext = new AudioContext();
    const source = musicAudioContext.createMediaElementSource(audio);
    musicLowFilter = musicAudioContext.createBiquadFilter();
    musicLowFilter.type = 'lowshelf';
    musicLowFilter.frequency.value = 180;
    musicMidFilter = musicAudioContext.createBiquadFilter();
    musicMidFilter.type = 'peaking';
    musicMidFilter.frequency.value = 1_500;
    musicMidFilter.Q.value = 0.8;
    musicHighFilter = musicAudioContext.createBiquadFilter();
    musicHighFilter.type = 'highshelf';
    musicHighFilter.frequency.value = 5_500;
    musicCompressor = musicAudioContext.createDynamicsCompressor();
    source
      .connect(musicLowFilter)
      .connect(musicMidFilter)
      .connect(musicHighFilter)
      .connect(musicCompressor)
      .connect(musicAudioContext.destination);
  }
  const custom = musicAudioSettings.equalizerBands;
  const gains: Record<MusicEqualizer, readonly [number, number, number]> = {
    flat: [0, 0, 0],
    bass: [6, -1, -2],
    voice: [-2, 5, 1],
    bright: [-2, 1, 6],
    night: [2, 1, -4],
    custom: [
      ((custom[0] ?? 0) + (custom[1] ?? 0)) / 2,
      ((custom[2] ?? 0) + (custom[3] ?? 0)) / 2,
      ((custom[4] ?? 0) + (custom[5] ?? 0)) / 2,
    ],
  };
  const [low, mid, high] = gains[musicAudioSettings.equalizer];
  if (musicLowFilter) {
    musicLowFilter.gain.value = low;
  }
  if (musicMidFilter) {
    musicMidFilter.gain.value = mid;
  }
  if (musicHighFilter) {
    musicHighFilter.gain.value = high;
  }
  if (musicCompressor) {
    musicCompressor.threshold.value = musicAudioSettings.normalization
      ? -18 + (100 - musicAudioSettings.normalizerTarget) * 0.25
      : 0;
    musicCompressor.knee.value = musicAudioSettings.normalization ? 20 : 0;
    musicCompressor.ratio.value = musicAudioSettings.normalization ? 4 : 1;
    musicCompressor.attack.value = 0.01;
    musicCompressor.release.value = 0.3;
  }
  void musicAudioContext.resume().catch(() => undefined);
  document.body.dataset.musicAudioSettings = 'ready';
}

let musicSnapshot: MusicSnapshot = {
  featured: [],
  homePlaylists: [],
  playlists: [],
  fromCache: false,
};
let editingMusicPlaylist: MusicPlaylist | null = null;
let playlistDraftSongs: readonly MusicSong[] | null = null;
const bindPlaylistMenu = createPlaylistMenu({
  renderName: (element, playlist) => setMusicPlaylistCopy(element, playlist, 'name'),
  open: openLegacyMusicPlaylist,
  play: (playlist) => {
    musicQueue = [...playlist.songs];
    if (musicQueue.length) {
      playMusicAt(0);
    }
  },
  next: (playlist) => {
    musicQueue.splice(musicQueueIndex + 1, 0, ...playlist.songs);
    renderMusicQueue();
  },
  enqueue: (playlist) => {
    musicQueue.push(...playlist.songs);
    renderMusicQueue();
  },
  edit: openMusicPlaylistDialog,
  share: async (playlist) => {
    const result = await window.battly.shareMusicPlaylist(playlist.id);
    await copyTextToClipboard(result.url);
    showToast('Enlace copiado', 'El enlace de la playlist está en el portapapeles.', 'success');
  },
  collaborate: (playlist) => openMusicCollaborationDialog(playlist),
  remove: async (playlist) => {
    if (!(await askBattly({ text: `¿Eliminar la playlist ${playlist.name}?` }))) {
      return;
    }
    await window.battly.deleteMusicPlaylist(playlist.id);
    loadMusic();
  },
  report: (message) => showToast('Battly Music', message, 'error'),
});
const bindSongMenu = createSongMenu(
  (songs) => [
    {
      label: 'Reproducir ahora',
      icon: 'fa-play',
      run: () => {
        musicQueue = [...musicQueue, ...songs];
        playMusicAt(musicQueue.length - songs.length);
      },
    },
    {
      label: 'Reproducir a continuación',
      icon: 'fa-forward-step',
      run: () => {
        musicQueue.splice(musicQueueIndex + 1, 0, ...songs);
        renderMusicQueue();
      },
    },
    {
      label: 'Añadir a la cola',
      icon: 'fa-list',
      run: () => {
        musicQueue.push(...songs);
        renderMusicQueue();
      },
    },
    {
      label: 'Guardar en Favoritos',
      icon: 'fa-heart',
      run: async () => {
        for (const song of songs) {
          musicFavorites = [
            ...(await window.battly.setMusicFavorite(
              {
                id: song.id,
                title: song.title,
                artist: song.artist,
                thumbnailUrl: song.thumbnailUrl,
              },
              true,
            )),
          ];
        }
        renderLegacyMusicFavorites();
      },
    },
    {
      label: 'Crear playlist con la selección',
      icon: 'fa-square-plus',
      run: () => openMusicPlaylistDialog(null, songs),
    },
    {
      label: 'Añadir a',
      icon: 'fa-plus',
      children: musicSnapshot.playlists
        .filter((playlist) => playlist.canEditSongs)
        .map((playlist) => ({
          label: playlist.name,
          userLabel: true,
          icon: 'fa-music',
          run: async () => {
            await window.battly.updateMusicPlaylistSongs(playlist.id, [
              ...new Set([
                ...playlist.songs.map((song) => song.id),
                ...songs.map((song) => song.id),
              ]),
            ]);
            loadMusic();
          },
        })),
    },
    ...(songs.length === 1
      ? [
          {
            label: 'Ver detalles',
            icon: 'fa-circle-info',
            run: () => openMusicTrackDetails(songs[0]),
          },
        ]
      : []),
  ],
  (message) => {
    const status = document.querySelector<HTMLElement>('[data-music-status]');
    if (status) {
      status.textContent = message;
    }
  },
);
let musicFavorites: MusicSong[] = [];
let musicQueue: MusicSong[] = [];
let musicQueueIndex = -1;
const musicResolvedSongIds = new Set<string>();
let detailedMusicSong: MusicSong | null = null;
let lastMusicPlaybackSync = 0;
let musicPanelHistory = ['b-music-panel-inicio'];
let musicPanelHistoryIndex = 0;
let musicSearchGeneration = 0;
const musicInviteRefresh = new MusicInviteRefresh(
  () => window.battly.getMusicInvites(),
  renderMusicInviteBadges,
);

function renderMusicInviteBadges(count: number): void {
  document
    .querySelectorAll<HTMLElement>('button[data-panel="music"], a[data-panel="music"]')
    .forEach((button) => {
      button.classList.add('music-invite-indicator');
      if (!button.querySelector('[data-music-invites-count]')) {
        const badge = document.createElement('span');
        badge.dataset.musicInvitesCount = '';
        button.append(badge);
      }
    });
  document.querySelectorAll<HTMLElement>('[data-music-invites-count]').forEach((badge) => {
    badge.classList.add('music-invite-count');
    badge.hidden = count === 0;
    badge.style.removeProperty('display');
    badge.textContent = count > 9 ? '+9' : String(count);
    badge.setAttribute('aria-label', `${translateUiText('Invitaciones')} (${count})`);
  });
}

function updateMusicHistoryButtons(): void {
  const back = document.querySelector<HTMLButtonElement>('#arrow-back');
  const forward = document.querySelector<HTMLButtonElement>('#arrow-forward');
  if (back) {
    back.disabled = musicPanelHistoryIndex <= 0;
  }
  if (forward) {
    forward.disabled = musicPanelHistoryIndex >= musicPanelHistory.length - 1;
  }
}

function showLegacyMusicSection(section: string, remember = true): void {
  musicSearchGeneration += 1;
  const searchResults = document.querySelector<HTMLElement>('.b-music-search-results');
  searchResults?.classList.remove('show');
  searchResults?.classList.add('hide');
  document.querySelector<HTMLElement>('.b-music-search-overlay')?.classList.remove('active');
  document
    .querySelectorAll<HTMLElement>('[data-panel-view="music"] .b-music-panel')
    .forEach((view) => view.classList.toggle('active', view.classList.contains(section)));
  document
    .querySelectorAll<HTMLElement>('[data-panel-view="music"] [data-music-section]')
    .forEach((control) =>
      control.classList.toggle('active', control.dataset.musicSection === section),
    );
  document
    .querySelectorAll<HTMLElement>(
      '[data-panel-view="music"] .music-workspace, [data-panel-view="music"] .b-music-panel.active',
    )
    .forEach((view) => {
      view.scrollTop = 0;
      view.scrollLeft = 0;
    });
  if (remember && musicPanelHistory[musicPanelHistoryIndex] !== section) {
    musicPanelHistory = musicPanelHistory.slice(0, musicPanelHistoryIndex + 1);
    musicPanelHistory.push(section);
    musicPanelHistoryIndex = musicPanelHistory.length - 1;
  }
  updateMusicHistoryButtons();
}

function renderMusicSearchResults(songs: readonly MusicSong[], query: string): void {
  const results = document.querySelector<HTMLElement>('.b-music-search-results');
  const overlay = document.querySelector<HTMLElement>('.b-music-search-overlay');
  if (!results) {
    return;
  }
  results.replaceChildren();
  const header = document.createElement('div');
  header.className = 'music-search-heading';
  const title = document.createElement('h3');
  title.textContent = `Resultados para “${query}”`;
  const count = document.createElement('span');
  count.className = 'music-search-count';
  count.textContent = `${songs.length} ${songs.length === 1 ? 'resultado' : 'resultados'}`;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'music-icon-button';
  close.setAttribute('aria-label', 'Cerrar búsqueda');
  close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  close.addEventListener('click', () => {
    results.classList.remove('show');
    results.classList.add('hide');
  });
  header.append(title, count, close);
  results.append(header);
  const list = document.createElement('div');
  list.className = 'music-search-list';
  for (const song of songs) {
    const result = document.createElement('article');
    result.className = 'music-search-result';
    const image = document.createElement('img');
    image.className = 'music-search-cover';
    image.src = song.thumbnailUrl ?? battlyIconUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.onerror = () => {
      image.onerror = null;
      image.src = battlyIconUrl;
    };
    const copy = document.createElement('div');
    copy.className = 'music-search-copy';
    const songTitle = document.createElement('h4');
    setUserText(songTitle, song.title);
    songTitle.title = song.title;
    const artist = document.createElement('p');
    setUserText(artist, song.artist, 'Artista desconocido');
    copy.append(songTitle, artist);
    const duration = document.createElement('span');
    duration.className = 'music-search-duration';
    duration.dataset.musicDurationId = song.id;
    duration.textContent = musicSongDuration(song);
    const actions = document.createElement('div');
    actions.className = 'music-search-actions';
    const actionButton = (className: string, icon: string, label: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `music-icon-button ${className}`.trim();
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i>`;
      return button;
    };
    const play = actionButton('primary', 'fa-play', `Reproducir ${song.title}`);
    play.addEventListener('click', () => {
      const existing = musicQueue.findIndex((entry) => entry.id === song.id);
      if (existing >= 0) {
        playMusicAt(existing);
      } else {
        musicQueue = [song, ...musicQueue];
        playMusicAt(0);
      }
    });
    const queue = actionButton('', 'fa-plus', `Añadir ${song.title} a la cola`);
    queue.addEventListener('click', () => {
      musicQueue = [...musicQueue, song];
      renderMusicQueue();
      queue.classList.add('is-added');
      const icon = queue.querySelector('i');
      if (icon) {
        icon.className = 'fa-solid fa-check';
      }
      setTimeout(() => {
        queue.classList.remove('is-added');
        if (icon) {
          icon.className = 'fa-solid fa-plus';
        }
      }, 1_200);
    });
    const liked = musicFavorites.some((favorite) => favorite.id === song.id);
    const favorite = actionButton(
      '',
      'fa-heart',
      liked ? `Quitar de favoritos ${song.title}` : `Añadir a favoritos ${song.title}`,
    );
    favorite.setAttribute('aria-pressed', String(liked));
    const favoriteIcon = favorite.querySelector('i');
    if (favoriteIcon) {
      favoriteIcon.className = `fa-${liked ? 'solid' : 'regular'} fa-heart`;
    }
    favorite.addEventListener('click', () => {
      favorite.disabled = true;
      void window.battly
        .setMusicFavorite(
          { id: song.id, title: song.title, artist: song.artist, thumbnailUrl: song.thumbnailUrl },
          !musicFavorites.some((entry) => entry.id === song.id),
        )
        .then((next) => {
          musicFavorites = [...next];
          const enabled = next.some((entry) => entry.id === song.id);
          favorite.setAttribute('aria-pressed', String(enabled));
          const label = enabled
            ? `Quitar de favoritos ${song.title}`
            : `Añadir a favoritos ${song.title}`;
          favorite.setAttribute('aria-label', label);
          favorite.title = label;
          if (favoriteIcon) {
            favoriteIcon.className = `fa-${enabled ? 'solid' : 'regular'} fa-heart`;
          }
          renderLegacyMusicFavorites();
        })
        .catch(() => {
          const status = document.querySelector<HTMLElement>('[data-music-status]');
          if (status) {
            status.textContent = 'No se pudo actualizar Favoritos. Inténtalo de nuevo.';
          }
        })
        .finally(() => {
          favorite.disabled = false;
        });
    });
    actions.append(play, queue, favorite);
    result.append(image, copy, duration, actions);
    bindSongMenu(result, song);
    list.append(result);
  }
  if (!songs.length) {
    const empty = emptyState('No hay resultados. Prueba con otro artista o título.');
    empty.classList.add('music-search-empty');
    list.append(empty);
  }
  results.append(list);
  results.classList.remove('hide');
  results.classList.add('show');
  overlay?.classList.add('active');
  requestMusicDurations(songs);
}

function musicAudio(): HTMLAudioElement | null {
  return document.querySelector<HTMLAudioElement>('[data-music-audio]');
}

let systemMusicControls: ReturnType<typeof bindSystemMediaControls> | undefined;

function applyMusicVolume(volume = musicAudioSettings.volume): void {
  const normalized = Math.max(0, Math.min(100, volume));
  document
    .querySelectorAll<HTMLAudioElement>('[data-music-audio]')
    .forEach((audio) => (audio.volume = normalized / 100));
}

function musicTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

const musicDurations = new Map<string, number>();
const pendingMusicDurations = new Map<string, MusicSong>();
const resolvingMusicDurations = new Set<string>();
const musicDurationRetryAfter = new Map<string, number>();
const musicRememberedDurations = new Map<string, number>();
let musicDurationBatchRunning = false;
let musicPlaylistDurationSongs: readonly MusicSong[] = [];

function musicSongSeconds(song: MusicSong): number {
  return musicDurations.get(song.id) || song.durationSeconds || 0;
}

function musicSongDuration(song: MusicSong): string {
  const duration = musicSongSeconds(song);
  if (duration > 0) {
    return musicTime(duration);
  }
  return musicDurationRetryAfter.has(song.id) ? 'N/D' : '…';
}

function refreshMusicDurations(): void {
  document.querySelectorAll<HTMLElement>('[data-music-duration-id]').forEach((element) => {
    const id = element.dataset.musicDurationId ?? '';
    const seconds = musicDurations.get(id);
    if (seconds) {
      element.textContent = musicTime(seconds);
      element.title = `Duración: ${musicTime(seconds)}`;
    } else if (musicDurationRetryAfter.has(id)) {
      element.textContent = 'N/D';
      element.title = 'Duración no disponible';
    } else {
      element.textContent = '…';
      element.title = 'Calculando duración…';
    }
  });
  const summary = document.querySelector<HTMLElement>('#playlist-meta-line');
  if (summary && musicPlaylistDurationSongs.length) {
    const known = musicPlaylistDurationSongs.filter((song) => musicSongSeconds(song) > 0);
    const seconds = known.reduce((total, song) => total + musicSongSeconds(song), 0);
    const complete = known.length === musicPlaylistDurationSongs.length;
    const failed = musicPlaylistDurationSongs.some((song) => musicDurationRetryAfter.has(song.id));
    const duration = complete
      ? `${musicTime(seconds)} en total`
      : failed
        ? 'Duración total no disponible'
        : 'Calculando duración total…';
    summary.textContent = `${musicPlaylistDurationSongs.length} canciones · ${duration}`;
  }
}

function requestMusicDurations(songs: readonly MusicSong[]): void {
  for (const song of songs) {
    if (song.durationSeconds > 0) {
      musicDurations.set(song.id, song.durationSeconds);
    }
    if (musicDurations.has(song.id) || resolvingMusicDurations.has(song.id)) {
      continue;
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(song.id)) {
      musicDurationRetryAfter.set(song.id, Number.POSITIVE_INFINITY);
      continue;
    }
    if ((musicDurationRetryAfter.get(song.id) ?? 0) > Date.now()) {
      continue;
    }
    musicDurationRetryAfter.delete(song.id);
    pendingMusicDurations.set(song.id, song);
  }
  refreshMusicDurations();
  if (!musicDurationBatchRunning) {
    void resolvePendingMusicDurations();
  }
}

async function resolvePendingMusicDurations(): Promise<void> {
  musicDurationBatchRunning = true;
  try {
    while (pendingMusicDurations.size) {
      const visible = new Set<string>();
      document.querySelectorAll<HTMLElement>('[data-music-duration-id]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
          visible.add(element.dataset.musicDurationId ?? '');
        }
      });
      const ids = [...pendingMusicDurations.keys()]
        .sort((a, b) => Number(visible.has(b)) - Number(visible.has(a)))
        .slice(0, 8);
      for (const id of ids) {
        pendingMusicDurations.delete(id);
        resolvingMusicDurations.add(id);
      }
      const metadata = await window.battly.resolveMusicMetadata(ids).catch(() => []);
      for (const song of metadata) {
        if (song.durationSeconds > 0) {
          musicDurations.set(song.id, song.durationSeconds);
        }
      }
      for (const id of ids) {
        resolvingMusicDurations.delete(id);
        if (!musicDurations.has(id)) {
          musicDurationRetryAfter.set(id, Date.now() + 15 * 60_000);
        }
      }
      refreshMusicDurations();
    }
  } finally {
    musicDurationBatchRunning = false;
  }
}

function rememberPlayingMusicDuration(): void {
  const audio = musicAudio();
  const id = audio?.dataset.musicPlayingId;
  if (!audio || !id || !Number.isFinite(audio.duration) || audio.duration <= 0) {
    return;
  }
  const seconds = Math.floor(audio.duration);
  if (seconds <= 0 || seconds > 86_400 || musicRememberedDurations.get(id) === seconds) {
    return;
  }
  musicRememberedDurations.set(id, seconds);
  musicDurations.set(id, seconds);
  musicDurationRetryAfter.delete(id);
  refreshMusicDurations();
  void window.battly
    .rememberMusicDuration(id, seconds)
    .catch(() => musicRememberedDurations.delete(id));
  renderMusicProgress();
}

function renderMusicProgress(): void {
  const audio = musicAudio();
  if (!audio) {
    return;
  }
  const duration =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : musicQueue[musicQueueIndex]?.durationSeconds || 0;
  const progress = duration > 0 ? (audio.currentTime / duration) * 100 : 0;
  const bar = document.querySelector<HTMLElement>('[data-music-progress-bar]');
  const current = document.querySelector<HTMLElement>('[data-music-current-time]');
  const total = document.querySelector<HTMLElement>('[data-music-duration]');
  if (bar) {
    bar.style.width = `${progress}%`;
  }
  const seek = document.querySelector<HTMLElement>('[data-music-progress]');
  seek?.setAttribute('aria-valuemin', '0');
  seek?.setAttribute('aria-valuemax', String(duration));
  seek?.setAttribute('aria-valuenow', String(Math.min(duration, audio.currentTime)));
  seek?.setAttribute('aria-valuetext', `${musicTime(audio.currentTime)} / ${musicTime(duration)}`);
  if (current) {
    current.textContent = musicTime(audio.currentTime);
  }
  const song = musicQueue[musicQueueIndex];
  if (total) {
    total.textContent =
      duration > 0 ? musicTime(duration) : song ? musicSongDuration(song) : '0:00';
  }
  const now = Date.now();
  if (song && now - lastMusicPlaybackSync >= 500) {
    lastMusicPlaybackSync = now;
    void window.battly.setMusicPlaybackState({
      artist: song.artist,
      currentTime: audio.currentTime,
      duration,
      playing: !audio.paused,
      thumbnailUrl: song.thumbnailUrl,
      title: song.title,
      ...(musicOverlayEnabled
        ? {
            overlay: {
              accent: getComputedStyle(document.body).getPropertyValue('--theme-color').trim(),
              volume: musicAudioSettings.volume,
              queueIndex: musicQueueIndex,
              queue: musicQueue
                .slice(Math.max(0, musicQueueIndex - 5), Math.max(0, musicQueueIndex - 5) + 50)
                .map((song, offset) => ({
                  index: Math.max(0, musicQueueIndex - 5) + offset,
                  title: song.title,
                  artist: song.artist,
                })),
            },
          }
        : {}),
    });
  }
}

function renderMusicQueue(): void {
  const queue = document.querySelector<HTMLElement>('[data-music-queue]');
  queue?.replaceChildren();
  musicQueue.forEach((song, index) => {
    const row = document.createElement('div');
    row.className = `b-music-queue-item${index === musicQueueIndex ? ' playing' : ''}`;
    row.draggable = true;
    row.dataset.queueIndex = String(index);
    row.tabIndex = 0;
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', song.title);
    const cover = document.createElement('img');
    cover.className = 'b-music-queue-item-img';
    cover.src = song.thumbnailUrl ?? battlyIconUrl;
    cover.alt = song.title;
    const copy = document.createElement('div');
    copy.className = 'b-music-queue-item-info';
    const title = document.createElement('div');
    title.className = 'b-music-queue-item-title';
    setUserText(title, song.title);
    const artist = document.createElement('div');
    artist.className = 'b-music-queue-item-artist';
    setUserText(artist, song.artist, 'Desconocido');
    copy.append(title, artist);
    const duration = document.createElement('span');
    duration.className = 'music-song-duration';
    duration.dataset.musicDurationId = song.id;
    duration.textContent = musicSongDuration(song);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'b-music-queue-item-remove';
    remove.setAttribute('aria-label', 'Quitar de la cola');
    remove.title = 'Quitar de la cola';
    remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
    const removeFromQueue = (): void => {
      const wasPlaying = index === musicQueueIndex;
      musicQueue.splice(index, 1);
      if (musicQueueIndex >= index) {
        musicQueueIndex -= 1;
      }
      if (wasPlaying) {
        if (musicQueue.length) {
          playMusicAt(Math.min(index, musicQueue.length - 1));
        } else {
          const audio = musicAudio();
          audio?.pause();
          audio?.removeAttribute('src');
          audio?.load();
          if (audio) {
            delete audio.dataset.musicPlayingId;
          }
          musicQueueIndex = -1;
          renderMusicNow();
          document
            .querySelectorAll<HTMLElement>('[data-home-music-card], [data-music-mini]')
            .forEach((element) => {
              element.hidden = true;
            });
          document.querySelectorAll('[data-music-play-pause] i').forEach((icon) => {
            icon.className = 'fa-solid fa-play';
          });
          void window.battly.setMusicPlaybackState({
            playing: false,
            title: '',
            artist: '',
            thumbnailUrl: null,
            currentTime: 0,
            duration: 0,
          });
        }
      }
      renderMusicQueue();
    };
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeFromQueue();
    });
    row.append(cover, copy, duration, remove);
    bindSongMenu(row, song);
    row.addEventListener('click', () => playMusicAt(index));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        playMusicAt(index);
      } else if (event.key === 'Delete') {
        removeFromQueue();
      }
    });
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    });
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const source = Number(event.dataTransfer?.getData('text/plain'));
      if (
        !Number.isInteger(source) ||
        source === index ||
        source < 0 ||
        source >= musicQueue.length
      ) {
        return;
      }
      const [moved] = musicQueue.splice(source, 1);
      if (!moved) {
        return;
      }
      musicQueue.splice(index, 0, moved);
      if (musicQueueIndex === source) {
        musicQueueIndex = index;
      } else if (source < musicQueueIndex && index >= musicQueueIndex) {
        musicQueueIndex -= 1;
      } else if (source > musicQueueIndex && index <= musicQueueIndex) {
        musicQueueIndex += 1;
      }
      renderMusicQueue();
    });
    queue?.append(row);
  });
  if (queue && !musicQueue.length) {
    queue.replaceChildren(
      emptyState('No hay canciones en la cola', 'Añade canciones desde una playlist'),
    );
  }
  requestMusicDurations(musicQueue);
  lastMusicPlaybackSync = 0;
  renderMusicProgress();
}

function renderMusicNow(song?: MusicSong, playing = false, state?: string): void {
  if (!song) {
    systemMusicControls?.update();
  }
  document.querySelector('.music-now-art')?.toggleAttribute('data-empty', !song);
  const title = document.querySelector<HTMLElement>('[data-music-now-title]');
  const artist = document.querySelector<HTMLElement>('[data-music-now-artist]');
  const cover = document.querySelector<HTMLImageElement>('[data-music-now-cover]');
  const status = document.querySelector<HTMLElement>('[data-music-now-state]');
  if (title) {
    title.toggleAttribute('data-i18n-dynamic', Boolean(song));
    title.textContent = song?.title ?? 'Tu próxima canción';
  }
  if (artist) {
    artist.toggleAttribute('data-i18n-dynamic', Boolean(song));
    artist.textContent = song?.artist || 'Elige algo que te apetezca escuchar';
  }
  if (cover) {
    cover.src = song?.thumbnailUrl || battlyIconUrl;
    cover.alt = song ? `Portada de ${song.title}` : 'Battly Music';
    cover.onerror = () => {
      cover.onerror = null;
      cover.src = battlyIconUrl;
    };
  }
  if (status) {
    status.textContent = state ?? (song ? (playing ? 'Sonando ahora' : 'En pausa') : 'A tu ritmo');
    status.dataset.playing = String(playing);
  }
}

function notifyMusicState(song: MusicSong, playing: boolean): void {
  systemMusicControls?.update();
  renderMusicNow(song, playing);
  const title = document.querySelector<HTMLElement>('[data-music-mini-title]');
  const artist = document.querySelector<HTMLElement>('[data-music-mini-artist]');
  const cover = document.querySelector<HTMLImageElement>('[data-music-mini-cover]');
  if (title) {
    title.dataset.i18nDynamic = '';
    title.removeAttribute('data-string-id');
    setUserText(title, song.title);
  }
  if (artist) {
    artist.dataset.i18nDynamic = '';
    artist.removeAttribute('data-string-id');
    setUserText(artist, song.artist, 'Artista desconocido');
  }
  if (cover) {
    cover.src = song.thumbnailUrl || battlyIconUrl;
    cover.alt = `Portada de ${song.title}`;
  }
  document.querySelectorAll<HTMLButtonElement>('[data-music-play-pause]').forEach((button) => {
    button.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    const icon = button.querySelector('i');
    if (icon) {
      icon.className = `fa-solid ${playing ? 'fa-pause' : 'fa-play'}`;
    }
  });
  const homeTitle = document.querySelector<HTMLElement>('.music-card strong');
  const homeArtist = document.querySelector<HTMLElement>('.music-card small');
  if (homeTitle) {
    setUserText(homeTitle, song.title);
  }
  if (homeArtist) {
    setUserText(homeArtist, song.artist);
  }
  const legacyHomeCard = document.querySelector<HTMLElement>('[data-home-music-card]');
  if (legacyHomeCard) {
    legacyHomeCard.hidden = !playing;
    const legacyTitle = legacyHomeCard.querySelector<HTMLElement>(
      '.status-servers-playing-song-title',
    );
    const legacyArtist = legacyHomeCard.querySelector<HTMLElement>(
      '.status-servers-playing-song-name',
    );
    if (legacyTitle) {
      setUserText(legacyTitle, song.title);
    }
    if (legacyTitle) {
      legacyTitle.title = song.title;
    }
    if (legacyArtist) {
      setUserText(legacyArtist, song.artist);
    }
    const legacyCover = legacyHomeCard.querySelector<HTMLImageElement>('#music-img');
    if (legacyCover) {
      legacyCover.onerror = () => {
        legacyCover.onerror = null;
        legacyCover.src = battlyIconUrl;
      };
      legacyCover.src = song.thumbnailUrl || battlyIconUrl;
      legacyCover.alt = `Portada de ${song.title}`;
    }
  }
  const audio = musicAudio();
  void window.battly.setMusicPlaybackState({
    playing,
    title: song.title,
    artist: song.artist,
    thumbnailUrl: song.thumbnailUrl,
    currentTime: audio?.currentTime ?? 0,
    duration: audio && Number.isFinite(audio.duration) ? audio.duration : song.durationSeconds,
  });
}

function preloadUpcomingMusic(): void {
  if (musicQueueIndex < 0 || !musicQueue.length) {
    return;
  }
  const amount = musicAudioSettings.aggressivePreload ? 4 : 1;
  for (let offset = 1; offset <= amount; offset += 1) {
    const index = musicQueueIndex + offset;
    const song = musicQueue[index];
    if (!song || musicResolvedSongIds.has(song.id)) {
      continue;
    }
    musicResolvedSongIds.add(song.id);
    void window.battly
      .resolveMusicSource(song.id, musicAudioSettings.quality, song.sourceUrl)
      .then((sourceUrl) => {
        if (musicQueue[index]?.id === song.id) {
          musicQueue[index] = { ...song, sourceUrl };
        }
      })
      .catch(() => musicResolvedSongIds.delete(song.id));
  }
}

let musicPlaybackGeneration = 0;
function playMusicAt(index: number): void {
  const song = musicQueue[index];
  const audio = musicAudio();
  if (!song || !audio) {
    return;
  }
  const generation = ++musicPlaybackGeneration;
  musicQueueIndex = index;
  const current = () =>
    generation === musicPlaybackGeneration && musicQueue[musicQueueIndex]?.id === song.id;
  audio.onerror = null;
  audio.pause();
  delete audio.dataset.musicPlayingId;
  renderMusicQueue();
  document.querySelector<HTMLElement>('[data-music-mini]')?.removeAttribute('hidden');
  notifyMusicState(song, false);
  renderMusicNow(song, false, 'Preparando canción…');
  const qualities = [
    musicAudioSettings.quality,
    ...(['auto', 'medium', 'low', 'high'] as const).filter((q) => q !== musicAudioSettings.quality),
  ];
  const attempts = [
    { quality: qualities[0], refresh: false },
    ...qualities.map((quality) => ({ quality, refresh: true })),
  ];
  let attempt = 0;
  const tryNext = async (): Promise<void> => {
    if (!current()) {
      return;
    }
    const next = attempts[attempt++];
    if (!next) {
      notifyMusicState(song, false);
      renderMusicNow(song, false, 'No se pudo reproducir. Inténtalo de nuevo.');
      return;
    }
    if (next.refresh) {
      renderMusicNow(song, false, 'Probando otra fuente de audio…');
    }
    let failed = false;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (failed || !current()) {
        return;
      }
      failed = true;
      clearTimeout(startTimer);
      console.warn(
        '[Battly Music] Playback retry ' +
          JSON.stringify({
            attempt,
            quality: next.quality,
            mediaError: audio.error?.code ?? null,
            networkState: audio.networkState,
            readyState: audio.readyState,
          }),
      );
      audio.onerror = null;
      void tryNext();
    };
    try {
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      const original =
        !next.refresh && !musicResolvedSongIds.has(song.id) && song.sourceUrl?.startsWith('https:')
          ? song.sourceUrl
          : null;
      const sourceUrl = await window.battly.resolveMusicSource(
        song.id,
        next.quality,
        original,
        next.refresh,
      );
      if (!current() || failed) {
        return;
      }
      musicResolvedSongIds.add(song.id);
      musicQueue[musicQueueIndex] = { ...song, sourceUrl };
      if (musicAudioSettings.normalization || musicAudioSettings.equalizer !== 'flat') {
        audio.crossOrigin = 'anonymous';
        applyMusicAudioProcessing();
      }
      audio.dataset.musicPlayingId = song.id;
      audio.src = sourceUrl;
      audio.onerror = fail;
      // Some CDNs leave play() pending without firing a media error. Give slow
      // connections time to buffer, then refresh automatically instead of hanging.
      startTimer = setTimeout(fail, 30000);
      await audio.play();
      clearTimeout(startTimer);
      if (!current() || failed) {
        return;
      }
      notifyMusicState(song, true);
      void window.battly.recordMusicPlay(song.id).catch(() => undefined);
      preloadUpcomingMusic();
    } catch {
      fail();
    }
  };
  void tryNext();
}

function nextMusic(offset = 1): void {
  if (!musicQueue.length) {
    return;
  }
  playMusicAt((musicQueueIndex + offset + musicQueue.length) % musicQueue.length);
}

function isProbablyExplicitMusic(song: MusicSong): boolean {
  return /(?:\bexplicit\b|\buncensored\b|\b18\+\b|\[e\]|\(e\))/i.test(
    `${song.title} ${song.artist}`,
  );
}

function continueMusicAfterEnded(): void {
  if (musicAudioSettings.repeatTrack && musicQueue[musicQueueIndex]) {
    playMusicAt(musicQueueIndex);
    return;
  }
  if (musicQueueIndex < musicQueue.length - 1) {
    if (musicAudioSettings.smartShuffle && musicQueue.length > 2) {
      const remaining = musicQueue
        .map((_, index) => index)
        .filter((index) => index !== musicQueueIndex);
      playMusicAt(remaining[Math.floor(Math.random() * remaining.length)] ?? musicQueueIndex + 1);
    } else {
      playMusicAt(musicQueueIndex + 1);
    }
    return;
  }
  if (!musicAudioSettings.smartPlayback && !musicAudioSettings.autoQueue) {
    if (musicAudioSettings.repeatQueue) {
      playMusicAt(0);
    } else {
      const song = musicQueue[musicQueueIndex];
      if (song) {
        notifyMusicState(song, false);
      }
    }
    return;
  }
  const candidates = [...musicSnapshot.featured, ...musicFavorites].filter(
    (candidate, index, all) =>
      all.findIndex((entry) => entry.id === candidate.id) === index &&
      !musicQueue.some((queued) => queued.id === candidate.id) &&
      (!musicAudioSettings.explicitFilter || !isProbablyExplicitMusic(candidate)),
  );
  const recommendation = candidates[0];
  if (recommendation) {
    musicQueue = [...musicQueue, recommendation];
    playMusicAt(musicQueue.length - 1);
    return;
  }
  const alternatives = musicQueue
    .map((_, index) => index)
    .filter((index) => index !== musicQueueIndex);
  if (alternatives.length) {
    playMusicAt(alternatives[Math.floor(Math.random() * alternatives.length)] ?? 0);
  } else {
    nextMusic(1);
  }
}

function openMusicTrackDetails(song: MusicSong): void {
  detailedMusicSong = song;
  const dialog = document.querySelector<HTMLDialogElement>('[data-music-track-dialog]');
  const title = dialog?.querySelector<HTMLElement>('[data-music-track-title]');
  const artist = dialog?.querySelector<HTMLElement>('[data-music-track-artist]');
  const duration = dialog?.querySelector<HTMLElement>('[data-music-track-duration]');
  const source = dialog?.querySelector<HTMLElement>('[data-music-track-source]');
  const cover = dialog?.querySelector<HTMLImageElement>('[data-music-track-cover]');
  const favorite = dialog?.querySelector<HTMLButtonElement>('[data-music-track-favorite]');
  const liked = musicFavorites.some((candidate) => candidate.id === song.id);
  if (title) {
    setUserText(title, song.title);
  }
  if (artist) {
    setUserText(artist, song.artist);
  }
  if (duration) {
    setUiText(
      duration,
      song.durationSeconds ? musicTime(song.durationSeconds) : 'Duración variable',
    );
  }
  if (source) {
    setUiText(
      source,
      song.sourceUrl
        ? 'Fuente preparada por Battly Music'
        : 'El audio se preparará de forma segura al reproducir',
    );
  }
  if (cover) {
    cover.onerror = () => {
      cover.onerror = null;
      cover.src = battlyIconUrl;
    };
    cover.src =
      song.thumbnailUrl ??
      document.querySelector<HTMLImageElement>('.status-card img')?.src ??
      battlyIconUrl;
    cover.alt = `Portada de ${song.title}`;
  }
  if (favorite) {
    favorite.innerHTML = /* HTML */ `<i
        class="fa-${liked ? 'solid' : 'regular'} fa-heart"
        aria-hidden="true"
      ></i>
      ${liked ? 'Quitar de Favoritos' : 'Guardar en Favoritos'}`;
    favorite.dataset.enabled = String(liked);
  }
  const status = dialog?.querySelector<HTMLElement>('[data-music-track-status]');
  if (status) {
    status.textContent = '';
  }
  if (!dialog?.open) {
    dialog?.showModal();
  }
}

function setMusicSongFavorite(song: MusicSong, enabled: boolean): void {
  const status = document.querySelector<HTMLElement>('[data-music-status]');
  void window.battly
    .setMusicFavorite(
      {
        id: song.id,
        title: song.title,
        artist: song.artist,
        thumbnailUrl: song.thumbnailUrl,
      },
      enabled,
    )
    .then((favorites) => {
      musicFavorites = [...favorites];
      renderLegacyMusicFavorites();
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudo actualizar Favoritos';
      }
    });
}

function renderLegacyMusicFavorites(): void {
  const list = document.querySelector<HTMLElement>('[data-music-favorites-list]');
  list?.replaceChildren();
  for (const song of musicFavorites) {
    const row = document.createElement('div');
    row.className = 'playlist-song-item';
    row.dataset.songId = song.id;
    bindSongMenu(row, song);
    const cover = document.createElement('img');
    cover.className = 'song-thumbnail';
    cover.src = song.thumbnailUrl ?? battlyIconUrl;
    cover.alt = song.title;
    const copy = document.createElement('div');
    copy.className = 'song-info';
    const title = document.createElement('div');
    title.className = 'song-title';
    setUserText(title, song.title);
    const artist = document.createElement('div');
    artist.className = 'song-artist';
    setUserText(artist, song.artist, 'Desconocido');
    copy.append(title, artist);
    const duration = document.createElement('span');
    duration.className = 'music-song-duration';
    duration.dataset.musicDurationId = song.id;
    duration.textContent = musicSongDuration(song);
    const actions = document.createElement('div');
    actions.className = 'b-music-song-actions';
    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'like-song-btn';
    favorite.setAttribute('aria-label', `Quitar de favoritos ${song.title}`);
    favorite.innerHTML = '<i class="fa-solid fa-heart" aria-hidden="true"></i>';
    favorite.addEventListener('click', () => setMusicSongFavorite(song, false));
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'play-song-btn';
    play.setAttribute('aria-label', `Reproducir ${song.title}`);
    play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    play.addEventListener('click', () => {
      musicQueue = [...musicFavorites];
      playMusicAt(musicQueue.findIndex((candidate) => candidate.id === song.id));
    });
    actions.append(favorite, play);
    row.append(cover, copy, duration, actions);
    list?.append(row);
  }
  if (list && !musicFavorites.length) {
    list.innerHTML = '<p style="color:#b3b3b3">Aún no marcaste ningún like&nbsp;💔</p>';
  }
  requestMusicDurations(musicFavorites);
}

function renderMusicHomePlaylists(playlists: readonly MusicPlaylist[]): void {
  const home = document.querySelector<HTMLElement>('.b-music-panel-inicio');
  if (!home) {
    return;
  }
  let sections = home.querySelector<HTMLElement>('.b-music-home-sections');
  if (!sections) {
    sections = document.createElement('div');
    sections.className = 'b-music-home-sections';
    home.append(sections);
  }
  sections.replaceChildren();
  for (const playlist of playlists) {
    generatedMusicCopy.add(playlist);
    const section = document.createElement('div');
    section.className = 'b-music-section';
    const cards = document.createElement('div');
    cards.className = 'b-music-cards';
    const card = document.createElement('div');
    card.className = 'b-music-playlist-card';
    card.dataset.playlistId = playlist.id;
    bindPlaylistMenu(card, playlist);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    const imageContainer = document.createElement('div');
    imageContainer.className = 'b-music-playlist-card-img-container';
    const image = document.createElement('img');
    image.src = playlist.coverUrl ?? playlist.songs[0]?.thumbnailUrl ?? battlyIconUrl;
    image.alt = playlist.name;
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'b-music-playlist-card-play-btn';
    play.title = 'Reproducir';
    play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    const start = (): void => {
      if (!playlist.songs.length) {
        return;
      }
      musicQueue = [...playlist.songs];
      playMusicAt(0);
    };
    play.addEventListener('click', (event) => {
      event.stopPropagation();
      start();
    });
    card.addEventListener('click', () => openLegacyMusicPlaylist(playlist));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      openLegacyMusicPlaylist(playlist);
    });
    const description = document.createElement('p');
    setMusicPlaylistCopy(description, playlist, 'description');
    imageContainer.append(image, play);
    const playlistTitle = document.createElement('h3');
    setMusicPlaylistCopy(playlistTitle, playlist, 'name');
    card.append(imageContainer, playlistTitle, description);
    cards.append(card);
    section.append(cards);
    sections.append(section);
  }
}

const generatedMusicCopy = new WeakSet<MusicPlaylist>();
let musicPlaylistLabelSequence = 0;
function setMusicPlaylistCopy(
  element: HTMLElement,
  playlist: MusicPlaylist,
  field: 'name' | 'description',
): void {
  if (generatedMusicCopy.has(playlist)) {
    element.removeAttribute('translate');
    element.removeAttribute('data-i18n-dynamic');
    setUiText(element, playlist[field] || 'Sin descripción');
  } else {
    setUserText(element, playlist[field], field === 'description' ? 'Sin descripción' : undefined);
  }
}

function openLegacyMusicPlaylist(playlist: MusicPlaylist): void {
  musicPlaylistDurationSongs = playlist.songs;
  showLegacyMusicSection('b-music-panel-playlist-view');
  const view = document.querySelector<HTMLElement>('.b-music-panel-playlist-view');
  if (!view) {
    return;
  }
  const set = (selector: string, value: string): void => {
    const element = view.querySelector<HTMLElement>(selector);
    if (element) {
      element.textContent = value;
    }
  };
  const playlistName = view.querySelector<HTMLElement>('.playlist-title');
  const playlistDescription = view.querySelector<HTMLElement>('.playlist-description');
  if (playlistName) {
    setMusicPlaylistCopy(playlistName, playlist, 'name');
  }
  if (playlistDescription) {
    setMusicPlaylistCopy(playlistDescription, playlist, 'description');
  }
  set('#playlist-type-label', playlist.canShare ? 'Lista pública' : 'Playlist');
  set('#playlist-meta-line', `${playlist.songs.length} canciones`);
  const cover = view.querySelector<HTMLImageElement>('.playlist-cover');
  if (cover) {
    cover.src = playlist.coverUrl ?? playlist.songs[0]?.thumbnailUrl ?? battlyIconUrl;
    cover.alt = playlist.name;
    if (generatedMusicCopy.has(playlist)) {
      cover.removeAttribute('translate');
    } else {
      cover.setAttribute('translate', 'no');
    }
  }
  const playPlaylist = (): void => {
    musicQueue = [...playlist.songs];
    if (musicQueue.length) {
      playMusicAt(0);
    }
  };
  const play = view.querySelector<HTMLButtonElement>('#playlist-play-btn');
  const coverPlay = view.querySelector<HTMLButtonElement>('.playlist-cover-play-btn');
  if (play) {
    play.onclick = playPlaylist;
  }
  if (coverPlay) {
    coverPlay.onclick = playPlaylist;
  }
  const edit = view.querySelector<HTMLButtonElement>('#playlist-edit-btn');
  if (edit) {
    edit.style.display = playlist.canEditMetadata ? '' : 'none';
    edit.onclick = playlist.canEditMetadata ? () => openMusicPlaylistDialog(playlist) : null;
  }
  const removePlaylist = view.querySelector<HTMLButtonElement>('#playlist-delete-btn');
  if (removePlaylist) {
    removePlaylist.style.display = playlist.canDelete ? '' : 'none';
    removePlaylist.onclick = playlist.canDelete
      ? async () => {
          if (!(await askBattly({ text: `¿Eliminar la playlist ${playlist.name}?` }))) {
            return;
          }
          void window.battly.deleteMusicPlaylist(playlist.id).then(loadMusic);
          showLegacyMusicSection('b-music-panel-playlists');
        }
      : null;
  }
  const share = view.querySelector<HTMLButtonElement>('#playlist-share-btn');
  if (share) {
    share.style.display = playlist.canShare ? '' : 'none';
    share.onclick = playlist.canShare
      ? () => {
          const status = view.querySelector<HTMLElement>('#playlist-share-status');
          if (status) {
            status.textContent = 'Creando enlace seguro…';
          }
          void window.battly
            .shareMusicPlaylist(playlist.id)
            .then(async (result) => {
              await copyTextToClipboard(result.url);
              if (status) {
                status.textContent = '';
              }
              showToast(
                'Enlace copiado',
                'El enlace de la playlist está en el portapapeles.',
                'success',
              );
            })
            .catch(() => {
              if (status) {
                status.textContent = 'No se pudo compartir la playlist';
              }
            });
        }
      : null;
  }
  const collaboration = view.querySelector<HTMLButtonElement>('#playlist-collab-btn');
  if (collaboration) {
    const allowed = playlist.collaborative || playlist.canManageCollaboration;
    collaboration.style.display = allowed ? '' : 'none';
    collaboration.onclick = allowed ? () => openMusicCollaborationDialog(playlist) : null;
  }
  const activity = view.querySelector<HTMLButtonElement>('#playlist-activity-btn');
  if (activity) {
    activity.onclick = () => openMusicCollaborationDialog(playlist, 'activity');
  }

  const songs = view.querySelector<HTMLElement>('.playlist-songs');
  songs?.replaceChildren();
  playlist.songs.forEach((song, index) => {
    const row = document.createElement('div');
    row.className = 'playlist-song-item';
    row.dataset.songId = song.id;
    bindSongMenu(row, song);
    const indexCell = document.createElement('div');
    indexCell.className = 'song-row-index';
    const number = document.createElement('span');
    number.className = 'song-row-index-num';
    number.textContent = String(index + 1);
    const playSong = document.createElement('button');
    playSong.type = 'button';
    playSong.className = 'song-index-play-btn';
    playSong.title = 'Reproducir';
    playSong.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    playSong.addEventListener('click', () => {
      musicQueue = [...playlist.songs];
      playMusicAt(index);
    });
    indexCell.append(number, playSong);
    const main = document.createElement('div');
    main.className = 'song-main-cell';
    const thumbnail = document.createElement('img');
    thumbnail.className = 'song-thumbnail';
    if (index >= 12) {
      thumbnail.loading = 'lazy';
      thumbnail.decoding = 'async';
    }
    thumbnail.src = song.thumbnailUrl ?? battlyIconUrl;
    thumbnail.alt = song.title;
    const copy = document.createElement('div');
    copy.className = 'song-info';
    const title = document.createElement('div');
    title.className = 'song-title';
    setUserText(title, song.title);
    const artist = document.createElement('div');
    artist.className = 'song-artist';
    setUserText(artist, song.artist, 'Desconocido');
    copy.append(title, artist);
    main.append(thumbnail, copy);
    const owner = document.createElement('div');
    owner.className = 'song-col-album';
    setUiText(owner, playlist.collaborative ? 'Colaborador' : 'Propietario');
    const added = document.createElement('div');
    added.className = 'song-col-added';
    added.textContent = '—';
    const duration = document.createElement('div');
    duration.className = 'song-col-duration';
    duration.dataset.musicDurationId = song.id;
    duration.textContent = musicSongDuration(song);
    const actions = document.createElement('div');
    actions.className = 'b-music-song-actions';
    const favorite = document.createElement('button');
    favorite.type = 'button';
    const liked = musicFavorites.some((candidate) => candidate.id === song.id);
    favorite.className = 'like-song-btn';
    favorite.setAttribute(
      'aria-label',
      liked ? `Quitar de favoritos ${song.title}` : `Añadir a favoritos ${song.title}`,
    );
    favorite.innerHTML = `<i class="fa-${liked ? 'solid' : 'regular'} fa-heart" aria-hidden="true"></i>`;
    favorite.addEventListener('click', () => setMusicSongFavorite(song, !liked));
    const queue = document.createElement('button');
    queue.type = 'button';
    queue.className = 'add-to-queue-btn';
    queue.title = 'Añadir a la cola';
    queue.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
    queue.addEventListener('click', () => {
      musicQueue = [...musicQueue, song];
      renderMusicQueue();
    });
    actions.append(favorite, queue);
    if (playlist.canEditSongs) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-song-btn';
      remove.title = 'Quitar de la playlist';
      remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      remove.addEventListener('click', () => {
        void window.battly
          .updateMusicPlaylistSongs(
            playlist.id,
            playlist.songs
              .filter((candidate) => candidate.id !== song.id)
              .map((candidate) => candidate.id),
          )
          .then((updated) => {
            musicSnapshot = {
              ...musicSnapshot,
              playlists: musicSnapshot.playlists.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            };
            openLegacyMusicPlaylist(updated);
          });
      });
      actions.append(remove);
    }
    row.append(indexCell, main, owner, added, duration, actions);
    songs?.append(row);
  });
  requestMusicDurations(playlist.songs);
}

function setMusicSpotlightCover(image: HTMLImageElement, track: MusicSong | undefined): void {
  // YouTube can return a tiny placeholder with HTTP 200 when a size is absent.
  const candidates =
    track && /^[A-Za-z0-9_-]{11}$/.test(track.id)
      ? ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault'].map(
          (size) => `https://i.ytimg.com/vi/${track.id}/${size}.jpg`,
        )
      : [];
  if (track?.thumbnailUrl && !candidates.includes(track.thumbnailUrl)) {
    candidates.push(track.thumbnailUrl);
  }
  candidates.push(battlyIconUrl);
  let index = 0;
  const advance = (): void => {
    if (index >= candidates.length) {
      image.onload = null;
      image.onerror = null;
      return;
    }
    image.src = candidates[index++];
  };
  image.onload = () => {
    if (image.naturalWidth <= 120 && index < candidates.length) {
      advance();
    } else {
      image.onload = null;
      image.onerror = null;
    }
  };
  image.onerror = advance;
  image.fetchPriority = 'high';
  advance();
}

function renderMusicLibrary(snapshot: MusicSnapshot): void {
  musicSnapshot = snapshot;
  const spotlight = document.querySelector<HTMLButtonElement>('[data-music-spotlight]');
  const featuredSong = snapshot.promotedSong ?? snapshot.featured[0];
  if (spotlight) {
    spotlight.hidden = !featuredSong;
    spotlight.setAttribute(
      'aria-label',
      featuredSong ? `Reproducir ${featuredSong.title}` : 'Reproducir',
    );
  }
  const spotlightCover = document.querySelector<HTMLImageElement>('[data-music-spotlight-cover]');
  if (spotlightCover) {
    setMusicSpotlightCover(spotlightCover, featuredSong);
    spotlightCover.alt = featuredSong ? `Portada de ${featuredSong.title}` : '';
  }
  const spotlightTitle = document.querySelector<HTMLElement>('[data-music-spotlight-title]');
  const spotlightArtist = document.querySelector<HTMLElement>('[data-music-spotlight-artist]');
  const spotlightCount = document.querySelector<HTMLElement>('[data-music-spotlight-count]');
  const libraryCount = document.querySelector<HTMLElement>('[data-music-library-count]');
  if (spotlightTitle) {
    spotlightTitle.textContent = featuredSong?.title ?? '';
  }
  if (spotlightArtist) {
    spotlightArtist.textContent = featuredSong?.artist || 'Artista desconocido';
  }
  if (spotlightCount) {
    if (snapshot.promotedSong) {
      setUiText(spotlightCount, 'Promocionado');
    } else {
      spotlightCount.textContent =
        snapshot.featured.length === 1
          ? `${snapshot.featured.length} canción`
          : `${snapshot.featured.length} canciones`;
    }
  }
  if (libraryCount) {
    libraryCount.textContent =
      snapshot.playlists.length === 1
        ? `${snapshot.playlists.length} playlist`
        : `${snapshot.playlists.length} playlists`;
  }
  if (!musicQueue[musicQueueIndex]) {
    renderMusicNow();
  }
  const recent = document.querySelector<HTMLElement>('[data-music-tracks]');
  recent?.replaceChildren();
  snapshot.featured.forEach((song, index) => {
    if (!recent) {
      return;
    }
    const card = document.createElement('div');
    card.className = 'b-music-recent-item';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Reproducir ${song.title}`);
    const image = document.createElement('img');
    image.src = song.thumbnailUrl ?? battlyIconUrl;
    image.alt = song.title;
    const copy = document.createElement('div');
    copy.className = 'music-track-copy';
    const title = document.createElement('span');
    title.className = 'music-track-title';
    setUserText(title, song.title);
    const artist = document.createElement('span');
    artist.className = 'music-track-artist';
    setUserText(artist, song.artist, 'Artista desconocido');
    copy.append(title, artist);
    const duration = document.createElement('span');
    duration.className = 'music-track-duration';
    duration.dataset.musicDurationId = song.id;
    duration.textContent = musicSongDuration(song);
    const playIcon = document.createElement('i');
    playIcon.className = 'fa-solid fa-play music-track-play';
    playIcon.setAttribute('aria-hidden', 'true');
    const play = (): void => {
      musicQueue = [...snapshot.featured];
      playMusicAt(index);
    };
    card.addEventListener('click', play);
    card.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        openMusicTrackDetails(song);
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      play();
    });
    card.append(image, copy, duration, playIcon);
    bindSongMenu(card, song);
    recent.append(card);
  });
  if (recent && !snapshot.featured.length) {
    const empty = document.createElement('p');
    empty.className = 'music-track-empty';
    empty.textContent = 'Aún no hay canciones aquí. Busca un artista o una canción para empezar.';
    recent.append(empty);
  }
  renderMusicHomePlaylists(snapshot.homePlaylists ?? []);
  renderLegacyMusicFavorites();
  const cache = document.querySelector<HTMLElement>('[data-music-cache]');
  if (cache) {
    cache.textContent = snapshot.fromCache ? 'Modo sin conexión' : '';
  }
  const playlists = document.querySelector<HTMLElement>('[data-music-playlists]');
  const generated = document.querySelector<HTMLElement>('[data-music-generated]');
  generated?.replaceChildren();
  playlists?.replaceChildren();
  const collections: readonly MusicPlaylist[] = snapshot.playlists;
  const generatedCollections: readonly MusicPlaylist[] = (
    snapshot.homePlaylists?.length
      ? []
      : buildGeneratedMusicCollections(snapshot.featured, musicFavorites)
  ).map((collection) => ({
    ...collection,
    coverUrl: collection.songs[0]?.thumbnailUrl ?? null,
    collaborative: false,
    canDelete: false,
    canEditMetadata: false,
    canEditSongs: false,
    canShare: false,
    canManageCollaboration: false,
  }));
  const playlistTargets = [
    ...generatedCollections.map((playlist) => ({ playlist, target: generated })),
    ...collections.map((playlist) => ({ playlist, target: playlists })),
  ];
  generatedCollections.forEach((playlist) => generatedMusicCopy.add(playlist));
  for (const { playlist, target } of playlistTargets) {
    const card = document.createElement('div');
    card.className = 'b-music-playlist-card';
    card.dataset.musicPlaylistId = playlist.id;
    bindPlaylistMenu(card, playlist);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Abrir ${playlist.name}`);
    const coverWrap = document.createElement('div');
    coverWrap.className = 'b-music-playlist-card-img-container';
    const cover = document.createElement('img');
    cover.src = playlist.coverUrl ?? playlist.songs[0]?.thumbnailUrl ?? battlyIconUrl;
    cover.alt = playlist.name;
    if (!generatedMusicCopy.has(playlist)) {
      cover.setAttribute('translate', 'no');
    }
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'b-music-playlist-card-play-btn';
    play.title = 'Reproducir';
    play.setAttribute('aria-label', 'Reproducir');
    play.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
    play.addEventListener('click', (event) => {
      event.stopPropagation();
      musicQueue = [...playlist.songs];
      if (musicQueue.length) {
        playMusicAt(0);
      }
    });
    coverWrap.append(cover, play);
    const description = document.createElement('p');
    setMusicPlaylistCopy(description, playlist, 'description');
    const title = document.createElement('h3');
    setMusicPlaylistCopy(title, playlist, 'name');
    title.id = `music-playlist-label-${++musicPlaylistLabelSequence}`;
    card.removeAttribute('aria-label');
    card.setAttribute('aria-labelledby', title.id);
    play.setAttribute('aria-describedby', title.id);
    card.append(coverWrap, title, description);
    const open = (): void => {
      openLegacyMusicPlaylist(playlist);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    target?.append(card);
  }
  const status = document.querySelector<HTMLElement>('[data-music-status]');
  if (status) {
    status.textContent = '';
  }
  requestMusicDurations(snapshot.featured);
}

function openMusicPlaylistDialog(
  playlist: MusicPlaylist | null,
  selection: readonly MusicSong[] | null = null,
): void {
  playlistDraftSongs = selection;
  editingMusicPlaylist = playlist;
  const dialog = document.querySelector<HTMLDialogElement>('[data-music-playlist-dialog]');
  const form = dialog?.querySelector<HTMLFormElement>('[data-music-playlist-form]');
  const title = dialog?.querySelector<HTMLElement>('[data-music-playlist-title]');
  const submit = dialog?.querySelector<HTMLButtonElement>('[data-music-playlist-submit]');
  const status = dialog?.querySelector<HTMLElement>('[data-music-playlist-status]');
  form?.reset();
  if (form) {
    const name = form.elements.namedItem('name');
    const description = form.elements.namedItem('description');
    if (name instanceof HTMLInputElement) {
      name.value = playlist?.name ?? '';
    }
    if (description instanceof HTMLInputElement) {
      description.value = playlist?.description ?? '';
    }
  }
  if (title) {
    title.textContent = playlist ? 'Editar playlist' : 'Nueva playlist';
  }
  if (submit) {
    submit.textContent = playlist
      ? 'Guardar cambios'
      : selection
        ? selection.length === 1
          ? 'Crear con una canción'
          : `Crear con ${selection.length} canciones`
        : 'Crear con la cola';
  }
  if (status) {
    status.textContent = '';
  }
  dialog?.showModal();
}

let activeCollaborationPlaylist: MusicPlaylist | null = null;

function musicActivityLabel(action: string): string {
  const labels: Record<string, string> = {
    song_added: 'Canción añadida',
    song_removed: 'Canción eliminada',
    invite_sent: 'Invitación enviada',
    invite_cancelled: 'Invitación cancelada',
    invite_accepted: 'Invitación aceptada',
    invite_rejected: 'Invitación rechazada',
    collaborator_removed: 'Colaborador eliminado',
    playlist_created: 'Playlist creada',
  };
  return labels[action] || 'Actividad de la playlist';
}

function musicCollaborationRow(
  label: string,
  metadata: string,
  action?: { readonly label: string; readonly run: () => Promise<void> },
  activityLabel?: string,
): HTMLElement {
  const row = document.createElement('article');
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  setUserText(title, label);
  const detail = document.createElement('small');
  if (activityLabel) {
    const kind = document.createElement('span');
    setUiText(kind, activityLabel);
    detail.append(kind);
    if (metadata) {
      const date = document.createElement('time');
      setUserText(date, ` · ${metadata}`);
      detail.append(date);
    }
  } else {
    setUiText(detail, metadata);
  }
  copy.append(title, detail);
  row.append(copy);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      button.disabled = true;
      void action
        .run()
        .then(
          () =>
            activeCollaborationPlaylist &&
            openMusicCollaborationDialog(activeCollaborationPlaylist),
        )
        .catch(() => {
          button.disabled = false;
          const status = document.querySelector<HTMLElement>('[data-music-collaboration-status]');
          if (status) {
            status.textContent = 'No se pudo completar la acción';
          }
        });
    });
    row.append(button);
  }
  return row;
}

function openMusicCollaborationDialog(
  playlist: MusicPlaylist,
  selectedTab: 'members' | 'activity' = 'members',
): void {
  activeCollaborationPlaylist = playlist;
  const dialog = document.querySelector<HTMLDialogElement>('[data-music-collaboration-dialog]');
  const title = dialog?.querySelector<HTMLElement>('[data-music-collaboration-title]');
  const owner = dialog?.querySelector<HTMLElement>('[data-music-collaboration-owner]');
  const status = dialog?.querySelector<HTMLElement>('[data-music-collaboration-status]');
  const collaborators = dialog?.querySelector<HTMLElement>('[data-music-collaborators]');
  const pending = dialog?.querySelector<HTMLElement>('[data-music-pending-invites]');
  const activityList = dialog?.querySelector<HTMLElement>('[data-music-activity]');
  const inviteForm = dialog?.querySelector<HTMLFormElement>('[data-music-collaboration-invite]');
  if (title) {
    title.textContent = `Colaboración · ${playlist.name}`;
  }
  if (status) {
    status.textContent = 'Cargando miembros y actividad…';
  }
  collaborators?.replaceChildren();
  pending?.replaceChildren();
  activityList?.replaceChildren();
  if (!dialog?.open) {
    dialog?.showModal();
  }
  const selectTab = (tab: 'members' | 'activity'): void => {
    dialog
      ?.querySelectorAll<HTMLElement>('[data-music-collaboration-section]')
      .forEach((section) => {
        section.hidden = section.dataset.musicCollaborationSection !== tab;
      });
    dialog
      ?.querySelectorAll<HTMLButtonElement>('[data-music-collaboration-tab]')
      .forEach((button) => {
        button.classList.toggle('is-active', button.dataset.musicCollaborationTab === tab);
      });
    if (inviteForm) {
      inviteForm.hidden = tab === 'activity';
    }
  };
  dialog
    ?.querySelectorAll<HTMLButtonElement>('[data-music-collaboration-tab]')
    .forEach((button) => {
      button.onclick = () =>
        selectTab(button.dataset.musicCollaborationTab === 'activity' ? 'activity' : 'members');
    });
  selectTab(selectedTab);
  void Promise.all([
    window.battly.getMusicPlaylistCollaboration(playlist.id),
    window.battly.getMusicPlaylistActivity(playlist.id),
  ])
    .then(([collaboration, activity]) => {
      if (owner) {
        owner.textContent = `Propietario: ${collaboration.ownerUsername} · ${collaboration.collaborators.length}/${collaboration.maxCollaborators} editores`;
      }
      if (inviteForm) {
        inviteForm.hidden = selectedTab === 'activity' || !collaboration.canManage;
      }
      for (const member of collaboration.collaborators) {
        collaborators?.append(
          musicCollaborationRow(
            member.username,
            member.addedAt ? new Date(member.addedAt).toLocaleDateString(uiLocale()) : 'Editor',
            collaboration.canManage
              ? {
                  label: 'Retirar',
                  run: () => window.battly.removeMusicPlaylistCollaborator(playlist.id, member.id),
                }
              : undefined,
          ),
        );
      }
      for (const invite of collaboration.pendingInvites) {
        pending?.append(
          musicCollaborationRow(
            invite.username,
            invite.expiresAt
              ? `Expira ${new Date(invite.expiresAt).toLocaleDateString(uiLocale())}`
              : 'Pendiente',
            collaboration.canManage
              ? {
                  label: 'Cancelar',
                  run: () => window.battly.cancelMusicPlaylistInvite(playlist.id, invite.id),
                }
              : undefined,
          ),
        );
      }
      for (const entry of activity) {
        activityList?.append(
          musicCollaborationRow(
            entry.actorUsername,
            entry.createdAt ? new Date(entry.createdAt).toLocaleString(uiLocale()) : '',
            undefined,
            musicActivityLabel(entry.action),
          ),
        );
      }
      if (collaborators && !collaboration.collaborators.length) {
        collaborators.textContent = 'Sin editores';
      }
      if (pending && !collaboration.pendingInvites.length) {
        pending.textContent = 'Sin invitaciones';
      }
      if (activityList && !activity.length) {
        activityList.textContent = 'Sin actividad reciente';
      }
      if (status) {
        status.textContent = '';
      }
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudo cargar la colaboración';
      }
    });
}

function loadMusic(): void {
  const status = document.querySelector<HTMLElement>('[data-music-status]');
  if (status) {
    status.textContent = 'Cargando Battly Music…';
  }
  status?.setAttribute('aria-busy', 'true');
  void Promise.all([window.battly.getMusic(), window.battly.getMusicFavorites().catch(() => [])])
    .then(([snapshot, favorites]) => {
      musicFavorites = [...favorites];
      renderMusicLibrary(snapshot);
    })
    .catch(() => {
      if (status) {
        status.textContent = 'No se pudo cargar Battly Music';
      }
    })
    .finally(() => status?.setAttribute('aria-busy', 'false'));
}

function musicInviteButton(
  label: string,
  inviteId: string,
  action: 'accept' | 'reject',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = `button is-small ${action === 'accept' ? 'is-success' : 'is-dark'} is-light`;
  button.addEventListener(
    'click',
    () =>
      void window.battly.respondMusicInvite(inviteId, action).then(() => {
        musicInviteRefresh.invalidate();
        loadMusicInvites();
      }),
  );
  return button;
}

function loadMusicInvites(): void {
  const list = document.querySelector<HTMLElement>('[data-music-invites-list]');
  if (list) {
    list.textContent = 'Cargando…';
  }
  void musicInviteRefresh
    .refresh(true)
    .then((invites) => {
      if (!invites) {
        return;
      }
      list?.replaceChildren();
      for (const invite of invites) {
        const row = document.createElement('div');
        row.className = 'collab-invite-card';
        row.dataset.inviteId = invite.id;
        const content = document.createElement('div');
        content.className = 'collab-invite-row';
        const icon = document.createElement('span');
        icon.className = 'collab-invite-icon';
        icon.innerHTML = '<i class="fa-solid fa-user-plus" aria-hidden="true"></i>';
        const copy = document.createElement('div');
        copy.className = 'collab-invite-text';
        const title = document.createElement('div');
        title.className = 'collab-invite-main';
        title.textContent = invite.playlistName || 'Playlist';
        const meta = document.createElement('div');
        meta.className = 'collab-invite-meta';
        meta.textContent = `${invite.ownerUsername || 'Un amigo'} te invitó`;
        copy.append(title, meta);
        const actions = document.createElement('div');
        actions.className = 'collab-invite-actions';
        actions.append(
          musicInviteButton('Aceptar', invite.id, 'accept'),
          musicInviteButton('Rechazar', invite.id, 'reject'),
        );
        content.append(icon, copy, actions);
        row.append(content);
        list?.append(row);
      }
      if (list && !invites.length) {
        const empty = document.createElement('div');
        empty.className = 'collab-invite-card';
        empty.innerHTML = /* HTML */ ` <div class="collab-invite-main">
            No tienes invitaciones pendientes
          </div>
          <div class="collab-invite-meta">
            Cuando alguien te invite, aparecerá aquí automáticamente.
          </div>`;
        list.append(empty);
      }
    })
    .catch(() => {
      if (list) {
        setUiText(list, 'No se pudo cargar la colaboración');
      }
    });
}

type MusicImportSource = 'battly' | 'spotify' | 'youtube';

function createLegacyMusicModal(body: string): HTMLDivElement {
  document.querySelector('[data-music-import-modal]')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal is-active';
  modal.dataset.musicImportModal = '';
  modal.innerHTML = /* HTML */ ` <div class="modal-background"></div>
    <div class="modal-card modal-animated">
      <section class="modal-card-body">${body}</section>
    </div>`;
  document.body.append(modal);
  return modal;
}

function chooseMusicImportSource(): Promise<MusicImportSource | null> {
  const modal = createLegacyMusicModal(
    /* HTML */ ` <h1 style="margin:0 0 12px;color:#fff;font-size:30px;font-weight:700">
        Importar playlists
      </h1>
      <div style="display:flex;flex-direction:column;gap:12px;text-align:left">
        <p style="margin:0;color:rgba(255,255,255,.82);font-size:14px;font-weight:600">
          Selecciona el origen de la playlist:
        </p>
        <div class="import-source-grid">
          <label class="import-source-card">
            <input
              class="import-source-radio"
              type="radio"
              name="import-source"
              value="battly"
              checked
            />
            <span class="import-source-card-box"
              ><div class="import-source-icon"><i class="fa-solid fa-link"></i></div>
              <p class="import-source-title">Battly</p>
              <p class="import-source-desc">
                Importa una playlist compartida con un enlace o token de Battly. Compatible con
                playlists públicas y privadas compartidas.
              </p></span
            >
          </label>
          <label class="import-source-card">
            <input
              class="import-source-radio"
              type="radio"
              name="import-source"
              value="youtube"
            />
            <span class="import-source-card-box"
              ><div class="import-source-icon"><i class="fa-brands fa-youtube"></i></div>
              <p class="import-source-title">YouTube</p>
              <p class="import-source-desc">
                Importa cualquier playlist pública de YouTube. Se importan título, artista y
                miniaturas automáticamente.
              </p></span
            >
          </label>
          <label class="import-source-card">
            <input
              class="import-source-radio"
              type="radio"
              name="import-source"
              value="spotify"
            />
            <span class="import-source-card-box"
              ><div class="import-source-icon"><i class="fa-brands fa-spotify"></i></div>
              <p class="import-source-title">Spotify</p>
              <p class="import-source-desc">
                Importa tus playlists de Spotify a Battly Music.
                <b>Requiere una suscripción activa a Battly+ para usar esta integración.</b>
              </p></span
            >
          </label>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
          <button
            type="button"
            class="button is-danger is-outlined cancel-btn"
            data-import-cancel
          >
            Cancelar
          </button>
          <button
            type="button"
            class="button is-info is-outlined confirm-btn"
            data-import-confirm
          >
            Continuar
          </button>
        </div>
      </div>`,
  );
  return new Promise((resolve) => {
    const finish = (value: MusicImportSource | null): void => {
      modal.remove();
      resolve(value);
    };
    modal.querySelector('[data-import-cancel]')?.addEventListener('click', () => finish(null));
    modal.querySelector('.modal-background')?.addEventListener('click', () => finish(null));
    modal.querySelector('[data-import-confirm]')?.addEventListener('click', () => {
      const selected = modal.querySelector<HTMLInputElement>('input[name="import-source"]:checked');
      const value = selected?.value;
      finish(value === 'youtube' || value === 'spotify' ? value : 'battly');
    });
  });
}

function promptLegacyMusicImport(
  title: string,
  placeholder: string,
  initialValue = '',
): Promise<string | null> {
  const modal = createLegacyMusicModal(
    /* HTML */ ` <h1
        class="title is-4"
        style="margin-bottom:10px;color:#fff"
      ></h1>
      <input
        class="input"
        type="text"
      />
      <br /><br />
      <div style="gap:5px;display:flex;justify-content:flex-end">
        <button
          type="button"
          class="button is-danger is-outlined"
          data-import-cancel
        >
          Cancelar
        </button>
        <button
          type="button"
          class="button is-info is-outlined"
          data-import-confirm
        >
          Importar
        </button>
      </div>`,
  );
  const heading = modal.querySelector<HTMLElement>('h1');
  const input = modal.querySelector<HTMLInputElement>('input');
  if (heading) {
    heading.textContent = title;
  }
  if (input) {
    input.placeholder = placeholder;
    input.value = initialValue;
  }
  return new Promise((resolve) => {
    const finish = (value: string | null): void => {
      modal.remove();
      resolve(value);
    };
    modal.querySelector('[data-import-cancel]')?.addEventListener('click', () => finish(null));
    modal.querySelector('.modal-background')?.addEventListener('click', () => finish(null));
    modal.querySelector('[data-import-confirm]')?.addEventListener('click', () => {
      const value = input?.value.trim() ?? '';
      if (!value) {
        input?.classList.add('is-danger');
        return;
      }
      finish(value);
    });
    input?.focus();
  });
}

function sharedMusicToken(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/(?:shared\/playlist|api\/public\/playlist)\/([^/?#]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // A raw share token is also accepted.
  }
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function showImportedMusicActions(imported: MusicPlaylistImport): void {
  const actionModal = createLegacyMusicModal(
    /* HTML */ ` <div class="has-text-centered">
      <h1
        class="title is-4"
        style="color:#fff"
      >
        ¿Qué hacer con las canciones?
      </h1>
      <br />
      <div class="buttons is-centered">
        <button
          type="button"
          class="button is-primary"
          data-import-create
        >
          Crear playlist
        </button>
        <button
          type="button"
          class="button is-link"
          data-import-queue
        >
          Añadir a la cola
        </button>
      </div>
    </div>`,
  );
  actionModal.querySelector('[data-import-queue]')?.addEventListener('click', () => {
    musicQueue = [...musicQueue, ...imported.songs];
    renderMusicQueue();
    actionModal.remove();
    document
      .querySelector<HTMLElement>('[data-music-queue]')
      ?.closest('.b-music-queue-panel')
      ?.classList.add('active');
  });
  actionModal.querySelector('[data-import-create]')?.addEventListener('click', () => {
    actionModal.remove();
    void promptLegacyMusicImport('Crear playlist', 'Nombre de la playlist', imported.title).then(
      (name) => {
        if (!name) {
          return;
        }
        const status = document.querySelector<HTMLElement>('[data-music-status]');
        if (status) {
          status.textContent = 'Creando playlist…';
        }
        void window.battly
          .createMusicPlaylist({
            name,
            description: '',
            songs: imported.songs.map((song) => song.id),
          })
          .then(() => {
            loadMusic();
            showLegacyMusicSection('b-music-panel-playlists');
          })
          .catch(() => {
            if (status) {
              status.textContent = 'No se pudo crear la playlist';
            }
          });
      },
    );
  });
}

function createMusicImportProgress(title: string): {
  readonly modal: HTMLElement;
  readonly finish: () => void;
  readonly set: (value: number, text?: string) => void;
} {
  const modal = createLegacyMusicModal(
    /* HTML */ ` <div
      class="downloading-mod-modal-card-body has-text-centered music-import-progress"
    >
      <h1 class="h1-download-mod-title"></h1>
      <br />
      <div class="loader"></div>
      <br />
      <div
        class="music-import-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
      >
        <span></span>
      </div>
      <p data-music-import-progress-text>Preparando… 0%</p>
    </div>`,
  );
  const heading = modal.querySelector<HTMLElement>('.h1-download-mod-title');
  const track = modal.querySelector<HTMLElement>('.music-import-progress-track');
  const bar = track?.querySelector<HTMLElement>('span');
  const text = modal.querySelector<HTMLElement>('[data-music-import-progress-text]');
  if (heading) {
    heading.textContent = title;
  }
  let displayed = 0;
  let animationFrame = 0;
  const render = (value: number): void => {
    displayed = Math.max(0, Math.min(100, value));
    const rounded = Math.round(displayed);
    if (bar) {
      bar.style.width = `${rounded}%`;
    }
    track?.setAttribute('aria-valuenow', String(rounded));
  };
  const animateTo = (target: number): void => {
    window.cancelAnimationFrame(animationFrame);
    const from = displayed;
    const startedAt = performance.now();
    const duration = 5_000;
    const frame = (now: number): void => {
      const fraction = Math.min(1, (now - startedAt) / duration);
      render(from + (target - from) * fraction);
      if (fraction < 1) {
        animationFrame = window.requestAnimationFrame(frame);
      }
    };
    animationFrame = window.requestAnimationFrame(frame);
  };
  return {
    modal,
    set(value, label) {
      const target = Math.max(0, Math.min(100, value));
      animateTo(target);
      if (text) {
        text.textContent = label ?? `${Math.round(target)}%`;
      }
    },
    finish() {
      window.cancelAnimationFrame(animationFrame);
      render(100);
      modal.remove();
    },
  };
}

async function openMusicImportFlow(): Promise<void> {
  const source = await chooseMusicImportSource();
  if (!source) {
    return;
  }
  if (source === 'spotify') {
    // The API validates Battly+ using the Battly identity resolved by the main process.
    // The selected game account and cached premium flag can differ from that identity.
    const playlistUrl = await promptLegacyMusicImport(
      'Importar playlist de Spotify',
      'Introduce la URL de la playlist de Spotify',
    );
    if (!playlistUrl) {
      return;
    }
    const progress = createMusicImportProgress('Convirtiendo');
    const unsubscribe = window.battly.onSpotifyMusicProgress((value) => {
      const normalized = Math.max(0, Math.min(100, Math.round(value)));
      progress.set(normalized, `Convirtiendo canciones… ${normalized}%`);
    });
    try {
      const imported = await window.battly.getSpotifyMusicPlaylist(playlistUrl);
      progress.finish();
      showImportedMusicActions(imported);
    } catch (error) {
      progress.finish();
      const status = document.querySelector<HTMLElement>('[data-music-status]');
      if (status) {
        status.textContent =
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
            : 'No se pudo importar la playlist de Spotify';
      }
    } finally {
      unsubscribe();
    }
    return;
  }
  if (source === 'youtube') {
    const playlistUrl = await promptLegacyMusicImport(
      'Importar Playlist de YouTube',
      'Ingresa la URL de la playlist de YouTube',
    );
    if (!playlistUrl) {
      return;
    }
    const progress = createMusicImportProgress('Obteniendo canciones');
    let youtubeProgress = 8;
    progress.set(youtubeProgress, 'Conectando con YouTube…');
    const youtubeTimer = window.setInterval(() => {
      youtubeProgress = Math.min(90, youtubeProgress + Math.max(1, (90 - youtubeProgress) * 0.08));
      progress.set(youtubeProgress, `Obteniendo canciones… ${Math.round(youtubeProgress)}%`);
    }, 350);
    try {
      const imported = await window.battly.getYouTubeMusicPlaylist(playlistUrl);
      showImportedMusicActions(imported);
    } catch (error) {
      showToast(
        'Battly Music',
        userErrorMessage(error, 'No se pudo importar la playlist de YouTube'),
        'error',
      );
    } finally {
      window.clearInterval(youtubeTimer);
      progress.finish();
    }
    return;
  }
  const shareValue = await promptLegacyMusicImport(
    'Importar playlist compartida',
    'https://.../shared/playlist/xxxxx o token',
  );
  if (!shareValue) {
    return;
  }
  const token = sharedMusicToken(shareValue);
  if (!token) {
    const status = document.querySelector<HTMLElement>('[data-music-status]');
    if (status) {
      status.textContent = 'No se pudo reconocer el enlace compartido';
    }
    return;
  }
  const status = document.querySelector<HTMLElement>('[data-music-status]');
  if (status) {
    status.textContent = 'Importando playlist…';
  }
  try {
    await window.battly.importSharedMusicPlaylist(token);
    loadMusic();
    showLegacyMusicSection('b-music-panel-playlists');
  } catch {
    if (status) {
      status.textContent = 'No se pudo importar la playlist compartida';
    }
  }
}

function bindMusic(): void {
  if (musicOverlayEnabled) {
    const overlayButton = document.createElement('button');
    overlayButton.type = 'button';
    overlayButton.className = 'music-button music-button-quiet';
    overlayButton.textContent = 'Ctrl + M';
    overlayButton.title = 'Battly Music';
    overlayButton.addEventListener(
      'click',
      () => void window.battly.musicOverlayCommand({ type: 'open' }),
    );
    document.querySelector('.music-workspace-toolbar')?.append(overlayButton);
    window.battly.onMusicOverlayControl((command) => {
      const audio = musicAudio();
      if (command.type === 'seek' && audio && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, command.value);
      } else if (command.type === 'volume') {
        musicAudioSettings = { ...musicAudioSettings, volume: command.value };
        privateStorage.setItem(musicAudioSettingsKey, JSON.stringify(musicAudioSettings));
        const input = document.querySelector<HTMLInputElement>('[data-music-volume]');
        if (input) {
          input.value = String(command.value);
        }
        applyMusicVolume();
      } else if (command.type === 'queue' && command.index < musicQueue.length) {
        playMusicAt(command.index);
      }
      lastMusicPlaybackSync = 0;
      renderMusicProgress();
    });
  }
  renderMusicInviteBadges(0);
  const refreshInvites = (): void => {
    if (document.visibilityState === 'visible') {
      void musicInviteRefresh.refresh().catch(() => {});
    }
  };
  const invitesTimer = window.setInterval(refreshInvites, 60_000);
  document.addEventListener('visibilitychange', refreshInvites);
  window.addEventListener(
    'beforeunload',
    () => {
      clearInterval(invitesTimer);
      document.removeEventListener('visibilitychange', refreshInvites);
    },
    { once: true },
  );
  document
    .querySelector('[data-panel-view="home"]')
    ?.addEventListener('battly:panel-enter', refreshInvites);
  document
    .querySelector('[data-panel-view="music"]')
    ?.addEventListener('battly:panel-enter', refreshInvites);
  renderMusicNow();
  const searchResults = document.querySelector<HTMLElement>('.b-music-search-results');
  const searchOverlay = document.createElement('div');
  searchOverlay.className = 'b-music-search-overlay';
  const workspace = document.querySelector<HTMLElement>('.music-workspace');
  if (searchResults && workspace) {
    workspace.insertBefore(searchResults, workspace.querySelector('.b-music-panel'));
  }
  const selectMusic = document.createElement('button');
  selectMusic.type = 'button';
  selectMusic.className = 'music-button music-button-quiet';
  selectMusic.innerHTML =
    '<i class="fa-solid fa-list-check" aria-hidden="true"></i> Seleccionar música';
  selectMusic.setAttribute('aria-pressed', 'false');
  selectMusic.addEventListener('click', () => {
    const active = toggleMusicSelection();
    selectMusic.setAttribute('aria-pressed', String(active));
    selectMusic.innerHTML = /* HTML */ `<i
        class="fa-solid ${active ? 'fa-check' : 'fa-list-check'}"
        aria-hidden="true"
      ></i>
      ${active ? 'Terminar selección' : 'Seleccionar música'}`;
  });
  document.querySelector('.music-workspace-toolbar')?.append(selectMusic);
  const closeMusicSearch = (): void => {
    musicSearchGeneration += 1;
    const status = document.querySelector<HTMLElement>('[data-music-status]');
    status?.setAttribute('aria-busy', 'false');
    if (status) {
      status.textContent = '';
    }
    searchResults?.classList.remove('show');
    searchResults?.classList.add('hide');
    searchOverlay.classList.remove('active');
  };
  searchOverlay.addEventListener('click', closeMusicSearch);
  document.querySelector('.music-rail')?.addEventListener('click', closeMusicSearch);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMusicSearch();
    }
  });
  document.querySelector<HTMLButtonElement>('#arrow-back')?.addEventListener('click', () => {
    if (musicPanelHistoryIndex <= 0) {
      return;
    }
    musicPanelHistoryIndex -= 1;
    showLegacyMusicSection(
      musicPanelHistory[musicPanelHistoryIndex] ?? 'b-music-panel-inicio',
      false,
    );
  });
  document.querySelector<HTMLButtonElement>('#arrow-forward')?.addEventListener('click', () => {
    if (musicPanelHistoryIndex >= musicPanelHistory.length - 1) {
      return;
    }
    musicPanelHistoryIndex += 1;
    showLegacyMusicSection(
      musicPanelHistory[musicPanelHistoryIndex] ?? 'b-music-panel-inicio',
      false,
    );
  });
  updateMusicHistoryButtons();
  document
    .querySelector<HTMLElement>('[data-panel-view="music"]')
    ?.addEventListener('battly:panel-enter', loadMusic);
  document.querySelector<HTMLElement>('[data-music-featured]')?.addEventListener('click', () => {
    showLegacyMusicSection('b-music-panel-inicio');
    renderMusicLibrary(musicSnapshot);
  });
  document
    .querySelector<HTMLButtonElement>('[data-music-spotlight]')
    ?.addEventListener('click', () => {
      if (!musicSnapshot.promotedSong && !musicSnapshot.featured.length) {
        return;
      }
      musicQueue = musicSnapshot.promotedSong
        ? [musicSnapshot.promotedSong]
        : [...musicSnapshot.featured];
      playMusicAt(0);
    });
  document.querySelector<HTMLElement>('[data-music-favorites]')?.addEventListener('click', () => {
    renderLegacyMusicFavorites();
    showLegacyMusicSection('b-music-panel-biblioteca');
  });
  document
    .querySelector<HTMLElement>('[data-music-playlists-open]')
    ?.addEventListener('click', () => showLegacyMusicSection('b-music-panel-playlists'));
  document.querySelector<HTMLElement>('[data-music-queue-open]')?.addEventListener('click', () => {
    renderMusicQueue();
    const queuePanel = document
      .querySelector<HTMLElement>('[data-music-queue]')
      ?.closest<HTMLElement>('.b-music-queue-panel');
    queuePanel?.classList.add('active');
    queuePanel?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  });
  document
    .querySelector<HTMLElement>('[data-music-queue-close]')
    ?.addEventListener('click', () =>
      document
        .querySelector<HTMLElement>('[data-music-queue]')
        ?.closest('.b-music-queue-panel')
        ?.classList.remove('active'),
    );
  const trackDialog = document.querySelector<HTMLDialogElement>('[data-music-track-dialog]');
  document
    .querySelector<HTMLButtonElement>('[data-music-track-close]')
    ?.addEventListener('click', () => trackDialog?.close());
  document
    .querySelector<HTMLButtonElement>('[data-music-track-play]')
    ?.addEventListener('click', () => {
      if (!detailedMusicSong) {
        return;
      }
      const existing = musicQueue.findIndex((song) => song.id === detailedMusicSong?.id);
      if (existing >= 0) {
        playMusicAt(existing);
      } else {
        musicQueue = [detailedMusicSong, ...musicQueue];
        playMusicAt(0);
      }
      trackDialog?.close();
    });
  document
    .querySelector<HTMLButtonElement>('[data-music-track-queue]')
    ?.addEventListener('click', () => {
      if (!detailedMusicSong) {
        return;
      }
      musicQueue = [...musicQueue, detailedMusicSong];
      renderMusicQueue();
      const status = document.querySelector<HTMLElement>('[data-music-track-status]');
      if (status) {
        status.textContent = 'Añadida a la cola';
      }
    });
  document
    .querySelector<HTMLButtonElement>('[data-music-track-favorite]')
    ?.addEventListener('click', (event) => {
      if (!detailedMusicSong) {
        return;
      }
      const button = event.currentTarget as HTMLButtonElement;
      const song = detailedMusicSong;
      button.disabled = true;
      void window.battly
        .setMusicFavorite(
          { id: song.id, title: song.title, artist: song.artist, thumbnailUrl: song.thumbnailUrl },
          button.dataset.enabled !== 'true',
        )
        .then((favorites) => {
          musicFavorites = [...favorites];
          renderMusicLibrary(musicSnapshot);
          openMusicTrackDetails(song);
          button.disabled = false;
        })
        .catch(() => {
          button.disabled = false;
          const status = document.querySelector<HTMLElement>('[data-music-track-status]');
          if (status) {
            status.textContent = 'No se pudo actualizar Favoritos';
          }
        });
    });
  const searchMusic = (): void => {
    const query = document.querySelector<HTMLInputElement>('[data-music-search-query]')?.value;
    const status = document.querySelector<HTMLElement>('[data-music-status]');
    if (typeof query !== 'string' || !query.trim()) {
      return;
    }
    const generation = ++musicSearchGeneration;
    if (status) {
      status.textContent = 'Buscando música…';
    }
    status?.setAttribute('aria-busy', 'true');
    void window.battly
      .searchMusic(query)
      .then((songs) => {
        if (generation !== musicSearchGeneration) {
          return;
        }
        renderMusicSearchResults(songs, query.trim());
        if (status) {
          status.textContent = '';
        }
      })
      .catch(() => {
        if (generation !== musicSearchGeneration) {
          return;
        }
        if (status) {
          status.textContent = 'No se pudo completar la búsqueda';
        }
      })
      .finally(() => {
        if (generation === musicSearchGeneration) {
          status?.setAttribute('aria-busy', 'false');
        }
      });
  };
  let musicSearchTimer: ReturnType<typeof setTimeout> | undefined;
  document
    .querySelector<HTMLInputElement>('[data-music-search-query]')
    ?.addEventListener('input', (event) => {
      clearTimeout(musicSearchTimer);
      musicSearchGeneration++;
      const query = (event.currentTarget as HTMLInputElement).value.trim();
      if (query.length >= 2) {
        musicSearchTimer = setTimeout(searchMusic, 400);
      } else {
        closeMusicSearch();
      }
    });
  document
    .querySelector<HTMLInputElement>('[data-music-search-query]')
    ?.addEventListener('focus', () => {
      if (searchResults?.childElementCount) {
        searchResults.classList.remove('hide');
        searchResults.classList.add('show');
        searchOverlay.classList.add('active');
      }
    });
  document
    .querySelector<HTMLInputElement>('[data-music-search-query]')
    ?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        clearTimeout(musicSearchTimer);
        searchMusic();
      }
    });
  document
    .querySelector<HTMLButtonElement>('[data-music-search-submit]')
    ?.addEventListener('click', searchMusic);
  document
    .querySelectorAll<HTMLButtonElement>('[data-music-previous]')
    .forEach((button) => button.addEventListener('click', () => nextMusic(-1)));
  document
    .querySelectorAll<HTMLButtonElement>('[data-music-next]')
    .forEach((button) => button.addEventListener('click', () => nextMusic(1)));
  document.querySelectorAll<HTMLButtonElement>('[data-music-play-pause]').forEach((button) =>
    button.addEventListener('click', () => {
      const audio = musicAudio();
      const song = musicQueue[musicQueueIndex];
      if (!audio || !song) {
        return;
      }
      if (audio.paused) {
        void audio.play();
      } else {
        audio.pause();
      }
      notifyMusicState(song, !audio.paused);
    }),
  );
  musicAudio()?.addEventListener('ended', continueMusicAfterEnded);
  musicAudio()?.addEventListener('timeupdate', renderMusicProgress);
  musicAudio()?.addEventListener('loadedmetadata', rememberPlayingMusicDuration);
  musicAudio()?.addEventListener('durationchange', rememberPlayingMusicDuration);
  const systemAudio = musicAudio();
  if (systemAudio && !systemMusicControls) {
    systemMusicControls = bindSystemMediaControls(
      systemAudio,
      {
        song: () => musicQueue[musicQueueIndex],
        play: () => {
          const song = musicQueue[musicQueueIndex];
          if (!song) {
            return;
          }
          if (systemAudio.dataset.musicPlayingId !== song.id) {
            playMusicAt(musicQueueIndex);
          } else {
            void systemAudio.play().catch(() => notifyMusicState(song, false));
          }
        },
        next: () => nextMusic(1),
        previous: () => nextMusic(-1),
      },
      battlyIconUrl,
    );
    const syncPlayback = (): void => {
      const song = musicQueue[musicQueueIndex];
      if (song && systemAudio.dataset.musicPlayingId === song.id) {
        notifyMusicState(song, !systemAudio.paused && !systemAudio.ended);
      }
    };
    systemAudio.addEventListener('play', syncPlayback);
    systemAudio.addEventListener('pause', syncPlayback);
    window.addEventListener('beforeunload', () => systemMusicControls?.dispose(), { once: true });
  }
  const seek = document.querySelector<HTMLElement>('[data-music-progress]');
  const seekDuration = () => {
    const duration = musicAudio()?.duration;
    return duration && Number.isFinite(duration)
      ? duration
      : musicQueue[musicQueueIndex]?.durationSeconds || 0;
  };
  const seekAt = (event: PointerEvent) => {
    const audio = musicAudio();
    const rect = seek?.getBoundingClientRect();
    const duration = seekDuration();
    if (!audio || !rect?.width || !duration) {
      return;
    }
    audio.currentTime =
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
    renderMusicProgress();
  };
  if (seek) {
    let dragging = false;
    seek.tabIndex = 0;
    seek.setAttribute('role', 'slider');
    seek.setAttribute('aria-label', 'Posición de la canción');
    seek.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      dragging = true;
      seek.setPointerCapture(event.pointerId);
      seekAt(event);
    });
    seek.addEventListener('pointermove', (event) => {
      if (dragging) {
        seekAt(event);
      }
    });
    seek.addEventListener('pointerup', (event) => {
      if (dragging) {
        seekAt(event);
      }
      dragging = false;
      if (seek.hasPointerCapture(event.pointerId)) {
        seek.releasePointerCapture(event.pointerId);
      }
    });
    seek.addEventListener('pointercancel', () => {
      dragging = false;
    });
    seek.addEventListener('lostpointercapture', () => {
      dragging = false;
    });
    seek.addEventListener('keydown', (event) => {
      const audio = musicAudio();
      const duration = seekDuration();
      if (!audio || !duration || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      audio.currentTime =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? duration
            : Math.max(
                0,
                Math.min(duration, audio.currentTime + (event.key === 'ArrowRight' ? 5 : -5)),
              );
      renderMusicProgress();
    });
  }
  const volumeInput = document.querySelector<HTMLInputElement>('[data-music-volume]');
  if (volumeInput) {
    volumeInput.value = String(musicAudioSettings.volume);
  }
  const updatePenguin = (): void => {
    const value = Number(volumeInput?.value ?? 50);
    volumeInput?.style.setProperty('--rot', `${(value / 100) * 540}deg`);
  };
  updatePenguin();
  applyMusicVolume();
  document
    .querySelector<HTMLElement>('[data-panel-view="music"]')
    ?.addEventListener('battly:panel-enter', () => {
      if (volumeInput) {
        volumeInput.value = String(musicAudioSettings.volume);
      }
      applyMusicVolume();
      updatePenguin();
    });
  volumeInput?.addEventListener('input', (event) => {
    musicAudioSettings = {
      ...musicAudioSettings,
      volume: Number((event.currentTarget as HTMLInputElement).value),
    };
    privateStorage.setItem(musicAudioSettingsKey, JSON.stringify(musicAudioSettings));
    applyMusicVolume();
    updatePenguin();
  });
  window.battly.onMusicControl((action) => {
    if (action === 'next') {
      nextMusic(1);
    } else if (action === 'previous') {
      nextMusic(-1);
    } else {
      document.querySelector<HTMLButtonElement>('[data-music-play-pause]')?.click();
    }
  });
  const settingsDialog = document.querySelector<HTMLDialogElement>('[data-music-settings-dialog]');
  const settingsForm = document.querySelector<HTMLFormElement>('[data-music-settings-form]');
  document
    .querySelector<HTMLButtonElement>('[data-music-settings]')
    ?.addEventListener('click', () => {
      if (settingsForm) {
        const quality = settingsForm.elements.namedItem('quality');
        const equalizer = settingsForm.elements.namedItem('equalizer');
        const normalization = settingsForm.elements.namedItem('normalization');
        const smartPlayback = settingsForm.elements.namedItem('smartPlayback');
        if (quality instanceof HTMLSelectElement) {
          quality.value = musicAudioSettings.quality;
        }
        if (equalizer instanceof HTMLSelectElement) {
          equalizer.value = musicAudioSettings.equalizer;
        }
        if (normalization instanceof HTMLInputElement) {
          normalization.checked = musicAudioSettings.normalization;
        }
        if (smartPlayback instanceof HTMLInputElement) {
          smartPlayback.checked = musicAudioSettings.smartPlayback;
        }
      }
      settingsDialog?.showModal();
    });
  document
    .querySelector<HTMLButtonElement>('[data-music-settings-close]')
    ?.addEventListener('click', () => settingsDialog?.close());
  settingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(settingsForm);
    const quality = data.get('quality');
    const equalizer = data.get('equalizer');
    const previousQuality = musicAudioSettings.quality;
    musicAudioSettings = {
      ...musicAudioSettings,
      quality:
        typeof quality === 'string' && ['auto', 'high', 'low', 'medium'].includes(quality)
          ? (quality as MusicQuality)
          : 'auto',
      equalizer:
        typeof equalizer === 'string' && ['bass', 'bright', 'flat', 'voice'].includes(equalizer)
          ? (equalizer as MusicEqualizer)
          : 'flat',
      normalization: data.get('normalization') === 'on',
      smartPlayback: data.get('smartPlayback') === 'on',
    };
    if (previousQuality !== musicAudioSettings.quality) {
      musicQueue = musicQueue.map((song) =>
        musicResolvedSongIds.has(song.id) ? { ...song, sourceUrl: null } : song,
      );
      musicResolvedSongIds.clear();
    }
    privateStorage.setItem(musicAudioSettingsKey, JSON.stringify(musicAudioSettings));
    applyMusicAudioProcessing();
    const status = document.querySelector<HTMLElement>('[data-music-settings-status]');
    if (status) {
      status.textContent = 'Ajustes guardados';
    }
  });
  const legacyQuality = document.querySelector<HTMLSelectElement>('[data-music-legacy-quality]');
  const legacyEqEnabled = document.querySelector<HTMLInputElement>(
    '[data-music-legacy-eq-enabled]',
  );
  const legacyEqPreset = document.querySelector<HTMLSelectElement>('[data-music-legacy-eq-preset]');
  const legacyNormalization = document.querySelector<HTMLInputElement>(
    '[data-music-legacy-normalization]',
  );
  const legacySmartPlayback = document.querySelector<HTMLInputElement>(
    '[data-music-legacy-smart-playback]',
  );
  const legacyNormalizerTarget = document.querySelector<HTMLInputElement>(
    '#music-setting-normalizer-target',
  );
  const legacyAutoQueue = document.querySelector<HTMLInputElement>('#music-setting-autoqueue');
  const legacySmartShuffle = document.querySelector<HTMLInputElement>(
    '#music-setting-smart-shuffle',
  );
  const legacyRepeatTrack = document.querySelector<HTMLInputElement>('#music-setting-repeat-track');
  const legacyRepeatQueue = document.querySelector<HTMLInputElement>('#music-setting-repeat-queue');
  const legacyExplicitFilter = document.querySelector<HTMLInputElement>(
    '#music-setting-explicit-filter',
  );
  const legacyAggressivePreload = document.querySelector<HTMLInputElement>(
    '#music-setting-aggressive-preload',
  );
  const legacyEqBands = [60, 170, 350, 1000, 3500, 10000]
    .map((frequency) => document.querySelector<HTMLInputElement>(`#music-eq-band-${frequency}`))
    .filter((input): input is HTMLInputElement => Boolean(input));
  const hydrateLegacyMusicSettings = (): void => {
    if (legacyQuality) {
      legacyQuality.value =
        musicAudioSettings.quality === 'medium' || musicAudioSettings.quality === 'auto'
          ? 'balanced'
          : musicAudioSettings.quality;
    }
    if (legacyEqEnabled) {
      legacyEqEnabled.checked = musicAudioSettings.equalizer !== 'flat';
    }
    if (legacyEqPreset) {
      legacyEqPreset.value =
        musicAudioSettings.equalizer === 'bass'
          ? 'bass_boost'
          : musicAudioSettings.equalizer === 'voice'
            ? 'vocal'
            : musicAudioSettings.equalizer === 'bright'
              ? 'treble_boost'
              : musicAudioSettings.equalizer === 'night' ||
                  musicAudioSettings.equalizer === 'custom'
                ? musicAudioSettings.equalizer
                : 'flat';
    }
    if (legacyNormalization) {
      legacyNormalization.checked = musicAudioSettings.normalization;
    }
    if (legacySmartPlayback) {
      legacySmartPlayback.checked = musicAudioSettings.smartPlayback;
    }
    if (legacyNormalizerTarget) {
      legacyNormalizerTarget.value = String(musicAudioSettings.normalizerTarget);
    }
    const normalizerValue = document.querySelector<HTMLElement>('#music-setting-normalizer-value');
    if (normalizerValue) {
      normalizerValue.textContent = `${musicAudioSettings.normalizerTarget}%`;
    }
    if (legacyAutoQueue) {
      legacyAutoQueue.checked = musicAudioSettings.autoQueue;
    }
    if (legacySmartShuffle) {
      legacySmartShuffle.checked = musicAudioSettings.smartShuffle;
    }
    if (legacyRepeatQueue) {
      legacyRepeatQueue.checked = musicAudioSettings.repeatQueue;
    }
    if (legacyRepeatTrack) {
      legacyRepeatTrack.checked = musicAudioSettings.repeatTrack;
    }
    if (legacyExplicitFilter) {
      legacyExplicitFilter.checked = musicAudioSettings.explicitFilter;
    }
    if (legacyAggressivePreload) {
      legacyAggressivePreload.checked = musicAudioSettings.aggressivePreload;
    }
    legacyEqBands.forEach((input, index) => {
      input.value = String(musicAudioSettings.equalizerBands[index] ?? 0);
      const value = document.querySelector<HTMLElement>(`#${input.id}-value`);
      if (value) {
        value.textContent = `${input.value} dB`;
      }
    });
  };
  const persistLegacyMusicSettings = (): void => {
    const preset = legacyEqEnabled?.checked ? legacyEqPreset?.value : 'flat';
    const previousQuality = musicAudioSettings.quality;
    const bands = legacyEqBands.map((input) => Number(input.value));
    musicAudioSettings = {
      ...musicAudioSettings,
      aggressivePreload: legacyAggressivePreload?.checked ?? false,
      autoQueue: legacyAutoQueue?.checked ?? false,
      quality:
        legacyQuality?.value === 'balanced'
          ? 'medium'
          : legacyQuality?.value === 'high' || legacyQuality?.value === 'low'
            ? legacyQuality.value
            : 'auto',
      equalizer:
        preset === 'bass_boost'
          ? 'bass'
          : preset === 'vocal'
            ? 'voice'
            : preset === 'treble_boost'
              ? 'bright'
              : preset === 'night' || preset === 'custom'
                ? preset
                : 'flat',
      equalizerBands: bands,
      explicitFilter: legacyExplicitFilter?.checked ?? false,
      normalization: legacyNormalization?.checked ?? false,
      normalizerTarget: Number(legacyNormalizerTarget?.value ?? 100),
      repeatQueue: legacyRepeatQueue?.checked ?? false,
      repeatTrack: legacyRepeatTrack?.checked ?? false,
      smartShuffle: legacySmartShuffle?.checked ?? false,
      smartPlayback: legacySmartPlayback?.checked ?? false,
    };
    if (previousQuality !== musicAudioSettings.quality) {
      musicQueue = musicQueue.map((song) =>
        musicResolvedSongIds.has(song.id) ? { ...song, sourceUrl: null } : song,
      );
      musicResolvedSongIds.clear();
    }
    privateStorage.setItem(musicAudioSettingsKey, JSON.stringify(musicAudioSettings));
    applyMusicAudioProcessing();
  };
  hydrateLegacyMusicSettings();
  document
    .querySelector<HTMLElement>('[data-music-settings-open]')
    ?.addEventListener('click', () => {
      hydrateLegacyMusicSettings();
      showLegacyMusicSection('b-music-panel-settings');
    });
  [
    legacyQuality,
    legacyEqEnabled,
    legacyEqPreset,
    legacyNormalization,
    legacySmartPlayback,
    legacyAutoQueue,
    legacySmartShuffle,
    legacyRepeatQueue,
    legacyRepeatTrack,
    legacyExplicitFilter,
    legacyAggressivePreload,
  ].forEach((control) => control?.addEventListener('change', persistLegacyMusicSettings));
  legacyNormalizerTarget?.addEventListener('input', () => {
    const value = document.querySelector<HTMLElement>('#music-setting-normalizer-value');
    if (value) {
      value.textContent = `${legacyNormalizerTarget.value}%`;
    }
    persistLegacyMusicSettings();
  });
  legacyEqBands.forEach((input) => {
    input.addEventListener('input', () => {
      if (legacyEqEnabled) {
        legacyEqEnabled.checked = true;
      }
      if (legacyEqPreset) {
        legacyEqPreset.value = 'custom';
      }
      const value = document.querySelector<HTMLElement>(`#${input.id}-value`);
      if (value) {
        value.textContent = `${input.value} dB`;
      }
      persistLegacyMusicSettings();
    });
  });
  document
    .querySelector<HTMLButtonElement>('[data-music-legacy-eq-reset]')
    ?.addEventListener('click', () => {
      if (legacyEqEnabled) {
        legacyEqEnabled.checked = false;
      }
      if (legacyEqPreset) {
        legacyEqPreset.value = 'flat';
      }
      document
        .querySelectorAll<HTMLInputElement>('#music-eq-controls input[type="range"]')
        .forEach((input) => {
          input.value = '0';
          const value = document.querySelector<HTMLElement>(`#${input.id}-value`);
          if (value) {
            value.textContent = '0 dB';
          }
        });
      persistLegacyMusicSettings();
    });
  const playlistDialog = document.querySelector<HTMLDialogElement>('[data-music-playlist-dialog]');
  document
    .querySelector<HTMLButtonElement>('[data-music-create]')
    ?.addEventListener('click', () => openMusicPlaylistDialog(null));
  document
    .querySelector<HTMLButtonElement>('[data-music-playlist-close]')
    ?.addEventListener('click', () => {
      editingMusicPlaylist = null;
      playlistDialog?.close();
    });
  document
    .querySelector<HTMLFormElement>('[data-music-playlist-form]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const name = data.get('name');
      const description = data.get('description');
      const status = document.querySelector<HTMLElement>('[data-music-playlist-status]');
      const draftSongs = playlistDraftSongs ?? musicQueue;
      if (!editingMusicPlaylist && !draftSongs.length) {
        if (status) {
          status.textContent = 'Añade canciones a la cola primero';
        }
        return;
      }
      const playlist = editingMusicPlaylist;
      const metadata = {
        name: typeof name === 'string' ? name : '',
        description: typeof description === 'string' ? description : '',
      };
      if (status) {
        status.textContent = playlist ? 'Guardando cambios…' : 'Creando playlist…';
      }
      const operation = playlist
        ? window.battly.updateMusicPlaylist(playlist.id, metadata)
        : window.battly.createMusicPlaylist({
            ...metadata,
            songs: draftSongs.map((song) => song.id),
          });
      void operation
        .then(() => {
          editingMusicPlaylist = null;
          playlistDialog?.close();
          form.reset();
          loadMusic();
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo guardar la playlist';
          }
        });
    });
  const invitesDialog = document.querySelector<HTMLDialogElement>('[data-music-invites-dialog]');
  const collaborationDialog = document.querySelector<HTMLDialogElement>(
    '[data-music-collaboration-dialog]',
  );
  document
    .querySelector<HTMLButtonElement>('[data-music-collaboration-close]')
    ?.addEventListener('click', () => {
      activeCollaborationPlaylist = null;
      collaborationDialog?.close();
    });
  document
    .querySelector<HTMLFormElement>('[data-music-collaboration-invite]')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const username = new FormData(form).get('username');
      const status = document.querySelector<HTMLElement>('[data-music-collaboration-status]');
      const playlist = activeCollaborationPlaylist;
      if (!playlist || typeof username !== 'string') {
        return;
      }
      if (status) {
        status.textContent = 'Enviando invitación…';
      }
      void window.battly
        .inviteMusicPlaylistCollaborator(playlist.id, username)
        .then(() => {
          form.reset();
          openMusicCollaborationDialog(playlist);
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo enviar la invitación';
          }
        });
    });
  document.querySelector<HTMLElement>('[data-music-invites]')?.addEventListener('click', () => {
    showLegacyMusicSection('b-music-panel-collab-invites');
    loadMusicInvites();
  });
  document
    .querySelector<HTMLElement>('[data-music-import]')
    ?.addEventListener('click', () => void openMusicImportFlow());
  document
    .querySelector<HTMLButtonElement>('[data-music-invites-close]')
    ?.addEventListener('click', () => invitesDialog?.close());
}

function mountLauncher(): void {
  mountSupportConsent();
  const presenceObserver = new MutationObserver(updateDiscordUiContext);
  document
    .querySelectorAll(
      '[data-instances-dialog], [data-download-dialog], [data-local-mods-dialog], [data-mod-detail-dialog], [data-theme-editor-dialog], [data-theme-import-dialog], [data-theme-sound-dialog]',
    )
    .forEach((node) =>
      presenceObserver.observe(node, {
        attributes: true,
        attributeFilter: ['open', 'hidden', 'class'],
      }),
    );
  presenceObserver.observe(document.body, { childList: true });
  mountLegacyHomePanel();
  mountLegacyFriendsPanel();
  mountLegacyModsPanel();
  mountLegacyMusicPanel();
  mountLegacySettingsPanel();
  mountLegacyOnboardingPanels();
  mountNewsPanel();

  mountMyBattlyPanel({
    navigate: activatePanel,
    notify: (message, error) => showToast('MyBattly', message, error ? 'error' : 'success'),
  });
  mountOnboardingPanel({ navigate: activatePanel, applyLanguage });
  mountServersPanel(
    (request, label) => startPlayVersion(request, label),
    () => void activatePanel('home'),
  );
  mountHomeTutorial(() => setActivePanel('home'));
  window.battly.onLabyUpdateChoice(chooseLabyUpdate);
  window.battly.onBattlyClientUpdateChoice(chooseBattlyClientUpdate);
  removeLegacyInlineHandlers(document);
  document.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-panel]') : null;
    if (!button || button === document.body) {
      return;
    }
    event.preventDefault();
    void activatePanel(button.dataset.panel ?? 'home').catch(() =>
      showToast('Battly', 'No se pudo completar la acción. Vuelve a intentarlo.', 'error'),
    );
  });
  document
    .querySelector<HTMLElement>('[data-panel-view="servers"]')
    ?.addEventListener('battly:panel-enter', loadServersPanel);
  bindWindowControls();
  bindShellControls();
  bindNewsPanel();
  bindAccountSelector();
  bindLogin();
  bindTwoFactor();
  bindInstances();
  bindActionTooltips();
  bindErrorReporter();
  bindLegacyDownloadPanel();
  bindLaunchLifecycle();
  bindMods();
  bindSocial();
  bindWorldsVoice();
  bindBattlyWorlds(
    (request, label, progress) => startPlayVersion(request, label, false, progress),
    (instance, address) => startInstance(instance, false, address),
  );
  bindMusic();
  bindClickSounds();
  bindThemes();
  window.battly.onThemeApplied((snapshot) => {
    marketplacePreviewOriginal = null;
    marketplacePreviewThemeId = null;
    currentThemeLibrary = snapshot;
    renderThemeCards(snapshot.themes, false);
    void reflectActiveTheme(snapshot);
  });
  bindSettings();
  bindSkinCustomizer((message, status) => showToast('Skin y capa', message, status));
  window.battly.onProtocolAction((action) => {
    if (action.type === 'settings') {
      void activatePanel('settings');
      return;
    }
    if (action.type === 'themes') {
      void activatePanel('settings').then(() => {
        setThemeMode(action.tab === 'share' ? 'library' : 'marketplace');
        if (action.tab === 'marketplace') {
          void loadThemeMarketplace();
        }
      });
      return;
    }
  });
  setActivePanel('home');
  void initializeLauncher().catch((error) => {
    console.error('[startup] Initialization failed:', error);
    releaseStartupUi();
    const loader = document.querySelector<HTMLElement>('[data-panel-loader]');
    if (loader) {
      loader.hidden = true;
    }
    void window.battly.launcherReady();
    showToast('Error', 'No se pudo cargar el panel de inicio', 'error');
  });
}

async function initializeLauncher(): Promise<void> {
  window.addEventListener('focus', () => void renderAccounts());
  const loader = document.querySelector<HTMLElement>('[data-panel-loader]');
  const loaderText = document.querySelector<HTMLElement>('[data-panel-loader-text]');
  if (loader) {
    loader.hidden = false;
    loader.classList.remove('hide', 'inert');
    loader.setAttribute('aria-busy', 'true');
  }
  if (loaderText) {
    loaderText.textContent = 'Cargando Battly...';
  }
  await Promise.allSettled([
    renderAppInfo(),
    renderVisualPreferences(),
    window.battly.getSettings().then(renderSettings),
  ]);
  mountNotifications();
  if (loaderText) {
    loaderText.textContent = 'Cargando panel de inicio';
  }
  await selectInitialPanel();
  if (loader) {
    loader.hidden = true;
    loader.classList.remove('hide');
    loader.classList.add('inert');
    loader.setAttribute('aria-busy', 'false');
  }
  const showStartupPatchNotes = () => {
    void window.battly
      .getUpdates()
      .then((snapshot) => showPatchNotes(snapshot.installedPatchNotes))
      .catch(() => undefined);
  };
  const releaseWelcome = needsReleaseWelcome()
    ? new ReleaseWelcome(showStartupPatchNotes)
    : undefined;
  if (!releaseWelcome && rendererHasAccount && currentSettingsSnapshot?.runtime.ogIntroEnabled) {
    ogIntro = new OgIntro(ogIntroUrl, ogLoopUrl, showStartupPatchNotes);
  } else {
    releaseStartupUi();
  }
  // Commit the startup visibility state before the main process exposes the window.
  await commitStartupFrame();
  await window.battly.launcherReady();
  const startupParameters = new URLSearchParams(window.location.search);
  const startupVolume = Number(startupParameters.get('introVolume'));
  const startupSound = startupParameters.get('startupSound');
  if (!releaseWelcome && startupSound && Number.isFinite(startupVolume) && startupVolume > 0) {
    void previewThemeSound(startupSound, startupVolume).catch(() => {
      // A failed sound preview must not interrupt startup.
    });
  }
  releaseWelcome?.start();
  ogIntro?.start();
  if (!releaseWelcome && !ogIntro) {
    showStartupPatchNotes();
  }
  window.battly.onHomeUpdated(renderHomeSnapshot);
  // News and presence can time out independently; they must never hold the window closed.
  void renderHome();
}

void initializePrivatePreferences()
  .then(() => {
    musicAudioSettings = readMusicAudioSettings();
    window.addEventListener('private-storage-error', () =>
      showToast('Error', 'No se pudieron guardar los cambios. Inténtalo de nuevo.', 'error'),
    );
    if (new URLSearchParams(window.location.search).get('window') === 'music') {
      releaseStartupUi();
      if (musicOverlayEnabled) {
        bindMusicOverlayWindow();
      } else {
        bindDetachedMusicWindow();
      }
      void window.battly.getSettings().then((settings) => applyLanguage(settings.visual.language));
    } else {
      mountLauncher();
    }
  })
  .catch(() => {
    releaseStartupUi();
    setUiText(
      document.body,
      'No se pudieron abrir tus ajustes. Desbloquea el llavero del sistema y reinicia Battly.',
    );
    void window.battly.launcherReady();
  });
