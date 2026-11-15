import { readBoundedResponse } from '../network/read-bounded-response';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { terracottaRelease } from './terracotta-release';

/** Terracotta is a separate no-TUN process. No Battly access token is sent to it. */
export class TerracottaRuntime {
  #child: ChildProcess | undefined;
  #port = 0;
  #secret = '';
  #working = '';
  #release: ReturnType<typeof terracottaRelease> | undefined;

  constructor(
    private readonly bundle: string,
    private readonly dataRoot: string,
  ) {}

  async start(): Promise<void> {
    if (this.#child && this.#port) {
      return;
    }
    const executable = await (this.#release ??= terracottaRelease(this.bundle)).prepare();
    this.#secret = randomBytes(32).toString('hex');
    this.#working = join(this.dataRoot, randomBytes(12).toString('hex'));
    await mkdir(this.#working, { recursive: true });
    const portFile = join(this.#working, 'port.json');
    const child = spawn(
      executable,
      [process.platform === 'win32' ? '--hmcl2' : '--hmcl', portFile],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          BATTLY_TERRACOTTA_ROOT: this.#working,
          // Keep EasyTier's executable identity across sessions for Windows Firewall.
          BATTLY_EASYTIER_DIR: join(this.dataRoot, 'native', `${process.platform}-${process.arch}`),
          BATTLY_TERRACOTTA_SECRET: this.#secret,
        },
      },
    );
    this.#child = child;
    let failed = false;
    child.on('error', () => {
      failed = true;
    });
    child.once('exit', () => {
      failed = true;
    });
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (failed) {
          throw new Error('No se pudo iniciar el componente de conexión de BattlyWorlds');
        }
        const raw = await readFile(portFile, 'utf8').catch(() => '');
        if (raw) {
          const port: unknown = (JSON.parse(raw) as Record<string, unknown>).port;
          if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('Puerto de BattlyWorlds no válido');
          }
          this.#port = port;
          await this.request('/meta');
          return;
        }
        await delay(200);
      }
      throw new Error('BattlyWorlds ha tardado demasiado en iniciarse');
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async diagnostics(): Promise<string> {
    const running = !!this.#child && this.#child.exitCode === null;
    const state = running ? await this.request('/state/').catch(() => ({})) : {};
    // Only export known fields/markers. Native logs contain full room credentials.
    const saved = await readFile(join(this.dataRoot, 'last-connection-error.json'), 'utf8').catch(
      () => '',
    );
    let markers: string[] = [];
    try {
      const data = JSON.parse(saved) as { markers?: unknown };
      if (Array.isArray(data.markers)) {
        markers = data.markers.filter((v): v is string => typeof v === 'string').slice(0, 20);
      }
    } catch {
      /* No recorded connection failure. */
    }
    const stateName = (state as Record<string, unknown>).state;
    const status = running
      ? typeof stateName === 'string'
        ? stateName
        : 'Sin respuesta'
      : 'Detenido';
    return `Terracotta: ${status}\n${markers.length ? markers.join('\n') : 'Sin errores de conexión registrados.'}`;
  }

  async request(path: string): Promise<Record<string, unknown>> {
    if (!this.#port || !this.#child || this.#child.exitCode !== null) {
      throw new Error('El componente de BattlyWorlds se ha detenido');
    }
    const response = await fetch(`http://127.0.0.1:${this.#port}${path}`, {
      headers: { 'X-Battly-Terracotta': this.#secret },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error('Terracotta no ha podido completar la conexión');
    }
    const text = await readBoundedResponse(
      response,
      262144,
      'Respuesta de Terracotta demasiado grande',
    );
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  async connect(
    mode: 'host' | 'guest',
    player: string,
    nodes: readonly string[],
    code?: string,
  ): Promise<void> {
    await this.start();
    const query = new URLSearchParams({ player });
    if (code) {
      query.set('room', code);
    }
    for (const node of nodes) {
      query.append('public_nodes', node);
    }
    await this.request(`/state/${mode === 'host' ? 'scanning' : 'guesting'}?${query}`);
  }

  /** Keep only known diagnostic markers; raw native logs contain room secrets. */
  async connectionFailure(type: number, fallback: string): Promise<string> {
    let tail = '';
    if (this.#working) {
      const entries = await readdir(this.#working, { withFileTypes: true });
      const run = entries.find(
        (entry) =>
          entry.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d+$/.test(entry.name),
      );
      const file = run
        ? await open(join(this.#working, run.name, 'application.log'), 'r').catch(() => undefined)
        : undefined;
      if (file) {
        try {
          const size = (await file.stat()).size;
          const buffer = Buffer.alloc(Math.min(size, 262144));
          const { bytesRead } = await file.read(
            buffer,
            0,
            buffer.length,
            Math.max(0, size - buffer.length),
          );
          tail = buffer.subarray(0, bytesRead).toString('utf8');
        } finally {
          await file.close();
        }
      }
    }
    const markers = [
      'Cannot find scaffolding server.',
      'Scaffolding Server is at ',
      'Scaffolding Server has been verified.',
      'Cannot connect to scaffolding server.',
      'Cannot create a port-forward ',
      'MC server is at ',
      'MC connection is OK.',
      'os error 10013',
      'os error 10048',
    ].filter((marker) => tail.includes(marker));
    const has = (marker: string) => markers.includes(marker);
    const message =
      type === 0 && has('Cannot find scaffolding server.')
        ? 'No se ha encontrado al anfitrión en la red de Battly Worlds. Mantén su mundo abierto en LAN y comprueba que ambos dispositivos usan Battly actualizado.'
        : type === 0 && has('Cannot connect to scaffolding server.')
          ? 'Se ha encontrado al anfitrión, pero el túnel de conexión no responde. Comprueba la conexión de ambos dispositivos y vuelve a intentarlo.'
          : type === 2 && has('Cannot create a port-forward ')
            ? 'No se ha podido abrir el puerto local de Battly Worlds. Comprueba si otra aplicación lo está usando o si el firewall lo está bloqueando.'
            : fallback;
    await mkdir(this.dataRoot, { recursive: true });
    await writeFile(
      join(this.dataRoot, 'last-connection-error.json'),
      JSON.stringify(
        {
          date: new Date().toISOString(),
          type,
          markers,
        },
        null,
        2,
      ),
      'utf8',
    );
    return message;
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child) {
      return;
    }
    // Going idle drops EasyTier before terminating its parent process.
    await this.request('/state/ide').catch(() => undefined);
    await this.request('/panic?peaceful=true').catch(() => undefined);
    this.#child = undefined;
    this.#port = 0;
    if (child.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        delay(1500),
      ]);
      if (child.exitCode === null) {
        child.kill();
      }
    }
    if (this.#working) {
      await rm(this.#working, { recursive: true, force: true }).catch(() => undefined);
    }
    this.#working = '';
  }
}
