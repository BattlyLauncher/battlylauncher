import type { PrivacySettings } from '../../shared/settings/settings-contract';
import { sanitizeDiagnosticValue } from './redaction';

const telemetryEventPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function validEvent(event: string): string {
  if (!telemetryEventPattern.test(event)) {
    throw new TypeError('Invalid telemetry event name');
  }
  return event;
}

export interface DiagnosticTransport {
  send(event: string, payload: unknown): Promise<void>;
}

export class TelemetryService {
  readonly #consent: () => Promise<PrivacySettings>;
  readonly #errorTransport: DiagnosticTransport | null;
  readonly #analyticsTransport: DiagnosticTransport | null;

  constructor(options: {
    readonly consent: () => Promise<PrivacySettings>;
    readonly errorTransport?: DiagnosticTransport;
    readonly analyticsTransport?: DiagnosticTransport;
  }) {
    this.#consent = options.consent;
    this.#errorTransport = options.errorTransport ?? null;
    this.#analyticsTransport = options.analyticsTransport ?? null;
  }

  async captureError(event: string, payload: unknown): Promise<boolean> {
    const normalizedEvent = validEvent(event);
    const settings = await this.#consent();
    if (!settings.telemetryEnabled || !this.#errorTransport) {
      return false;
    }
    await this.#errorTransport.send(normalizedEvent, sanitizeDiagnosticValue(payload));
    return true;
  }

  async track(event: string, payload: unknown): Promise<boolean> {
    const normalizedEvent = validEvent(event);
    const settings = await this.#consent();
    if (!settings.telemetryEnabled || !settings.analyticsLogsEnabled || !this.#analyticsTransport) {
      return false;
    }
    await this.#analyticsTransport.send(normalizedEvent, sanitizeDiagnosticValue(payload));
    return true;
  }
}
