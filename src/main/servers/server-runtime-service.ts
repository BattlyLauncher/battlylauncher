import { repairLegacyServerBind } from './server-bind-address';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';

import {
  normalizeServerCommand,
  normalizeServerId,
  type ServerRuntimeEvent,
  type ServerRuntimeSnapshot,
  type ServerStatus,
} from '../../shared/servers/server-contract';
import type { ServerStore } from './server-store';
import { sampleServerProcess, type ProcessMetrics } from './server-process-metrics';
import { limitServerCpu, type ServerCpuLimit } from './server-cpu-limit';

type SpawnServer = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly windowsHide: true;
  },
) => ChildProcessWithoutNullStreams;

export interface ServerRuntimeOptions {
  readonly limitCpu?: typeof limitServerCpu;
  readonly javaPath?: string;
  readonly metricIntervalMs?: number;
  readonly sampleMetrics?: (pid: number) => Promise<ProcessMetrics>;
  readonly spawnServer?: SpawnServer;
}

interface RuntimeState {
  cpuLimit: ServerCpuLimit | null;
  child: ChildProcessWithoutNullStreams | null;
  cpuPercent: number;
  lastCpuSeconds: number | null;
  lastSampleAt: number | null;
  maxPlayers: number;
  logStream: WriteStream | null;
  memoryMb: number;
  players: number;
  onlinePlayers: Set<string>;
  logBuffers: { stdout: string; stderr: string };
  startedAt: string | null;
  status: ServerStatus;
  timer: NodeJS.Timeout | null;
}

async function regularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular file`);
  }
}

export class ServerRuntimeService {
  readonly #listeners = new Set<(event: ServerRuntimeEvent) => void>();
  readonly #options: Required<
    Pick<ServerRuntimeOptions, 'metricIntervalMs' | 'sampleMetrics' | 'spawnServer' | 'limitCpu'>
  > &
    Pick<ServerRuntimeOptions, 'javaPath'>;
  readonly #states = new Map<string, RuntimeState>();
  readonly #store: ServerStore;

  constructor(store: ServerStore, options: ServerRuntimeOptions = {}) {
    this.#store = store;
    this.#options = {
      javaPath: options.javaPath,
      limitCpu: options.limitCpu ?? limitServerCpu,
      metricIntervalMs: options.metricIntervalMs ?? 2_000,
      sampleMetrics: options.sampleMetrics ?? sampleServerProcess,
      spawnServer:
        options.spawnServer ??
        ((executable, args, spawnOptions) =>
          spawn(executable, [...args], {
            ...spawnOptions,
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
          })),
    };
  }

  subscribe(listener: (event: ServerRuntimeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshot(idValue: unknown): ServerRuntimeSnapshot {
    const id = normalizeServerId(idValue);
    return this.#snapshot(id, this.#states.get(id) ?? this.#stoppedState());
  }

  readonly #starting = new Set<string>();

  get active(): boolean {
    return (
      this.#starting.size > 0 ||
      [...this.#states.values()].some(
        (state) => state.status !== 'stopped' && state.status !== 'error',
      )
    );
  }

  async start(idValue: unknown): Promise<ServerRuntimeSnapshot> {
    const id = normalizeServerId(idValue);
    if (this.#starting.has(id)) {
      throw new Error('El servidor ya se está iniciando');
    }
    this.#starting.add(id);
    try {
      return await this.#start(id);
    } finally {
      this.#starting.delete(id);
    }
  }

  async #start(idValue: unknown): Promise<ServerRuntimeSnapshot> {
    const id = normalizeServerId(idValue);
    const current = this.#states.get(id);
    if (current && current.status !== 'stopped' && current.status !== 'error') {
      throw new Error('Server is already active');
    }
    const [directory, summary] = await Promise.all([
      this.#store.directoryPathInternal(id),
      this.#store.list().then((servers) => servers.find((server) => server.id === id)),
    ]);
    if (!summary) {
      throw new Error('Server metadata is unavailable');
    }
    const javaPath =
      this.#options.javaPath ??
      join(directory, 'java', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    await regularFile(javaPath, 'Java runtime');
    await repairLegacyServerBind(directory);
    const baseArguments = [
      `-Xms${Math.min(256, summary.properties.maxMemoryMb)}M`,
      `-Xmx${summary.properties.maxMemoryMb}M`,
      '-XX:+UseG1GC',
      '-XX:MaxGCPauseMillis=200',
    ];
    let launchArguments: readonly string[];
    if (summary.software.launchArguments) {
      const relativeArguments =
        process.platform === 'win32'
          ? summary.software.launchArguments.windows
          : summary.software.launchArguments.unix;
      await regularFile(join(directory, ...relativeArguments.split('/')), 'Server arguments');
      launchArguments = [...baseArguments, `@${relativeArguments}`, 'nogui'];
    } else {
      const jarPath = join(directory, 'server.jar');
      await regularFile(jarPath, 'Server jar');
      launchArguments = [...baseArguments, '-jar', jarPath, 'nogui'];
    }
    const state: RuntimeState = {
      ...this.#stoppedState(),
      maxPlayers: summary.properties.maxPlayers,
      status: 'starting',
    };
    const logsDirectory = join(directory, 'logs');
    await mkdir(logsDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    state.logStream = createWriteStream(join(logsDirectory, `battly-${timestamp}.log`), {
      flags: 'a',
      encoding: 'utf8',
    });
    state.logStream.on('error', () => {
      state.logStream = null;
    });
    this.#states.set(id, state);
    this.#emitSnapshot(id, state);
    const child = this.#options.spawnServer(javaPath, launchArguments, {
      cwd: directory,
      windowsHide: true,
    });
    state.child = child;
    child.once('spawn', () => {
      state.startedAt = new Date().toISOString();
      this.#emitLog(id, '*** Proceso del servidor iniciado ***', 'system');
      this.#emitSnapshot(id, state);
      state.timer = setInterval(() => void this.#sample(id, state), this.#options.metricIntervalMs);
    });
    child.stdin.on('error', (error) => {
      this.#emitLog(id, `No se pudo enviar un comando: ${error.message}`, 'system');
    });
    child.stdout.on('data', (chunk: Buffer) => this.#consumeLog(id, state, chunk, 'stdout'));
    child.stderr.on('data', (chunk: Buffer) => this.#consumeLog(id, state, chunk, 'stderr'));
    child.once('error', (error) => {
      state.status = 'error';
      this.#emitLog(id, `No se pudo iniciar Java: ${error.message}`, 'system');
      this.#cleanup(id, state, false);
    });
    child.once('close', (code) => {
      this.#emitLog(id, `*** Servidor detenido (${code ?? 'sin código'}) ***`, 'system');
      this.#cleanup(id, state, code === 0 || state.status === 'stopping');
    });
    const cpuPercent = summary.properties.maxCpuPercent ?? 100;
    if (cpuPercent < 100) {
      try {
        if (!child.pid) {
          throw new Error('Server process has no PID');
        }
        const limit = await this.#options.limitCpu(child.pid, cpuPercent, () => {
          if (state.child !== child) {
            return;
          }
          this.#emitLog(id, 'CPU limiter stopped unexpectedly; stopping the server.', 'system');
          state.status = 'error';
          child.kill();
        });
        if (state.child !== child) {
          limit.close();
          throw new Error('Server exited before its CPU limit was applied');
        }
        state.cpuLimit = limit;
        this.#emitLog(id, `CPU limit: ${cpuPercent}%`, 'system');
      } catch (error) {
        state.status = 'error';
        child.kill();
        this.#emitLog(
          id,
          `CPU limit failed: ${error instanceof Error ? error.message : String(error)}`,
          'system',
        );
        this.#emitSnapshot(id, state);
        throw new Error('No se pudo aplicar el límite de CPU del servidor', { cause: error });
      }
    }
    return this.#snapshot(id, state);
  }

  stop(idValue: unknown, forceAfterTimeout = true): ServerRuntimeSnapshot {
    const id = normalizeServerId(idValue);
    const state = this.#states.get(id);
    if (!state?.child || state.status === 'stopped') {
      return this.snapshot(id);
    }
    if (state.status === 'stopping') {
      return this.#snapshot(id, state);
    }
    state.status = 'stopping';
    state.cpuLimit?.close();
    state.cpuLimit = null;
    if (!state.child.stdin.destroyed && state.child.stdin.writable) {
      state.child.stdin.write('stop\n');
    }
    this.#emitLog(id, '> stop', 'system');
    this.#emitSnapshot(id, state);
    const child = state.child;
    if (forceAfterTimeout) {
      setTimeout(() => {
        if (state.child === child && state.status === 'stopping') {
          child.kill('SIGTERM');
        }
      }, 60_000).unref();
    }
    return this.#snapshot(id, state);
  }

  async stopAndWait(idValue: unknown): Promise<void> {
    const id = normalizeServerId(idValue);
    const state = this.#states.get(id);
    if (!state?.child) {
      return;
    }
    const log = state.logStream;
    const logClosed =
      log && !log.closed
        ? new Promise<void>((resolve) => {
            log.once('close', resolve);
          })
        : Promise.resolve();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            'El servidor aún está guardando o no responde. No se ha eliminado. Espera a que termine y vuelve a intentarlo.',
          ),
        );
      }, 60000);
      const unsubscribe = this.subscribe((event) => {
        if (event.type !== 'snapshot' || event.snapshot.id !== id || event.snapshot.pid !== null) {
          return;
        }
        clearTimeout(timer);
        unsubscribe();
        resolve();
      });
      try {
        if (state.status !== 'stopping') {
          this.stop(id, false);
        }
      } catch (error) {
        clearTimeout(timer);
        unsubscribe();
        reject(error instanceof Error ? error : new Error('No se pudo detener el servidor'));
      }
    });
    await logClosed;
  }

  async restart(idValue: unknown): Promise<ServerRuntimeSnapshot> {
    const id = normalizeServerId(idValue);
    const state = this.#states.get(id);
    if (!state || state.status === 'stopped' || state.status === 'error') {
      return this.start(id);
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Server did not stop in time'));
      }, 65_000);
      timeout.unref();
      const unsubscribe = this.subscribe((event) => {
        if (
          event.type === 'snapshot' &&
          event.snapshot.id === id &&
          event.snapshot.status === 'stopped'
        ) {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        }
      });
      this.stop(id);
    });
    return this.start(id);
  }

  command(idValue: unknown, commandValue: unknown): void {
    const id = normalizeServerId(idValue);
    const command = normalizeServerCommand(commandValue);
    const state = this.#states.get(id);
    if (!state?.child || state.status !== 'running') {
      throw new Error('Server is not running');
    }
    state.child.stdin.write(`${command}\n`);
    this.#emitLog(id, `> ${command}`, 'system');
  }

  dispose(): void {
    for (const [id, state] of this.#states) {
      state.cpuLimit?.close();
      state.cpuLimit = null;
      if (state.timer) {
        clearInterval(state.timer);
      }
      if (state.child && state.status !== 'stopped') {
        state.child.stdin.write('stop\n');
        state.child.kill('SIGTERM');
        this.#emitLog(id, '*** Runtime cerrado por Battly ***', 'system');
      }
      state.logStream?.end();
      state.logStream = null;
    }
    this.#states.clear();
  }

  async #sample(id: string, state: RuntimeState): Promise<void> {
    const pid = state.child?.pid;
    if (!pid || state.status !== 'running') {
      return;
    }
    try {
      const metrics = await this.#options.sampleMetrics(pid);
      const now = Date.now();
      if (state.lastCpuSeconds !== null && state.lastSampleAt !== null) {
        const elapsed = (now - state.lastSampleAt) / 1000;
        const used = metrics.cpuSeconds - state.lastCpuSeconds;
        state.cpuPercent = Math.max(0, Math.min(100, (used / elapsed / cpus().length) * 100));
      }
      state.lastCpuSeconds = metrics.cpuSeconds;
      state.lastSampleAt = now;
      state.memoryMb = metrics.memoryBytes / 1024 / 1024;
      this.#emitSnapshot(id, state);
    } catch {
      // A failed sample must not stop an otherwise healthy server process.
    }
  }

  #consumeLog(id: string, state: RuntimeState, chunk: Buffer, stream: 'stderr' | 'stdout'): void {
    const lines = (state.logBuffers[stream] + chunk.toString('utf8')).split(/\r?\n/);
    state.logBuffers[stream] = (lines.pop() ?? '').slice(-4000);
    for (const line of lines.filter(Boolean)) {
      const bounded = line.slice(0, 2_000);
      if (state.status === 'starting' && /\bDone \([^)]+\)!.*(?:help|\?)/i.test(bounded)) {
        state.status = 'running';
        this.#emitSnapshot(id, state);
      }
      const joined = bounded.match(/\b([a-zA-Z0-9_]{1,16}) joined the game/);
      const left = bounded.match(/\b([a-zA-Z0-9_]{1,16}) left the game/);
      if (joined) {
        state.onlinePlayers.add(joined[1]);
      }
      if (left) {
        state.onlinePlayers.delete(left[1]);
      }
      if (joined || left) {
        state.players = state.onlinePlayers.size;
        this.#emitSnapshot(id, state);
      }
      const players = bounded.match(/There are (\d+) of a max of (\d+) players online/i);
      if (players?.[1] && players[2]) {
        state.players = Math.max(0, Number(players[1]));
        state.maxPlayers = Math.max(1, Number(players[2]));
        const names = bounded.split('players online:')[1];
        if (names !== undefined) {
          state.onlinePlayers = new Set(
            names
              .split(',')
              .map((name) => name.trim())
              .filter((name) => /^[a-zA-Z0-9_]{1,16}$/.test(name)),
          );
        }
        this.#emitSnapshot(id, state);
      }
      this.#emitLog(id, bounded, stream);
    }
  }

  #cleanup(id: string, state: RuntimeState, stopped: boolean): void {
    state.cpuLimit?.close();
    state.cpuLimit = null;
    if (state.timer) {
      clearInterval(state.timer);
    }
    for (const stream of ['stdout', 'stderr'] as const) {
      if (state.logBuffers[stream]) {
        this.#emitLog(id, state.logBuffers[stream].slice(0, 2000), stream);
      }
      state.logBuffers[stream] = '';
    }
    state.logStream?.end();
    state.timer = null;
    state.logStream = null;
    state.child = null;
    state.cpuPercent = 0;
    state.memoryMb = 0;
    state.players = 0;
    state.onlinePlayers.clear();
    state.status = stopped ? 'stopped' : 'error';
    this.#emitSnapshot(id, state);
  }

  #emitLog(id: string, line: string, stream: 'stderr' | 'stdout' | 'system'): void {
    this.#states.get(id)?.logStream?.write(`[${new Date().toISOString()}] [${stream}] ${line}\n`);
    this.#emit({ type: 'log', id, line, stream });
  }

  #emitSnapshot(id: string, state: RuntimeState): void {
    this.#emit({ type: 'snapshot', snapshot: this.#snapshot(id, state) });
  }

  #emit(event: ServerRuntimeEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #snapshot(id: string, state: RuntimeState): ServerRuntimeSnapshot {
    return {
      id,
      status: state.status,
      pid: state.child?.pid ?? null,
      cpuPercent: Number(state.cpuPercent.toFixed(1)),
      memoryMb: Math.round(state.memoryMb),
      players: state.players,
      onlinePlayers: [...state.onlinePlayers],
      maxPlayers: state.maxPlayers,
      startedAt: state.startedAt,
    };
  }

  #stoppedState(): RuntimeState {
    return {
      cpuLimit: null,
      child: null,
      cpuPercent: 0,
      lastCpuSeconds: null,
      lastSampleAt: null,
      maxPlayers: 0,
      logStream: null,
      memoryMb: 0,
      players: 0,
      onlinePlayers: new Set(),
      logBuffers: { stdout: '', stderr: '' },
      startedAt: null,
      status: 'stopped',
      timer: null,
    };
  }
}
