import type { SocialFriend } from '../shared/social/social-contract';
import type { WorldsOverlayPreferences } from '../shared/social/worlds-overlay-preferences';
import { contextBridge, ipcRenderer } from 'electron';
import { createIpcInvoker } from '../shared/ipc-errors';
import { desktopChannels } from '../shared/desktop-api';
import type { WorldsOverlayApi } from '../shared/social/worlds-overlay-api';
import {
  defaultWorldsShortcuts,
  normalizeWorldsShortcuts,
} from '../shared/social/worlds-shortcuts';
import { bindWorldsShortcutHints } from './worlds-shortcut-hints';
import type {
  WorldsEvent,
  WorldsPublicRoom,
  WorldsSnapshot,
} from '../shared/social/battly-worlds-contract';
const invokeDesktop = createIpcInvoker(ipcRenderer.invoke.bind(ipcRenderer));
const applyShortcuts = bindWorldsShortcutHints(defaultWorldsShortcuts);
ipcRenderer.on('worlds:shortcuts', (_event, value: unknown) =>
  applyShortcuts(normalizeWorldsShortcuts(value)),
);
const api: WorldsOverlayApi = {
  writeClipboardText: (value) =>
    invokeDesktop(desktopChannels.writeClipboardText, value) as Promise<boolean>,
  language: () => invokeDesktop('settings:language') as Promise<string>,
  respondLan: (accept) => invokeDesktop('worlds:lan-response', accept) as Promise<void>,
  onLanPrompt: (listener) => {
    ipcRenderer.on('worlds:lan-prompt', (_event, visible: unknown) => {
      if (typeof visible === 'boolean') {
        listener(visible);
      }
    });
  },
  getWorldsSnapshot: () =>
    invokeDesktop(desktopChannels.getWorldsSnapshot) as Promise<WorldsSnapshot>,
  worldsAction: (action) =>
    invokeDesktop(desktopChannels.worldsAction, action) as Promise<WorldsSnapshot>,
  getWorldsPublicRooms: (page) =>
    invokeDesktop(desktopChannels.worldsPublicRooms, page) as Promise<WorldsPublicRoom[]>,
  worldsVoiceCommand: (command) =>
    invokeDesktop(desktopChannels.worldsVoiceCommand, command) as Promise<void>,
  worldsVoiceParty: (action, value) =>
    invokeDesktop(desktopChannels.worldsVoiceParty, action, value) as Promise<void>,
  preferences: () =>
    invokeDesktop('worlds:overlay-preferences') as Promise<WorldsOverlayPreferences>,
  configure: (value) => invokeDesktop('worlds:overlay-configure', value) as Promise<void>,
  compactHeight: (value) => invokeDesktop('worlds:overlay-height', value) as Promise<void>,
  onPreferences: (listener) => {
    ipcRenderer.on('worlds:overlay-preferences', (_event, value: WorldsOverlayPreferences) =>
      listener(value),
    );
  },
  expand: (expanded) => invokeDesktop('worlds:overlay-expand', expanded) as Promise<void>,
  friends: () => invokeDesktop('worlds:overlay-friends') as Promise<readonly SocialFriend[]>,
  searchUsers: (query) =>
    invokeDesktop('worlds:overlay-search-users', query) as Promise<readonly string[]>,
  faceImageUrl: (username) => {
    if (typeof username !== 'string' || username.length > 128 || username.includes('\0')) {
      throw new TypeError('Invalid username');
    }
    return invokeDesktop('worlds:overlay-avatar', username) as Promise<string>;
  },
  onWorldsEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: WorldsEvent): void =>
      listener(value);
    ipcRenderer.on(desktopChannels.worldsEvent, handler);
    return () => ipcRenderer.removeListener(desktopChannels.worldsEvent, handler);
  },
  onReveal: (listener) => {
    ipcRenderer.on('worlds:overlay-reveal', () => listener());
  },
  onExpanded: (listener) => {
    ipcRenderer.on('worlds:overlay-expanded', (_event, value: unknown) => {
      if (typeof value === 'boolean') {
        listener(value);
      }
    });
  },
  onGameVersion: (listener) => {
    ipcRenderer.on('worlds:game-version', (_event, value: unknown) => {
      if (typeof value === 'string') {
        listener(value);
      }
    });
  },
};
contextBridge.exposeInMainWorld('worldsOverlay', Object.freeze(api));
