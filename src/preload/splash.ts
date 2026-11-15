import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels } from '../shared/desktop-api';

// The splash only receives startup progress; it never invokes desktop IPC.
contextBridge.exposeInMainWorld(
  'battly',
  Object.freeze({
    onStartupProgress(
      listener: (change: { progress: number; status: string }) => void,
    ): () => void {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return;
        }
        const progress = value as Record<string, unknown>;
        if (
          typeof progress.progress !== 'number' ||
          !Number.isFinite(progress.progress) ||
          progress.progress < 0 ||
          progress.progress > 100 ||
          typeof progress.status !== 'string' ||
          progress.status.length > 200
        ) {
          return;
        }
        listener({ progress: progress.progress, status: progress.status });
      };
      ipcRenderer.on(desktopChannels.startupProgress, handler);
      return () => ipcRenderer.removeListener(desktopChannels.startupProgress, handler);
    },
  }),
);
