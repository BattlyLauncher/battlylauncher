import { packagedApplication } from '../runtime-mode';
import { updateConfigPath } from './update-config';
import { configureOfficialInstaller } from './official-installer-context';
import { load as readYaml } from 'js-yaml';
import { app } from 'electron';
import { autoUpdater, CancellationToken } from 'electron-updater';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodePrivateData, encodePrivateData } from '../storage/protected-data';
import type { UpdateAction, UpdateSettings, UpdateSnapshot } from '../../shared/updates';

export interface PatchRuntime {
  snapshot(): {
    build: number;
    enabled: boolean;
    ready: boolean;
    rollback: boolean;
    pending: boolean;
    recovered: boolean;
  };
  healthy(): void;
  check(
    signal: AbortSignal,
    channel: UpdateSettings['channel'],
  ): Promise<{ m: { build: number; notes: string; patchVersion?: string } } | null>;
  stage(
    candidate: unknown,
    progress: (value: {
      percent: number;
      downloaded: number;
      reused: number;
      phase?: 'downloading' | 'verifying' | 'installing';
    }) => void,
    signal: AbortSignal,
  ): Promise<string>;
  activate(): void;
  rollback(): void;
}
export const patchRuntime = (): PatchRuntime | undefined =>
  Reflect.get(globalThis, Symbol.for('battly.patch.runtime')) as PatchRuntime | undefined;
export const UPDATE_INTERVAL = 15 * 60_000;
async function updateDeadline<T>(
  task: Promise<T>,
  milliseconds: number,
  cancel?: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          cancel?.();
          reject(
            new Error('No se pudo completar la actualización a tiempo. Comprueba tu conexión.'),
          );
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
interface UpdateOptions {
  ready?: (snapshot: UpdateSnapshot) => void;
  later?: () => void;
  install?: () => Promise<unknown>;
  now?: () => number;
}
export class UpdateService {
  #settingsFile = join(app.getPath('userData'), 'updates.json');
  #settings: UpdateSettings = { channel: app.getVersion().includes('-beta.') ? 'beta' : 'stable' };
  #state: UpdateSnapshot;
  #candidate: Awaited<ReturnType<PatchRuntime['check']>> = null;
  #controller?: AbortController;
  #busy = false;
  #timer?: ReturnType<typeof setInterval>;
  #reminderTimer?: ReturnType<typeof setTimeout>;
  #automaticRun?: Promise<void>;
  #noticeKey = '';
  #nextNotice = 0;
  #pendingInstaller = join(app.getPath('userData'), 'updates-pending.json');
  #resumeInstaller?: string;
  #attemptedInstaller?: string;
  constructor(private options: UpdateOptions = {}) {
    if (packagedApplication) {
      autoUpdater.updateConfigPath = updateConfigPath(
        process.resourcesPath,
        app.getPath('userData'),
      );
    }
    try {
      this.#settings = this.#normalize(
        JSON.parse(
          decodePrivateData(this.#settingsFile, readFileSync(this.#settingsFile)).toString('utf8'),
        ),
      );
    } catch {
      /* defaults */
    }
    try {
      const pending = JSON.parse(
        decodePrivateData(this.#pendingInstaller, readFileSync(this.#pendingInstaller)).toString(
          'utf8',
        ),
      ) as { target?: unknown; attempted?: unknown };
      if (
        typeof pending.target === 'string' &&
        pending.target.length < 100 &&
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pending.target) &&
        pending.target !== app.getVersion()
      ) {
        if (pending.attempted === true) {
          this.#attemptedInstaller = pending.target;
        } else {
          this.#resumeInstaller = pending.target;
        }
      }
    } catch {
      /* No verified installer was prepared by an earlier session. */
    }
    const patch = patchRuntime()?.snapshot();
    this.#state = {
      status: patch?.ready && !patch.pending ? 'ready' : 'idle',
      kind: patch?.ready && !patch.pending ? 'patch' : null,
      version: app.getVersion(),
      build: patch?.build || 1,
      target: '',
      message: patch?.recovered
        ? 'Se ha recuperado una build anterior tras un problema con un parche.'
        : 'Puedes buscar actualizaciones de Battly.',
      percent: 0,
      downloaded: 0,
      reused: 0,
      patchConfigured: Boolean(patch?.enabled),
      rollback: Boolean(patch?.rollback),
      settings: this.#settings,
    };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('download-progress', (p) => {
      if (this.#state.kind === 'installer') {
        Object.assign(this.#state, {
          percent: p.percent,
          downloaded: p.transferred,
          phase: p.percent >= 100 ? 'verifying' : 'downloading',
        });
      }
    });
    if (process.platform === 'win32') {
      Reflect.set(autoUpdater, 'installDirectory', dirname(process.execPath));
    }
    autoUpdater.on('error', (error: Error & { code?: string | number }) => {
      // Installer spawning can fail asynchronously after quitAndInstall returned.
      if (this.#state.kind !== 'installer' || this.#state.status !== 'ready') {
        return;
      }
      autoUpdater.autoInstallOnAppQuit = false;
      this.#state.installationError = true;
      this.#state.phase = undefined;
      // electron-updater 6.8.9 leaves this latch set on asynchronous spawn errors.
      // Reset only that existing latch, so an explicit retry can actually run.
      if ('quitAndInstallCalled' in autoUpdater) {
        Reflect.set(autoUpdater, 'quitAndInstallCalled', false);
      }
      this.#state.message = /1223|EACCES|EPERM|cancel|denied|permission/i.test(
        String(error.code) + ' ' + error.message,
      )
        ? 'No se ha autorizado la instalación. Battly conserva la versión actual; vuelve a intentarlo y acepta el permiso de administrador.'
        : 'No se pudo iniciar el instalador. Battly conserva la versión actual y la actualización está lista para reintentarse.';
    });
    app.once('before-quit', () => {
      if (
        this.#state.kind === 'installer' &&
        this.#state.status === 'ready' &&
        autoUpdater.autoInstallOnAppQuit
      ) {
        this.#markInstallerAttempt();
      }
    });
  }
  #saveInstaller(attempted: boolean): void {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(
      this.#pendingInstaller + '.tmp',
      encodePrivateData(
        this.#pendingInstaller,
        JSON.stringify({ target: this.#state.target, attempted }),
      ),
      { mode: 0o600 },
    );
    renameSync(this.#pendingInstaller + '.tmp', this.#pendingInstaller);
  }
  #markInstallerAttempt(): void {
    if (packagedApplication && process.platform === 'win32') {
      const config = readYaml(
        readFileSync(updateConfigPath(process.resourcesPath, app.getPath('userData')), 'utf8'),
      ) as { owner?: unknown; repo?: unknown };
      configureOfficialInstaller(config, this.#state.target, process.arch, process.env);
    }
    this.#saveInstaller(true);
    this.#attemptedInstaller = this.#state.target;
    this.#resumeInstaller = undefined;
  }
  #normalize(value: unknown): UpdateSettings {
    if (!value || typeof value !== 'object') {
      throw Error('Ajustes inválidos');
    }
    const v = value as Record<string, unknown>;
    if (!['stable', 'beta'].includes(String(v.channel))) {
      throw Error('Ajustes inválidos');
    }
    // Legacy opt-out flags are intentionally discarded, including persisted false values.
    return { channel: v.channel as UpdateSettings['channel'] };
  }
  snapshot(): UpdateSnapshot {
    return { ...this.#state, settings: { ...this.#settings } };
  }
  start(checkImmediately = true): void {
    if (this.#timer) {
      return;
    }
    if (checkImmediately) {
      void this.automatic();
    }
    this.#timer = setInterval(() => {
      void this.automatic();
    }, UPDATE_INTERVAL);
    this.#timer.unref();
    app.once('will-quit', () => this.stop());
  }
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
    }
    if (this.#reminderTimer) {
      clearTimeout(this.#reminderTimer);
    }
    this.#timer = undefined;
    this.#reminderTimer = undefined;
  }
  #scheduleReminder(): void {
    if (this.#reminderTimer) {
      clearTimeout(this.#reminderTimer);
    }
    this.#reminderTimer = setTimeout(() => this.#announce(), UPDATE_INTERVAL);
    this.#reminderTimer.unref();
  }
  #announce(): void {
    if (this.#state.status !== 'ready') {
      return;
    }
    const key = `${this.#state.kind}:${this.#state.target || this.#state.build}`;
    const now = this.options.now?.() ?? Date.now();
    if (key === this.#noticeKey && now < this.#nextNotice) {
      return;
    }
    this.#noticeKey = key;
    this.#nextNotice = now + UPDATE_INTERVAL;
    this.#state.remindAt = 0;
    this.#state.noticeId = (this.#state.noticeId || 0) + 1;
    this.#scheduleReminder();
    try {
      this.options.ready?.(this.snapshot());
    } catch {
      /* The renderer still sees the prepared update. */
    }
  }
  settings(value: unknown): UpdateSnapshot {
    if (this.#busy || this.#state.status === 'ready') {
      throw Error('Termina la actualización pendiente antes de cambiar el canal');
    }
    this.#settings = this.#normalize(value);
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(
      this.#settingsFile + '.tmp',
      encodePrivateData(this.#settingsFile, JSON.stringify(this.#settings)),
      { mode: 0o600 },
    );
    renameSync(this.#settingsFile + '.tmp', this.#settingsFile);
    this.#candidate = null;
    Object.assign(this.#state, {
      status: 'idle',
      kind: null,
      target: '',
      message: 'Preferencias de actualización guardadas.',
    });
    return this.snapshot();
  }
  automatic(): Promise<void> {
    if (this.#automaticRun) {
      return this.#automaticRun;
    }
    this.#automaticRun = this.#runAutomatic()
      .catch(() => {
        this.#state.message = 'No se pudo actualizar';
      })
      .finally(() => {
        this.#automaticRun = undefined;
      });
    return this.#automaticRun;
  }
  async #runAutomatic(): Promise<void> {
    if (this.#busy) {
      return;
    }
    if (this.#state.status === 'ready') {
      this.#announce();
      return;
    }
    await this.action('check');
    if (this.#state.status === 'available') {
      await this.action('download');
      if (this.snapshot().status === 'ready' && this.#state.kind === 'patch') {
        try {
          patchRuntime()!.activate();
        } catch {
          this.#state.status = 'error';
          this.#state.message = 'Parche incompatible o caducado';
        }
      }
      if (
        this.snapshot().status === 'ready' &&
        this.#state.kind === 'installer' &&
        this.#resumeInstaller === this.#state.target
      ) {
        this.#resumeInstaller = undefined;
        try {
          await (this.options.install ? this.options.install() : this.action('install'));
        } catch {
          /* An active game prevents an automatic restart; keep the update prepared. */
        }
      }
      // Never interrupt a game or force the app to quit. The next normal boot applies it.
    }
    this.#announce();
  }
  async action(action: UpdateAction, installerOnly = false): Promise<UpdateSnapshot> {
    if (process.env?.FLATPAK_ID || existsSync('/.flatpak-info')) {
      Object.assign(this.#state, {
        status: 'idle',
        kind: null,
        patchConfigured: false,
        rollback: false,
        message: 'Update Battly through Flatpak or your software store.',
      });
      return this.snapshot();
    }
    if (action === 'cancel') {
      return this.snapshot();
    }
    if (action === 'later') {
      if (this.#state.status === 'ready') {
        this.#nextNotice = (this.options.now?.() ?? Date.now()) + UPDATE_INTERVAL;
        this.#state.remindAt = this.#nextNotice;
        this.#scheduleReminder();
        try {
          this.options.later?.();
        } catch {
          /* The in-app reminder is still deferred. */
        }
      }
      return this.snapshot();
    }
    if (this.#busy) {
      return this.snapshot();
    }
    if (!['check', 'download', 'install', 'rollback'].includes(action)) {
      throw Error('Acción de actualización inválida');
    }
    this.#busy = true;
    this.#controller = new AbortController();
    try {
      if (action === 'check') {
        if (this.#state.status === 'ready') {
          return this.snapshot();
        }
        Object.assign(this.#state, {
          status: 'checking',
          kind: null,
          target: '',
          percent: 0,
          downloaded: 0,
          reused: 0,
          phase: undefined,
          installationError: false,
          message: 'Buscando actualizaciones…',
        });
        if (!packagedApplication || process.windowsStore) {
          this.#state.status = 'idle';
          this.#state.message = process.windowsStore
            ? 'Las actualizaciones de esta edición se gestionan desde Microsoft Store.'
            : 'Las actualizaciones se comprueban en la aplicación instalada.';
          return this.snapshot();
        }
        this.#candidate = null;
        let patchError = '';
        if (!installerOnly && this.#state.patchConfigured) {
          try {
            this.#candidate = await patchRuntime()!.check(
              AbortSignal.any([this.#controller.signal, AbortSignal.timeout(15_000)]),
              this.#settings.channel,
            );
          } catch {
            patchError = 'No se pudo comprobar el canal de parches. ';
          }
        }
        if (this.#controller.signal.aborted) {
          throw Error('Comprobación cancelada');
        }
        if (this.#candidate) {
          Object.assign(this.#state, {
            status: 'available',
            kind: 'patch',
            target: this.#candidate.m.patchVersion || `Build ${this.#candidate.m.build}`,
            message: this.#candidate.m.notes || 'Hay un parche de build disponible.',
          });
        } else {
          autoUpdater.channel = this.#settings.channel === 'beta' ? 'beta' : 'latest';
          autoUpdater.allowPrerelease = this.#settings.channel === 'beta';
          autoUpdater.allowDowngrade = false;
          const result = await updateDeadline(autoUpdater.checkForUpdates(), 15_000);
          // Patch tags are deliberately not semver and carry no updater YAML assets.
          // Keep a second boundary if an upstream provider ever selects one anyway.
          if (result && /(?:^battly-patch-|(?:^|[.-])patch\d)/i.test(result.updateInfo.version)) {
            throw Error('Parche incompatible o caducado');
          }
          const available = Boolean(result?.isUpdateAvailable);
          Object.assign(this.#state, {
            status: available ? 'available' : 'idle',
            kind: available ? 'installer' : null,
            target: available ? result!.updateInfo.version : '',
            message:
              patchError +
              (available
                ? 'Hay una nueva versión de Battly disponible.'
                : 'No hay una versión más reciente disponible.'),
          });
        }
      } else if (action === 'download') {
        if (this.#state.status !== 'available') {
          throw Error('Primero busca una actualización');
        }
        this.#state.status = 'downloading';
        this.#state.phase = 'downloading';
        this.#state.message = 'Descargando y verificando…';
        if (this.#state.kind === 'patch' && this.#candidate) {
          await patchRuntime()!.stage(
            this.#candidate,
            (p) => Object.assign(this.#state, p),
            AbortSignal.any([this.#controller.signal, AbortSignal.timeout(10 * 60_000)]),
          );
        } else {
          const cancellation = new CancellationToken();
          // BaseUpdater registers its quit hook during download, not afterwards.
          autoUpdater.autoInstallOnAppQuit = this.#attemptedInstaller !== this.#state.target;
          await updateDeadline(autoUpdater.downloadUpdate(cancellation), 10 * 60_000, () =>
            cancellation.cancel(),
          );
        }
        this.#state.status = 'ready';
        this.#state.phase = undefined;
        this.#state.percent = 100;
        this.#state.message = 'Actualización preparada. Reinicia Battly para aplicarla.';
        if (this.#state.kind === 'installer') {
          const attempted = this.#attemptedInstaller === this.#state.target;
          this.#state.installationError = attempted;
          this.#saveInstaller(attempted);
          autoUpdater.autoInstallOnAppQuit = !attempted;
        }
      } else if (action === 'install') {
        if (this.#state.status !== 'ready') {
          throw Error('No hay una actualización preparada');
        }
        this.#state.installationError = false;
        this.#state.phase = 'installing';
        if (this.#state.kind === 'patch') {
          patchRuntime()!.activate();
          app.relaunch();
          app.quit();
        } else {
          this.#markInstallerAttempt();
          autoUpdater.autoInstallOnAppQuit = false;
          autoUpdater.quitAndInstall(false, true);
        }
      } else {
        if (!patchRuntime()?.snapshot().rollback) {
          throw Error('No hay una build anterior disponible');
        }
        patchRuntime()!.rollback();
        app.relaunch();
        app.quit();
      }
    } catch (error) {
      if (action === 'download' || action === 'install') {
        autoUpdater.autoInstallOnAppQuit = false;
      }
      this.#state.status = 'error';
      this.#state.message = this.#controller.signal.aborted
        ? 'Actualización cancelada. Puedes volver a buscarla.'
        : error instanceof Error
          ? error.message
          : 'No se pudo actualizar Battly';
    } finally {
      this.#busy = false;
      this.#controller = undefined;
    }
    return this.snapshot();
  }
}
