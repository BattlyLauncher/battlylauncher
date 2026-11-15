import {
  BrowserWindow,
  globalShortcut,
  screen,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { desktopChannels } from '../../shared/desktop-api';
import { WindowsMusicOverlayFocus, type MusicOverlayFocus } from './music-overlay-focus';
import {
  emptyMusicPlaybackState,
  type MusicPlaybackState,
} from '../../shared/music/music-contract';
import {
  normalizeMusicOverlayPreferences,
  type MusicOverlayPreferences,
  type MusicOverlaySnapshot,
  type MusicOverlayCommand,
} from '../../shared/music/music-overlay';

export class MusicOverlayDesktop {
  #windows = new Map<string, BrowserWindow>();
  #ready = new WeakSet<BrowserWindow>();
  #interactive = new WeakMap<BrowserWindow, boolean>();
  #bounds = new WeakMap<BrowserWindow, string>();
  #preferences: MusicOverlayPreferences = { widgets: [] };
  #playback: MusicPlaybackState = emptyMusicPlaybackState;
  #displayId = '';
  #open = false;
  #maximized = false;
  #editing = false;
  #shortcut = false;
  #disposed = false;
  #timer?: ReturnType<typeof setTimeout>;
  #writes = Promise.resolve();
  #opening = 0;
  #openingActive = false;
  #previousWindow: BrowserWindow | null = null;
  readonly #focus: MusicOverlayFocus;

  constructor(
    private readonly options: {
      path: string;
      rendererPath: string;
      webPreferences: WebPreferences;
      secure: (window: BrowserWindow) => void;
      control: (command: MusicOverlayCommand) => void;
      focus?: MusicOverlayFocus;
    },
  ) {
    this.#focus = options.focus ?? new WindowsMusicOverlayFocus();
  }

  readonly #displayChanged = (): void => this.#render();
  async start(): Promise<void> {
    try {
      this.#preferences = normalizeMusicOverlayPreferences(
        JSON.parse((await readBoundedRegularFile(this.options.path, 16384)).toString('utf8')),
      );
    } catch {
      /* Missing or invalid widget settings never prevent startup. */
    }
    try {
      this.#shortcut = globalShortcut.register('Control+M', () =>
        this.command({ type: this.#open || this.#openingActive ? 'close' : 'open' }),
      );
    } catch {
      this.#shortcut = false;
    }
    screen.on('display-added', this.#displayChanged);
    screen.on('display-removed', this.#displayChanged);
    screen.on('display-metrics-changed', this.#displayChanged);
  }

  snapshot(sender?: WebContents): MusicOverlaySnapshot {
    const ownDisplay = [...this.#windows].find(([, window]) => window.webContents === sender)?.[0];
    const displays = screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      name: display.label || `Pantalla ${index + 1}`,
      width: display.workArea.width,
      height: display.workArea.height,
    }));
    return {
      playback: this.#playback,
      preferences: this.#preferences,
      displays,
      displayId: ownDisplay ?? this.#displayId,
      open: this.#open && (!ownDisplay || ownDisplay === this.#displayId),
      maximized: this.#maximized,
      editing: this.#editing && this.#open,
      shortcutAvailable: this.#shortcut,
    };
  }
  rendererReady(sender: WebContents): void {
    const ownWindow = [...this.#windows.values()].find((window) => window.webContents === sender);
    if (!ownWindow || ownWindow.isDestroyed()) {
      return;
    }
    this.#ready.add(ownWindow);
    this.#render();
    if (this.#open && this.#windows.get(this.#displayId) === ownWindow) {
      ownWindow.focus();
    }
  }

  updatePlayback(value: MusicPlaybackState): void {
    this.#playback = value;
    if (!this.#timer && !this.#disposed) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#render();
      }, 16);
    }
  }

  configure(value: unknown): Promise<void> {
    const preferences = normalizeMusicOverlayPreferences(value);
    const write = this.#writes.then(async () => {
      await writeFileAtomically(this.options.path, JSON.stringify(preferences));
      this.#preferences = preferences;
      this.#render();
    });
    this.#writes = write.catch(() => {});
    return write;
  }

  async ensureDefaultWidget(): Promise<void> {
    if (this.#preferences.widgets.length || !this.#playback.title) {
      return;
    }
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    await this.configure({
      widgets: [
        {
          id: 'now-playing',
          displayId: String(display.id),
          x: 0.97,
          y: 0.97,
          width: 340,
          height: 100,
        },
      ],
    });
  }

  command(command: MusicOverlayCommand): void {
    if (command.type === 'open') {
      if (this.#openingActive) {
        return;
      }
      if (this.#open) {
        this.#windows.get(this.#displayId)?.focus();
        return;
      }
      const request = ++this.#opening;
      this.#openingActive = true;
      this.#previousWindow = BrowserWindow.getFocusedWindow();
      void this.#focus
        .capture()
        .catch(() => {})
        .then(() => {
          if (this.#disposed || request !== this.#opening) {
            return;
          }
          this.#openingActive = false;
          this.#displayId = String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id);
          this.#open = true;
          this.#render();
          const window = this.#windows.get(this.#displayId);
          if (window && this.#ready.has(window)) {
            window.focus();
          }
        });
    } else if (command.type === 'close') {
      this.#opening++;
      this.#openingActive = false;
      const owned = [...this.#windows.values()].some(
        (window) => !window.isDestroyed() && window.isFocused(),
      );
      this.#open = false;
      this.#editing = false;
      this.#render();
      if (owned) {
        void this.#focus
          .restore()
          .catch(() => false)
          .then((restored) => {
            if (
              !restored &&
              !this.#open &&
              this.#previousWindow &&
              !this.#previousWindow.isDestroyed()
            ) {
              this.#previousWindow.focus();
            }
          });
      }
    } else if (command.type === 'maximize') {
      this.#maximized = !this.#maximized;
      this.#render();
    } else if (command.type === 'edit') {
      this.#editing = !this.#editing;
      if (this.#editing) {
        this.#maximized = false;
      }
      this.#render();
    } else {
      this.options.control(command);
    }
  }

  #render(): void {
    if (this.#disposed) {
      return;
    }
    const displays = screen.getAllDisplays();
    if (this.#open && !displays.some((display) => String(display.id) === this.#displayId)) {
      this.#displayId = String(screen.getPrimaryDisplay().id);
    }
    for (const [id, window] of this.#windows) {
      if (!displays.some((display) => String(display.id) === id)) {
        window.destroy();
        this.#windows.delete(id);
      }
    }
    for (const display of displays) {
      const id = String(display.id);
      const manager = this.#open && id === this.#displayId;
      const localWidgets = this.#preferences.widgets.some((widget) => widget.displayId === id);
      const editing = this.#editing && this.#open && localWidgets;
      const widgets = localWidgets && !!this.#playback.title;
      let window = this.#windows.get(id);
      if (!manager && !editing && !widgets) {
        if (window && !window.isDestroyed()) {
          window.hide();
        }
        continue;
      }
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({
          ...display.workArea,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          focusable: false,
          hasShadow: false,
          webPreferences: this.options.webPreferences,
        });
        this.options.secure(window);
        this.#windows.set(id, window);
        this.#interactive.set(window, false);
        this.#bounds.set(window, JSON.stringify(display.workArea));
        window.setIgnoreMouseEvents(true, { forward: true });
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.on('close', (event) => {
          if (!this.#disposed) {
            event.preventDefault();
            this.command({ type: 'close' });
          }
        });
        window.on('closed', () => this.#windows.delete(id));
        void window
          .loadFile(this.options.rendererPath, { query: { window: 'music', display: id } })
          .catch(() => {
            if (window && !window.isDestroyed()) {
              window.hide();
            }
          });
      }
      if (!this.#ready.has(window)) {
        continue;
      }
      const bounds = JSON.stringify(display.workArea);
      if (this.#bounds.get(window) !== bounds) {
        window.setBounds(display.workArea);
        this.#bounds.set(window, bounds);
      }
      const interactive = manager || editing;
      if (this.#interactive.get(window) !== interactive) {
        if (!interactive && window.isFocused()) {
          window.hide();
        }
        window.setFocusable(interactive);
        window.setIgnoreMouseEvents(!interactive, { forward: true });
        this.#interactive.set(window, interactive);
      }
      window.webContents.send(
        desktopChannels.musicOverlayChanged,
        this.snapshot(window.webContents),
      );
      if (!window.isVisible()) {
        window.showInactive();
      }
    }
  }

  close(): void {
    this.command({ type: 'close' });
  }
  flush(): Promise<void> {
    return this.#writes;
  }
  dispose(): void {
    this.#disposed = true;
    this.#open = false;
    this.#focus.dispose();
    clearTimeout(this.#timer);
    if (this.#shortcut) {
      globalShortcut.unregister('Control+M');
    }
    screen.removeListener('display-added', this.#displayChanged);
    screen.removeListener('display-removed', this.#displayChanged);
    screen.removeListener('display-metrics-changed', this.#displayChanged);
    for (const window of this.#windows.values()) {
      window.destroy();
    }
    this.#windows.clear();
  }
}
