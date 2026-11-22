import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSecureWebPreferences, isTrustedRendererUrl } from '../security';
import { startupUpdateChannels, type StartupUpdateSnapshot } from '../../shared/startup-updates';
import type { UpdateSnapshot } from '../../shared/updates';
import {
  runStartupUpdate,
  startupUpdateSnapshot,
  type StartupUpdateService,
} from './startup-update-flow';

let activeStartupWindow: BrowserWindow | undefined;
export function focusStartupUpdate(): boolean {
  if (!activeStartupWindow || activeStartupWindow.isDestroyed()) {
    return false;
  }
  if (!activeStartupWindow.webContents.isLoadingMainFrame()) {
    activeStartupWindow.show();
    activeStartupWindow.focus();
  }
  return true;
}

/** A narrow, isolated window: no account, filesystem or desktop IPC access. */
export async function showStartupUpdates(
  service: StartupUpdateService,
  install: () => Promise<unknown>,
  language: string,
  shown: () => void,
  checked: UpdateSnapshot,
): Promise<boolean> {
  if ((checked.status !== 'available' && checked.status !== 'ready') || !checked.kind) {
    return false;
  }
  let initialCheck: typeof checked | undefined = checked;
  const document = join(__dirname, '..', '..', 'renderer', 'startup-update.html');
  const window = new BrowserWindow({
    width: 768,
    height: 432,
    useContentSize: true,
    minWidth: 768,
    minHeight: 432,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e1624',
    title: app.getName(),
    webPreferences: createSecureWebPreferences(
      join(__dirname, '..', '..', 'preload', 'startup-update.js'),
    ),
  });
  window.setMenu(null);
  activeStartupWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  let snapshot = startupUpdateSnapshot(service.snapshot());
  let finished = false;
  let busy = false;
  let handoff = false;
  let resolve!: (quitting: boolean) => void;
  const completed = new Promise<boolean>((done) => {
    resolve = done;
  });
  const send = (state: StartupUpdateSnapshot): void => {
    snapshot = state;
    if (!window.isDestroyed()) {
      window.webContents.send(startupUpdateChannels.snapshot, state);
    }
  };
  const finish = (quitting: boolean): void => {
    if (finished) {
      return;
    }
    finished = true;
    if (activeStartupWindow === window) {
      activeStartupWindow = undefined;
    }
    clearInterval(monitor);
    ipcMain.removeListener(startupUpdateChannels.action, receive);
    app.removeListener('before-quit', exiting);
    if (!window.isDestroyed()) {
      window.destroy();
    }
    resolve(quitting);
  };
  const exiting = (): void => finish(true);
  const attempt = async (retryInstallation = false): Promise<void> => {
    if (busy || finished) {
      return;
    }
    busy = true;
    handoff = false;
    const prepared = initialCheck;
    initialCheck = undefined;
    if (!prepared) {
      send({ ...snapshot, phase: 'checking', percent: null });
    }
    const result = await runStartupUpdate(service, send, install, retryInstallation, prepared);
    busy = false;
    if (finished) {
      return;
    }
    if (result === 'current') {
      finish(false);
    } else if (result === 'error') {
      send({ ...startupUpdateSnapshot(service.snapshot()), phase: 'error', percent: null });
    } else {
      handoff = true;
      send({ ...startupUpdateSnapshot(service.snapshot()), phase: 'installing', percent: null });
    }
  };
  const receive = (event: Electron.IpcMainEvent, action: unknown): void => {
    if (
      finished ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, pathToFileURL(document).href) ||
      snapshot.phase !== 'error' ||
      busy
    ) {
      return;
    }
    if (action === 'retry') {
      void attempt(true);
    } else if (action === 'continue') {
      finish(false);
    }
  };
  const monitor = setInterval(() => {
    if (handoff && service.snapshot().installationError) {
      handoff = false;
      send({ ...startupUpdateSnapshot(service.snapshot()), phase: 'error', percent: null });
    }
  }, 100);
  ipcMain.on(startupUpdateChannels.action, receive);
  app.once('before-quit', exiting);
  window.on('closed', () => {
    if (!finished) {
      finish(true);
      app.quit();
    }
  });
  window.webContents.on('did-finish-load', () => send(snapshot));
  try {
    await window.loadFile(document, { query: { lang: language, platform: process.platform } });
    if (!finished) {
      window.show();
      shown();
      void attempt();
    }
  } catch (error) {
    console.warn(
      '[startup-update] Could not open window:',
      error instanceof Error ? error.message : 'Load failed',
    );
    // A broken presentation must not prevent launching the last working version.
    finish(false);
  }
  return completed;
}
