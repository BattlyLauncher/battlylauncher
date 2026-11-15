import type { SocialFriend } from '../shared/social/social-contract';
import type { WorldsOverlayPreferences } from '../shared/social/worlds-overlay-preferences';
import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels } from '../shared/desktop-api';
import type { WorldsOverlayApi } from '../shared/social/worlds-overlay-api';
import type {
  WorldsEvent,
  WorldsPublicRoom,
  WorldsSnapshot,
} from '../shared/social/battly-worlds-contract';
const api: WorldsOverlayApi = {
  writeClipboardText: (value) =>
    ipcRenderer.invoke(desktopChannels.writeClipboardText, value) as Promise<boolean>,
  language: () => ipcRenderer.invoke('settings:language') as Promise<string>,
  respondLan: (accept) => ipcRenderer.invoke('worlds:lan-response', accept) as Promise<void>,
  onLanPrompt: (listener) => {
    ipcRenderer.on('worlds:lan-prompt', (_event, visible: unknown) => {
      if (typeof visible === 'boolean') {
        listener(visible);
      }
    });
  },
  getWorldsSnapshot: () =>
    ipcRenderer.invoke(desktopChannels.getWorldsSnapshot) as Promise<WorldsSnapshot>,
  worldsAction: (action) =>
    ipcRenderer.invoke(desktopChannels.worldsAction, action) as Promise<WorldsSnapshot>,
  getWorldsPublicRooms: (page) =>
    ipcRenderer.invoke(desktopChannels.worldsPublicRooms, page) as Promise<WorldsPublicRoom[]>,
  worldsVoiceCommand: (command) =>
    ipcRenderer.invoke(desktopChannels.worldsVoiceCommand, command) as Promise<void>,
  worldsVoiceParty: (action, value) =>
    ipcRenderer.invoke(desktopChannels.worldsVoiceParty, action, value) as Promise<void>,
  preferences: () =>
    ipcRenderer.invoke('worlds:overlay-preferences') as Promise<WorldsOverlayPreferences>,
  configure: (value) => ipcRenderer.invoke('worlds:overlay-configure', value) as Promise<void>,
  compactHeight: (value) => ipcRenderer.invoke('worlds:overlay-height', value) as Promise<void>,
  onPreferences: (listener) => {
    ipcRenderer.on('worlds:overlay-preferences', (_event, value: WorldsOverlayPreferences) =>
      listener(value),
    );
  },
  expand: (expanded) => ipcRenderer.invoke('worlds:overlay-expand', expanded) as Promise<void>,
  friends: () => ipcRenderer.invoke('worlds:overlay-friends') as Promise<readonly SocialFriend[]>,
  searchUsers: (query) =>
    ipcRenderer.invoke('worlds:overlay-search-users', query) as Promise<readonly string[]>,
  faceImageUrl: (username) => {
    if (typeof username !== 'string' || username.length > 128 || username.includes('\0')) {
      throw new TypeError('Invalid username');
    }
    return ipcRenderer.invoke('worlds:overlay-avatar', username) as Promise<string>;
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
