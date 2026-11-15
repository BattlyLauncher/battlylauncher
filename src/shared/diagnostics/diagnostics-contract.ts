export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticLogEntry {
  readonly timestamp: string;
  readonly level: DiagnosticLogLevel;
  readonly event: string;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface DiagnosticSaveOutcome {
  readonly saved: boolean;
}
