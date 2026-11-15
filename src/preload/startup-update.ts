import { contextBridge, ipcRenderer } from 'electron';
import {
  startupUpdateChannels,
  isStartupUpdateSnapshot,
  type StartupUpdateBridge,
} from '../shared/startup-updates';

const bridge: StartupUpdateBridge = {
  onSnapshot(listener) {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (isStartupUpdateSnapshot(value)) {
        listener(value);
      }
    };
    ipcRenderer.on(startupUpdateChannels.snapshot, receive);
    return () => ipcRenderer.removeListener(startupUpdateChannels.snapshot, receive);
  },
  action(action) {
    if (action === 'retry' || action === 'continue') {
      ipcRenderer.send(startupUpdateChannels.action, action);
    }
  },
};
contextBridge.exposeInMainWorld('startupUpdates', Object.freeze(bridge));
