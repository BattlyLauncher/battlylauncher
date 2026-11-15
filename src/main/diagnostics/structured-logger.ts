import { lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendPrivateData, readBoundedRegularFile } from '../files/atomic-file';

import type {
  DiagnosticLogEntry,
  DiagnosticLogLevel,
} from '../../shared/diagnostics/diagnostics-contract';
import { sanitizeDiagnosticValue } from './redaction';

const eventPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export class StructuredLogger {
  readonly #path: string;
  readonly #maximumBytes: number;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;

  constructor(path: string, maximumBytes = 2 * 1024 * 1024) {
    this.#path = path;
    this.#maximumBytes = maximumBytes;
  }

  log(
    level: DiagnosticLogLevel,
    event: string,
    context: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    if (!eventPattern.test(event)) {
      throw new TypeError('Invalid diagnostic event name');
    }
    if (this.#pending >= 500) {
      return Promise.resolve();
    }
    let sanitized = sanitizeDiagnosticValue(context);
    if (Buffer.byteLength(JSON.stringify(sanitized)) > 16384) {
      sanitized = { truncated: true };
    }
    const entry: DiagnosticLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      context:
        sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
          ? (sanitized as Readonly<Record<string, unknown>>)
          : {},
    };
    this.#pending++;
    const operation = this.#queue
      .then(() => this.#append(entry))
      .finally(() => {
        this.#pending--;
      });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async tail(limit = 200): Promise<readonly DiagnosticLogEntry[]> {
    await this.#queue;
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    let content: string;
    try {
      const info = await lstat(this.#path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > this.#maximumBytes * 2) {
        return [];
      }
      content = (await readBoundedRegularFile(this.#path, this.#maximumBytes * 2)).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const result: DiagnosticLogEntry[] = [];
    for (const line of content.trim().split('\n').slice(-safeLimit)) {
      try {
        const parsed = JSON.parse(line) as DiagnosticLogEntry;
        if (parsed && eventPattern.test(parsed.event)) {
          result.push(parsed);
        }
      } catch {
        // A truncated final line is ignored; previous structured entries remain usable.
      }
    }
    return result;
  }

  async #append(entry: DiagnosticLogEntry): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    try {
      const info = await lstat(this.#path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TypeError('Diagnostic log path is not a regular file');
      }
      if (info.size >= this.#maximumBytes) {
        const previousPath = `${this.#path}.previous`;
        await unlink(previousPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        });
        await rename(this.#path, previousPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await appendPrivateData(this.#path, `${JSON.stringify(entry)}\n`);
  }
}
