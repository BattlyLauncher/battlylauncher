import { readBoundedResponse } from '../network/read-bounded-response';
import { arch, cpus, freemem, platform, release, totalmem, uptime } from 'node:os';
import type { StructuredLogger } from './structured-logger';
import { sanitizeDiagnosticValue } from './redaction';

async function responseJson(response: Response): Promise<unknown> {
  return JSON.parse(
    await readBoundedResponse(response, 64 * 1024, 'Error report response is too large'),
  ) as unknown;
}

/** Keeps the captured window in main; the renderer can only submit its description. */
export class ErrorReportService {
  readonly #captures = new Map<number, string>();
  readonly #sending = new Set<number>();

  constructor(
    private readonly logger: StructuredLogger,
    private readonly version: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  prepare(owner: number, screenshot: string): string {
    if (this.#sending.has(owner)) {
      throw new Error('El reporte se está enviando.');
    }
    if (!screenshot.startsWith('data:image/png;base64,') || screenshot.length > 12_000_000) {
      throw new Error(
        'No se pudo capturar la ventana. Cierra el reporte y vuelve a pulsar Ctrl + E.',
      );
    }
    this.#captures.set(owner, screenshot);
    return screenshot;
  }

  clear(owner: number): void {
    this.#captures.delete(owner);
  }

  async submit(owner: number, value: unknown, token: () => Promise<string>): Promise<void> {
    if (typeof value !== 'string' || value.trim().length < 10 || value.length > 1000) {
      throw new Error('La descripción debe tener entre 10 y 1000 caracteres.');
    }
    const screenshot = this.#captures.get(owner);
    if (!screenshot) {
      throw new Error('No hay captura. Cierra el reporte y vuelve a pulsar Ctrl + E.');
    }
    if (this.#sending.has(owner)) {
      throw new Error('El reporte se está enviando.');
    }
    this.#sending.add(owner);
    try {
      const authorization = await token();
      if (!authorization) {
        throw new Error('No hay sesión activa. Inicia sesión en Battly para enviar reportes.');
      }
      const timestamp = new Date().toISOString();
      const logs = (await this.logger.tail(500))
        .map((entry) => JSON.stringify(sanitizeDiagnosticValue(entry)))
        .join('\n');
      const systemInfo = {
        platform: platform(),
        arch: arch(),
        release: release(),
        cpus: cpus().length,
        totalMemory: `${Math.round(totalmem() / 1024 ** 3)} GB`,
        freeMemory: `${Math.round(freemem() / 1024 ** 3)} GB`,
        uptime: `${Math.round(uptime() / 3600)} hours`,
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
        chromeVersion: process.versions.chrome,
        battlyVersion: this.version,
        timestamp,
      };
      let response: Response;
      try {
        response = await this.request('https://api.battlylauncher.com/api/error-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization}` },
          body: JSON.stringify({ comment: value.trim(), screenshot, systemInfo, logs, timestamp }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error(
          'No se pudo conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.',
        );
      }
      if (response.status === 429) {
        throw new Error('Has alcanzado el límite de reportes. Inténtalo más tarde.');
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('La sesión ha caducado. Inicia sesión en Battly para enviar el reporte.');
      }
      const result: unknown = await responseJson(response).catch(() => null);
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('success' in result) ||
        result.success !== true
      ) {
        throw new Error('El servidor no pudo guardar el reporte. Vuelve a intentarlo.');
      }
      this.clear(owner);
    } finally {
      this.#sending.delete(owner);
    }
  }
}
