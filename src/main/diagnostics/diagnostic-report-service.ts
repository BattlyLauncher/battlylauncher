import { randomUUID } from 'node:crypto';
import { arch, freemem, platform, release, totalmem } from 'node:os';

import type { AppInfo } from '../../shared/app-info';
import { writeFileAtomically } from '../files/atomic-file';
import { sanitizeDiagnosticValue } from './redaction';
import type { StructuredLogger } from './structured-logger';

export class DiagnosticReportService {
  readonly #logger: StructuredLogger;
  readonly #appInfo: () => AppInfo;
  readonly #counts: () => Promise<Readonly<Record<string, number>>>;

  constructor(options: {
    readonly logger: StructuredLogger;
    readonly appInfo: () => AppInfo;
    readonly counts?: () => Promise<Readonly<Record<string, number>>>;
  }) {
    this.#logger = options.logger;
    this.#appInfo = options.appInfo;
    this.#counts = options.counts ?? (() => Promise.resolve({}));
  }

  async create(): Promise<Readonly<Record<string, unknown>>> {
    const report = {
      schema: 'battly-diagnostic-report/v1',
      generatedAt: new Date().toISOString(),
      app: this.#appInfo(),
      system: {
        platform: platform(),
        release: release(),
        architecture: arch(),
        memoryTotalMb: Math.round(totalmem() / 1024 / 1024),
        memoryFreeMb: Math.round(freemem() / 1024 / 1024),
      },
      counts: await this.#counts(),
      logs: await this.#logger.tail(200),
    };
    return sanitizeDiagnosticValue(report) as Readonly<Record<string, unknown>>;
  }

  async write(path: string): Promise<void> {
    const report = await this.create();
    await writeFileAtomically(path, `${JSON.stringify(report, null, 2)}\n`, randomUUID());
  }
}
