import type { OverlayPackage } from './overlay-release';
import { scrollbarStyle } from '../scrollbar-style';
import {
  BrowserWindow,
  Notification,
  globalShortcut,
  screen,
  type IpcMainInvokeEvent,
} from 'electron';
import {
  defaultWorldsPreferences,
  type WorldsPreferences,
} from '../../shared/settings/game-preferences';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import {
  defaultWorldsOverlayPreferences,
  normalizeWorldsOverlayPreferences,
  isMinimalWorldsOverlay,
  type WorldsOverlayPreferences,
} from '../../shared/social/worlds-overlay-preferences';
import { pathToFileURL } from 'node:url';
import type { WorldsEvent, WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import { desktopChannels } from '../../shared/desktop-api';
import { worldsShortcutConflict, type WorldsShortcuts } from '../../shared/social/worlds-shortcuts';

export interface WorldsDesktopPresentation {
  /** Resolves against the current account language at notification time. */
  readonly translate?: (source: string) => string;
}

export class WorldsDesktop {
  #nativeClients = new Set<number>();
  setNativeClient(pid: number, enabled: boolean): void {
    if (!enabled) {
      if (this.#gamePid !== pid) {
        this.#nativeClients.delete(pid);
      }
      return;
    }
    this.#nativeClients.add(pid);
    if (this.#gamePid !== pid) {
      return;
    }
    if (enabled) {
      clearInterval(this.#mouseTimer);
      this.#mouseTimer = undefined;
      clearInterval(this.#boundsTimer);
      this.#boundsTimer = undefined;
      this.#syncLanKeys();
      this.#overlay?.destroy();
      this.#overlay = undefined;
      this.#overlayReady = false;
      this.#tracker?.kill();
      this.#tracker = undefined;
      clearTimeout(this.#lanTimer);
      this.#lanPrompt = false;
      this.#setShortcut(false);
    }
  }
  #nativeClient(): boolean {
    return this.#nativeClients.has(this.#gamePid);
  }

  #settings = { ...defaultWorldsPreferences };
  checkShortcuts(value: WorldsShortcuts): void {
    // Registering a probe through the Wayland portal can open its shortcut setup dialog.
    if (
      process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY)
    ) {
      return;
    }
    const previous = new Set(Object.values(this.#settings.shortcuts));
    const checked: string[] = [];
    try {
      for (const key of Object.values(value)) {
        if (previous.has(key)) {
          continue;
        }
        if (!globalShortcut.register(key, () => {})) {
          throw new Error(worldsShortcutConflict);
        }
        checked.push(key);
      }
    } finally {
      for (const key of checked) {
        globalShortcut.unregister(key);
      }
    }
  }
  async applySettings(value: WorldsPreferences): Promise<void> {
    const changed = Object.keys(value.shortcuts).some(
      (key) =>
        value.shortcuts[key as keyof WorldsShortcuts] !==
        this.#settings.shortcuts[key as keyof WorldsShortcuts],
    );
    const active = this.#shortcutsActive;
    if (changed) {
      this.#setShortcut(false);
      for (const key of this.#lanKeys) {
        globalShortcut.unregister(key);
      }
      this.#lanKeys.clear();
    }
    this.#settings = value;
    if (!value.autoLanDetection) {
      clearTimeout(this.#lanTimer);
      this.#lanPrompt = false;
      this.#syncLanKeys();
      this.#overlay?.webContents.send('worlds:lan-prompt', false);
    }
    if (changed) {
      this.#setShortcut(active);
      this.#syncLanKeys();
      this.#overlay?.webContents.send('worlds:shortcuts', value.shortcuts);
    }
    await this.configure({
      ...this.#preferences,
      showVoice: value.overlayEnabled,
      opacity: value.overlayOpacity,
    });
  }
  #overlay: BrowserWindow | undefined;
  #tracker: ChildProcess | undefined;
  #trackerWatchdog: ReturnType<typeof setTimeout> | undefined;
  #gamePid = 0;
  #lanOpen = false;
  #lanOffered = false;
  #lanPrompt = false;
  #lanTimer: ReturnType<typeof setTimeout> | undefined;
  #lanKeys = new Set<string>();
  #expanded = false;
  #focusOnReveal = false;
  #overlayReady = false;
  #activateLinuxPanel = false;
  #fullscreenNoticeShown = false;
  #animateBounds = false;
  #boundsTimer: ReturnType<typeof setInterval> | undefined;
  #boundsTarget = '';
  #snapshot: WorldsSnapshot | undefined;
  #voiceStatus: Extract<WorldsEvent, { type: 'voice' }> | undefined;
  #voiceChannel: Extract<WorldsEvent, { type: 'voice' }> | undefined;
  #gameVersion = '';
  #intent = false;
  #compactHeight = 64;
  #shortcutsActive = false;
  #shortcut: string | undefined;
  #hideShortcut: string | undefined;
  #hiddenByUser = false;
  #frame:
    | {
        visible: boolean;
        fullscreen?: boolean;
        exclusiveFullscreen?: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | undefined;
  #unfocusedFrames = 0;
  #preferences = { ...defaultWorldsOverlayPreferences };
  #writes: Promise<unknown> = Promise.resolve();
  #notifications = new Set<Notification>();
  #overlayUrl: string;
  #trackerPath: string;
  #assetsReady = true;
  #mouseTimer: ReturnType<typeof setInterval> | undefined;
  #mouseInteractive = false;
  #startRevision = 0;
  #companion =
    process.platform === 'linux' &&
    (process.env?.XDG_SESSION_TYPE === 'wayland' ||
      !!process.env?.WAYLAND_DISPLAY ||
      !process.env?.DISPLAY);
  constructor(
    private readonly root: () => BrowserWindow | null,
    private readonly resources: string,
    private readonly dist: string,
    private readonly preferencesPath?: string,
    private readonly shareLan?: (version: string) => Promise<void>,
    private readonly prepareOverlay?: () => Promise<OverlayPackage>,
    private readonly presentation: WorldsDesktopPresentation = {},
  ) {
    this.#overlayUrl = pathToFileURL(join(dist, 'renderer', 'worlds-overlay.html')).href;
    this.#trackerPath = join(
      resources,
      process.platform === 'win32' ? 'WindowTracker.exe' : 'WindowTracker',
    );
    this.#assetsReady = !prepareOverlay;
    if (preferencesPath) {
      void readBoundedRegularFile(preferencesPath, 1024 * 1024)
        .then((bytes) => bytes.toString('utf8'))
        .then((raw) => {
          this.#preferences = normalizeWorldsOverlayPreferences(JSON.parse(raw));
          this.#overlay?.webContents.send('worlds:overlay-preferences', this.#preferences);
          this.#place();
        })
        .catch(() => undefined);
    }
  }
  #text(source: string): string {
    return this.presentation.translate?.(source) ?? source;
  }
  trusted(event: IpcMainInvokeEvent): boolean {
    return (
      !!this.#overlay &&
      event.sender === this.#overlay.webContents &&
      event.senderFrame?.url === this.#overlayUrl
    );
  }
  emit(event: WorldsEvent): void {
    if (event.type === 'invite' && !this.#settings.invitations) {
      return;
    }
    if (event.type === 'notice' && !this.#settings.connectionAlerts) {
      return;
    }
    const root = this.root();
    if (root && !root.isDestroyed()) {
      root.webContents.send(desktopChannels.worldsEvent, event);
    }
    if (event.type === 'voice' && event.event.type === 'ready') {
      this.emit({ type: 'voice', event: { type: 'channel', channel: event.event.channel } });
    }
    if (event.type === 'voice' && event.event.type === 'status') {
      this.#voiceStatus = event;
    }
    if (event.type === 'voice' && event.event.type === 'channel') {
      this.#voiceChannel = event;
    }
    if (
      this.#overlay &&
      !this.#overlay.isDestroyed() &&
      (event.type !== 'voice' ||
        ['status', 'channel', 'party', 'activity'].includes(event.event.type))
    ) {
      this.#overlay.webContents.send(desktopChannels.worldsEvent, event);
    }
    if (event.type === 'snapshot') {
      const previous = this.#snapshot?.state;
      this.#snapshot = event.snapshot;
      if (event.snapshot.state === 'idle' && previous && !['idle', 'error'].includes(previous)) {
        this.#intent = false;
      }
      this.#place();
    }
    if (event.type === 'invite') {
      if (this.#nativeClient()) {
        return;
      }
      if (Notification.isSupported()) {
        const notice = new Notification({
          title: this.#text('Invitación a BattlyWorlds'),
          body: `${this.#text('{0} te invita a jugar').replace('{0}', () => event.invite.fromUsername)}${event.invite.version ? ' · ' + event.invite.version : ''}`,
          silent: false,
        });
        this.#notifications.add(notice);
        notice.on('click', () => {
          this.open();
        });
        const expiry = setTimeout(() => notice.close(), 15000);
        expiry.unref();
        notice.on('close', () => {
          clearTimeout(expiry);
          this.#notifications.delete(notice);
        });
        notice.show();
      }
      if (this.#gamePid && this.#eligible() && !this.#hiddenByUser) {
        this.#ensureOverlay();
        this.expand(true);
      }
    }
    if (event.type === 'closed' && !this.#nativeClient() && Notification.isSupported()) {
      const notice = new Notification({
        title: 'Battly Worlds',
        body: this.#text(event.message),
        silent: false,
      });
      this.#notifications.add(notice);
      notice.on('click', () => this.open());
      const expiry = setTimeout(() => notice.close(), 15000);
      expiry.unref();
      notice.on('close', () => {
        clearTimeout(expiry);
        this.#notifications.delete(notice);
      });
      notice.show();
    }
  }
  openGamePanel(activate = true): void {
    if (this.#nativeClient()) {
      return;
    }
    this.#activateLinuxPanel = activate;
    if (!this.#gamePid) {
      throw new Error('Abre Minecraft desde Battly antes de abrir este panel.');
    }
    this.#intent = true;
    this.#hiddenByUser = false;
    this.#lanPrompt = false;
    this.#ensureOverlay();
    this.#overlay?.webContents.send('worlds:lan-prompt', false);
    this.expand(true);
    if (process.platform !== 'win32' && this.#companion && activate && this.#overlayReady) {
      this.#overlay?.focus();
    }
  }
  open(): void {
    if (this.#nativeClient()) {
      return;
    }
    if (this.#companion && this.#gamePid) {
      this.openGamePanel();
      return;
    }
    if (this.#gamePid && this.#eligible() && this.#frame?.visible) {
      if (this.#blocksOverlay()) {
        this.#explainFullscreen();
        return;
      }
      this.#hiddenByUser = false;
      this.#syncLanKeys();
      this.#ensureOverlay();
      this.expand(true);
      this.#overlay?.showInactive();
    } else if (!this.#gamePid) {
      const root = this.root();
      root?.show();
      root?.focus();
      root?.webContents.send(desktopChannels.worldsEvent, { type: 'open' } satisfies WorldsEvent);
    }
  }
  expand(expanded: boolean): void {
    if (this.#lanPrompt && expanded) {
      return;
    }
    this.#animateBounds = this.#expanded !== expanded && this.#preferences.animations;
    if (!expanded && this.#expanded) {
      this.#releaseOverlayFocus();
    }
    this.#expanded = expanded;
    this.#focusOnReveal = expanded;
    // Keep gameplay click-through while collapsed. The deliberately opened
    // panel must be activatable: Chromium on Windows otherwise drops input
    // after focus transitions, and report fields cannot receive keyboard input.
    this.#overlay?.setFocusable(expanded);
    this.#place();
    this.#overlay?.webContents.send('worlds:overlay-expanded', expanded);
  }
  #releaseOverlayFocus(): void {
    const overlay = this.#overlay;
    if (!overlay || overlay.isDestroyed()) {
      return;
    }
    const focused = overlay.isFocused?.() === true;
    this.#mouseInteractive = false;
    overlay.setIgnoreMouseEvents(true);
    overlay.blur?.();
    overlay.setFocusable(false);
    if (focused && !this.#companion && overlay.isVisible()) {
      // Deactivate the HWND before restoring the non-activating HUD. Merely
      // changing focusable can leave Minecraft behind the active overlay.
      overlay.hide();
      overlay.showInactive();
    }
  }
  hostingVersion(): string {
    if (!this.#gamePid || !this.#lanOpen) {
      throw new Error('Abre tu mundo de Minecraft en LAN antes de crear la sala.');
    }
    return this.#gameVersion;
  }
  gameRunning(): boolean {
    return this.#gamePid > 0;
  }
  lanOpened(): void {
    if (!this.#gamePid) {
      return;
    }
    this.#lanOpen = true;
    if (!this.#settings.autoLanDetection) {
      return;
    }
    if (this.#lanOffered || (this.#snapshot && !['idle', 'error'].includes(this.#snapshot.state))) {
      return;
    }
    this.#lanOffered = true;
    const pid = this.#gamePid;
    this.#lanTimer = setTimeout(() => {
      this.#lanTimer = undefined;
      if (
        this.#gamePid !== pid ||
        !this.#lanOpen ||
        (this.#snapshot && !['idle', 'error'].includes(this.#snapshot.state))
      ) {
        return;
      }
      this.#offerLan();
    }, 3500);
  }
  #offerLan(): void {
    this.#lanPrompt = true;
    this.#intent = true;
    this.#compactHeight = 310;
    this.#overlay?.webContents.send('worlds:lan-prompt', true);
    this.expand(false);
    this.#syncLanKeys();
  }
  async respondLan(accept: boolean): Promise<void> {
    if (!this.#lanPrompt || !this.#gamePid) {
      return;
    }
    this.#lanPrompt = false;
    this.#intent = accept;
    this.#overlay?.webContents.send('worlds:lan-prompt', false);
    this.#syncLanKeys();
    this.expand(false);
    if (accept) {
      try {
        await this.shareLan?.(this.hostingVersion());
      } catch (error) {
        this.emit({
          type: 'notice',
          message:
            error instanceof Error
              ? error.message
              : 'No se pudo compartir el mundo. Abre Battly Worlds para reintentarlo.',
        });
      }
    }
  }
  #syncLanKeys(): void {
    if (this.#nativeClient()) {
      this.#lanPrompt = false;
    }
    const enabled =
      this.#lanPrompt &&
      this.#overlayReady &&
      !!this.#frame?.visible &&
      !this.#blocksOverlay() &&
      !this.#hiddenByUser;
    const { acceptLan, dismissLan } = this.#settings.shortcuts;
    for (const key of [acceptLan, dismissLan]) {
      if (enabled && !this.#lanKeys.has(key)) {
        if (
          globalShortcut.register(key, () => {
            void this.respondLan(key === acceptLan);
          })
        ) {
          this.#lanKeys.add(key);
        }
      } else if (!enabled && this.#lanKeys.delete(key)) {
        globalShortcut.unregister(key);
      }
    }
  }
  gameStarted(pid: number, version: string): void {
    const companion =
      process.platform === 'linux' &&
      (process.env?.XDG_SESSION_TYPE === 'wayland' ||
        !!process.env?.WAYLAND_DISPLAY ||
        !process.env?.DISPLAY);
    if (this.#companion !== companion) {
      this.#overlay?.destroy();
      this.#overlay = undefined;
    }
    this.#companion = companion;
    clearTimeout(this.#trackerWatchdog);
    clearTimeout(this.#lanTimer);
    this.#lanTimer = undefined;
    this.#setShortcut(false);
    this.#hiddenByUser = false;
    this.#fullscreenNoticeShown = false;
    this.#gamePid = pid;
    if (this.#nativeClient()) {
      this.#gameVersion = version;
      this.#overlay?.destroy();
      this.#overlay = undefined;
      this.#tracker?.kill();
      this.#tracker = undefined;
      return;
    }
    this.#lanOpen = false;
    this.#lanOffered = false;
    this.#lanPrompt = false;
    this.#syncLanKeys();
    this.#overlay?.webContents.send('worlds:lan-prompt', false);
    this.#intent = false;
    this.#frame = undefined;
    this.#gameVersion = version;
    this.#expanded = false;
    this.#focusOnReveal = false;
    this.#mouseInteractive = false;
    if (this.#overlay && !this.#overlay.isDestroyed()) {
      this.#overlay.setIgnoreMouseEvents(true);
      this.#overlay.setFocusable(false);
      this.#overlay.hide();
      this.#overlay.webContents.send('worlds:overlay-expanded', false);
    }
    const revision = ++this.#startRevision;
    this.#tracker?.kill();
    this.#tracker = undefined;
    if (this.prepareOverlay) {
      this.#assetsReady = false;
      this.#overlay?.hide();
      void this.prepareOverlay()
        .then((assets) => {
          if (revision !== this.#startRevision || this.#gamePid !== pid) {
            return;
          }
          const url = pathToFileURL(assets.renderer).href;
          if (this.#overlayUrl !== url) {
            this.#overlay?.destroy();
            this.#overlay = undefined;
          }
          this.#overlayUrl = url;
          this.#trackerPath = assets.tracker;
          this.#assetsReady = true;
          this.#startGameUi(pid);
        })
        .catch((error) => {
          if (revision !== this.#startRevision) {
            return;
          }
          console.error('[Battly Overlay] Could not prepare release', error);
          this.emit({
            type: 'notice',
            message:
              'No se pudo descargar Battly Overlay. Puedes gestionar la sala desde Battly Worlds y reintentarlo al abrir otra partida.',
          });
        });
      return;
    }
    this.#startGameUi(pid);
  }
  #startGameUi(pid: number): void {
    if (this.#nativeClient()) {
      return;
    }
    this.#ensureOverlay();
    this.#overlay?.webContents.send('worlds:game-version', this.#gameVersion);
    this.#tracker?.kill();
    if (this.#companion) {
      this.#expanded = false;
      this.#overlay?.webContents.send('worlds:overlay-expanded', false);
      // Wayland deliberately does not expose other clients' window geometry.
      // Keep controls available where native window tracking is unavailable.
      this.#setShortcut(true);
      return;
    }
    if (!this.#overlay) {
      return;
    }
    const nativeHandle = this.#overlay.getNativeWindowHandle();
    const handle =
      process.platform === 'darwin'
        ? this.#overlay.getMediaSourceId().split(':')[1]
        : (nativeHandle.length === 4
            ? nativeHandle.readUInt32LE()
            : nativeHandle.readBigUInt64LE()
          ).toString();
    const child = (this.#tracker = spawn(
      this.#trackerPath,
      [String(pid), handle, String(process.pid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ));
    this.#trackerWatchdog = setTimeout(() => {
      if (this.#tracker === child && !this.#frame) {
        this.#useCompanion();
      }
    }, 20000);
    this.#trackerWatchdog.unref();
    child.on('error', (error) => {
      if (this.#tracker !== child) {
        return;
      }
      console.error('[Battly Worlds] Window tracker could not start', error);
      this.#useCompanion();
    });
    child.on('exit', (code, signal) => {
      if (this.#tracker === child) {
        if (code !== 0 && signal === null) {
          console.error('[Battly Worlds] Window tracker exited', { code });
        }
        this.#tracker = undefined;
        this.#frame = undefined;
        this.#syncLanKeys();
        this.#setShortcut(false);
        this.#overlay?.hide();
        if (this.#gamePid) {
          this.#useCompanion();
        }
      }
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (
        child !== this.#tracker ||
        !this.#overlay ||
        this.#overlay.isDestroyed() ||
        line.length > 512
      ) {
        return;
      }
      try {
        const frame = JSON.parse(line) as {
          mode?: string;
          visible: boolean;
          fullscreen?: boolean;
          exclusiveFullscreen?: boolean;
          x: number;
          y: number;
          width: number;
          height: number;
        };
        if (frame.mode === 'companion') {
          this.#useCompanion();
          return;
        }
        if (typeof frame.visible !== 'boolean') {
          return;
        }
        // An invisible frame during Java startup still proves the tracker is alive.
        // Do not fall back to a companion just because Minecraft loads slowly.
        clearTimeout(this.#trackerWatchdog);
        if (
          ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) &&
          frame.visible
        ) {
          return;
        }
        if (
          [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) &&
          frame.width > 0 &&
          frame.width <= 32768 &&
          frame.height > 0 &&
          frame.height <= 32768 &&
          Math.abs(frame.x) <= 131072 &&
          Math.abs(frame.y) <= 131072
        ) {
          // Foreground transitions can briefly return another/null HWND while
          // the game window still exists. Require two samples before hiding.
          if (frame.visible) {
            this.#unfocusedFrames = 0;
          } else {
            // Even a brief Alt+Tab can invalidate Chromium's input target before
            // the visibility debounce hides the HUD. Force the next hover to rebind.
            this.#mouseInteractive = false;
            this.#overlay?.setIgnoreMouseEvents(true);
            if (this.#frame?.visible && ++this.#unfocusedFrames < 2) {
              return;
            }
          }
          this.#frame = frame;
          clearTimeout(this.#trackerWatchdog);
        } else if (this.#frame) {
          // F11 can temporarily destroy/recreate the render window. Apply the
          // same grace period to missing geometry as to a foreground transition.
          if (this.#frame.visible && ++this.#unfocusedFrames < 2) {
            return;
          }
          this.#frame.visible = false;
        }
        this.#setShortcut(frame.visible);
        this.#syncLanKeys();
        this.#place();
      } catch {
        /* Ignore incomplete native frames. */
      }
    });
  }
  #useCompanion(): void {
    clearTimeout(this.#trackerWatchdog);
    const tracker = this.#tracker;
    this.#tracker = undefined;
    tracker?.kill();
    this.#companion = true;
    this.#frame = undefined;
    this.#syncLanKeys();
    this.#overlay?.destroy();
    this.#overlay = undefined;
    this.#ensureOverlay();
    this.#setShortcut(true);
    if (this.#lanPrompt) {
      this.#place();
    }
  }
  #eligible(): boolean {
    return (
      this.#intent ||
      (!!this.#snapshot &&
        ['starting', 'scanning', 'connecting', 'hosting', 'joined'].includes(this.#snapshot.state))
    );
  }
  #setShortcut(active: boolean): void {
    if (this.#nativeClient()) {
      active = false;
    }
    this.#shortcutsActive = active;
    const { menu, visibility } = this.#settings.shortcuts;
    if (active && !this.#shortcut) {
      if (
        globalShortcut.register(menu, () => {
          if (this.#companion) {
            if (this.#overlay?.isVisible()) {
              this.expand(false);
            } else {
              this.openGamePanel(false);
            }
            return;
          }
          if (this.#blocksOverlay()) {
            this.#explainFullscreen();
            return;
          }
          const wasHidden = this.#hiddenByUser;
          this.#hiddenByUser = false;
          this.#intent = true;
          this.#syncLanKeys();
          this.expand(this.#lanPrompt ? false : wasHidden || !this.#expanded);
        })
      ) {
        this.#shortcut = menu;
      }
    } else if (!active && this.#shortcut) {
      globalShortcut.unregister(this.#shortcut);
      this.#shortcut = undefined;
    }
    if (active && !this.#hideShortcut) {
      if (
        globalShortcut.register(visibility, () => {
          if (!this.#eligible()) {
            return;
          }
          this.#hiddenByUser = !this.#hiddenByUser;
          this.#syncLanKeys();
          this.#place();
        })
      ) {
        this.#hideShortcut = visibility;
      }
    } else if (!active && this.#hideShortcut) {
      globalShortcut.unregister(this.#hideShortcut);
      this.#hideShortcut = undefined;
    }
  }
  #blocksOverlay(): boolean {
    // Older trackers only report geometry: retain their conservative behavior.
    return this.#frame?.exclusiveFullscreen ?? this.#frame?.fullscreen ?? false;
  }
  #explainFullscreen(): void {
    if (this.#fullscreenNoticeShown) {
      return;
    }
    this.#fullscreenNoticeShown = true;
    const message =
      'Battly Worlds sigue conectado. Pulsa F11 para usar el panel en modo ventana; se oculta en pantalla completa para no bloquear los clics del juego.';
    this.emit({ type: 'notice', message });
    if (Notification.isSupported()) {
      const notice = new Notification({
        title: 'Battly Worlds',
        body: this.#text(message),
        silent: true,
      });
      this.#notifications.add(notice);
      notice.on('close', () => this.#notifications.delete(notice));
      notice.show();
    }
  }
  #place(): void {
    if (this.#nativeClient()) {
      this.#overlay?.hide();
      return;
    }
    const frame = this.#frame,
      overlay = this.#overlay;
    if (!overlay || overlay.isDestroyed()) {
      return;
    }
    if (this.#companion) {
      if (
        !this.#overlayReady ||
        !this.#gamePid ||
        (!this.#expanded && !this.#lanPrompt) ||
        this.#hiddenByUser
      ) {
        overlay.hide();
        return;
      }
      overlay.setIgnoreMouseEvents(false);
      if (!overlay.isVisible()) {
        if (this.#activateLinuxPanel) {
          overlay.show();
        } else {
          overlay.showInactive();
        }
        overlay.webContents.send('worlds:overlay-reveal');
      }
      return;
    }
    if (
      !this.#overlayReady ||
      !frame?.visible ||
      !this.#eligible() ||
      this.#hiddenByUser ||
      this.#blocksOverlay() ||
      (!this.#settings.overlayEnabled && !this.#expanded && !this.#lanPrompt)
    ) {
      clearInterval(this.#boundsTimer);
      this.#boundsTimer = undefined;
      this.#boundsTarget = '';
      this.#mouseInteractive = false;
      overlay.setIgnoreMouseEvents(true);
      overlay.hide();
      if (frame?.visible && this.#blocksOverlay() && this.#eligible() && !this.#hiddenByUser) {
        this.#explainFullscreen();
      }
      return;
    }
    // Keep gameplay click-through except when the cursor is over the HUD controls.
    const physical = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };
    const rect = process.platform === 'win32' ? screen.screenToDipRect(null, physical) : physical;
    const width = Math.min(
      this.#expanded ? 406 : this.#lanPrompt ? 340 : this.#preferences.width,
      Math.max(200, rect.width - 24),
    );
    const height = Math.min(
      this.#expanded
        ? 704
        : this.#lanPrompt
          ? this.#compactHeight
          : isMinimalWorldsOverlay(this.#preferences)
            ? 82
            : this.#preferences.height || this.#compactHeight,
      Math.max(64, rect.height - 32),
    );
    this.#moveOverlay(overlay, {
      x:
        rect.x +
        12 +
        Math.round(
          Math.max(0, rect.width - width - 24) *
            (this.#preferences.offsetX ?? (this.#preferences.position.endsWith('right') ? 1 : 0)),
        ),
      y:
        rect.y +
        12 +
        Math.round(
          Math.max(0, rect.height - height - 24) *
            (this.#preferences.offsetY ??
              (this.#preferences.position.startsWith('bottom') ? 1 : 0)),
        ),
      width,
      height,
    });
    if (!overlay.isVisible()) {
      // Reassert stacking and hit testing after Alt+Tab/F11. Windows can leave
      // a non-activating HUD behind the restored game's input surface.
      this.#mouseInteractive = false;
      overlay.setIgnoreMouseEvents(true);
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.showInactive();
      overlay.moveTop();
      overlay.webContents.send('worlds:overlay-reveal');
    }
    if (this.#focusOnReveal) {
      this.#focusOnReveal = false;
      overlay.focus();
      overlay.webContents.focus();
    }
    this.#syncMouse();
  }
  #moveOverlay(overlay: BrowserWindow, target: Electron.Rectangle): void {
    const key = JSON.stringify(target);
    if (this.#boundsTarget === key) {
      return;
    }
    clearInterval(this.#boundsTimer);
    this.#boundsTimer = undefined;
    this.#boundsTarget = key;
    const animate = this.#animateBounds && overlay.isVisible();
    this.#animateBounds = false;
    if (!animate) {
      overlay.setBounds(target, false);
      return;
    }
    const from = overlay.getBounds();
    const start = Date.now();
    this.#boundsTimer = setInterval(() => {
      if (overlay.isDestroyed()) {
        clearInterval(this.#boundsTimer);
        this.#boundsTimer = undefined;
        return;
      }
      const progress = Math.min(1, (Date.now() - start) / 180);
      const eased = 1 - Math.pow(1 - progress, 3);
      const lerp = (key: keyof Electron.Rectangle) =>
        Math.round(from[key] + (target[key] - from[key]) * eased);
      overlay.setBounds(
        { x: lerp('x'), y: lerp('y'), width: lerp('width'), height: lerp('height') },
        false,
      );
      if (progress === 1) {
        clearInterval(this.#boundsTimer);
        this.#boundsTimer = undefined;
      }
    }, 16);
  }
  #syncMouse(): void {
    const overlay = this.#overlay;
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible() || this.#companion) {
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = overlay.getBounds();
    const hovering =
      cursor.x >= bounds.x &&
      cursor.x < bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y < bounds.y + bounds.height;
    if (hovering === this.#mouseInteractive) {
      return;
    }
    this.#mouseInteractive = hovering;
    overlay.setIgnoreMouseEvents(!hovering);
    // Restore Chromium's input target after native hide/show without activating
    // the BrowserWindow or taking keyboard focus away from Minecraft.
    if (hovering) {
      overlay.webContents.focus();
    }
  }
  compactHeight(value: number): void {
    this.#compactHeight = Math.max(64, Math.min(420, Math.ceil(value)));
    if (!this.#expanded) {
      this.#place();
    }
  }
  preferences(): WorldsOverlayPreferences {
    return { ...this.#preferences };
  }
  configure(value: unknown): Promise<void> {
    this.#preferences = normalizeWorldsOverlayPreferences(value);
    this.#place();
    this.#overlay?.webContents.send('worlds:overlay-preferences', this.#preferences);
    const serialized = JSON.stringify(this.#preferences);
    const save = async (): Promise<void> => {
      if (!this.preferencesPath) {
        return;
      }
      await writeFileAtomically(this.preferencesPath, serialized);
    };
    const next = this.#writes.then(save, save);
    this.#writes = next.catch(() => undefined);
    return next;
  }
  #ensureOverlay(): void {
    if (this.#nativeClient()) {
      return;
    }
    if (!this.#assetsReady || (this.#overlay && !this.#overlay.isDestroyed())) {
      return;
    }
    this.#overlayReady = false;
    const linuxPanel = this.#companion;
    const overlay = (this.#overlay = new BrowserWindow({
      title: 'Battly Worlds',
      width: linuxPanel ? 430 : 238,
      height: linuxPanel ? 740 : 62,
      show: false,
      focusable: false,
      frame: linuxPanel,
      transparent: !linuxPanel,
      backgroundColor: linuxPanel ? '#0f1724' : '#00000000',
      resizable: linuxPanel,
      skipTaskbar: !linuxPanel,
      alwaysOnTop: !linuxPanel,
      hasShadow: false,
      webPreferences: {
        preload: join(this.dist, 'preload', 'worlds-overlay.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    }));
    overlay.setMenu(null);
    if (!linuxPanel) {
      overlay.setAlwaysOnTop(true, 'screen-saver');
    }
    if (!linuxPanel && process.platform === 'darwin') {
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (linuxPanel) {
      overlay.on('close', (event) => {
        event.preventDefault();
        this.expand(false);
      });
    }
    this.#mouseInteractive = false;
    overlay.setIgnoreMouseEvents(true);
    overlay.webContents.on('render-process-gone', () => {
      if (this.#overlay !== overlay || overlay.isDestroyed()) {
        return;
      }
      this.#overlayReady = false;
      this.#mouseInteractive = false;
      overlay.setIgnoreMouseEvents(true);
      overlay.hide();
    });
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', (event) => event.preventDefault());
    overlay.webContents.once('did-finish-load', () => {
      if (this.#overlay !== overlay || overlay.isDestroyed()) {
        return;
      }
      void overlay.webContents.insertCSS?.(scrollbarStyle).catch(() => undefined);
      this.#overlayReady = true;
      clearInterval(this.#mouseTimer);
      this.#mouseTimer = setInterval(() => this.#syncMouse(), 50);
      this.#mouseTimer.unref();
      if (this.#snapshot) {
        overlay.webContents.send(desktopChannels.worldsEvent, {
          type: 'snapshot',
          snapshot: this.#snapshot,
        });
      }
      overlay.webContents.send('worlds:game-version', this.#gameVersion);
      overlay.webContents.send('worlds:lan-prompt', this.#lanPrompt);
      overlay.webContents.send('worlds:overlay-preferences', this.#preferences);
      overlay.webContents.send('worlds:shortcuts', this.#settings.shortcuts);
      if (this.#voiceStatus) {
        overlay.webContents.send(desktopChannels.worldsEvent, this.#voiceStatus);
      }
      if (this.#voiceChannel) {
        overlay.webContents.send(desktopChannels.worldsEvent, this.#voiceChannel);
      }
      this.expand(this.#expanded);
      this.#syncLanKeys();
    });
    void overlay.loadURL(this.#overlayUrl).catch((error) => {
      if (this.#overlay !== overlay || overlay.isDestroyed()) {
        return;
      }
      this.#overlayReady = false;
      overlay.hide();
      console.error('[Battly Worlds] Overlay page could not load', error);
    });
  }
  gameStopped(): void {
    this.#nativeClients.delete(this.#gamePid);
    clearInterval(this.#mouseTimer);
    this.#mouseTimer = undefined;
    clearTimeout(this.#trackerWatchdog);
    this.#startRevision++;
    clearInterval(this.#boundsTimer);
    this.#boundsTimer = undefined;
    clearTimeout(this.#lanTimer);
    this.#lanTimer = undefined;
    this.#hiddenByUser = false;
    this.#expanded = false;
    this.#focusOnReveal = false;
    this.#mouseInteractive = false;
    this.#gamePid = 0;
    this.#lanOpen = false;
    this.#lanOffered = false;
    this.#lanPrompt = false;
    this.#syncLanKeys();
    const overlay = this.#overlay;
    if (overlay && !overlay.isDestroyed()) {
      overlay.setIgnoreMouseEvents(true);
      overlay.setFocusable(false);
      if (!overlay.webContents.isDestroyed?.()) {
        overlay.webContents.send('worlds:lan-prompt', false);
        overlay.webContents.send('worlds:overlay-expanded', false);
      }
      overlay.hide();
    }
    const tracker = this.#tracker;
    this.#tracker = undefined;
    tracker?.kill();
    this.#setShortcut(false);
    this.#frame = undefined;
    this.#intent = false;
  }
  stop(): void {
    const overlay = this.#overlay;
    this.#overlay = undefined;
    this.#overlayReady = false;
    this.gameStopped();
    if (overlay && !overlay.isDestroyed()) {
      overlay.destroy();
    }
    for (const notice of this.#notifications) {
      notice.close();
    }
    this.#notifications.clear();
  }
}
