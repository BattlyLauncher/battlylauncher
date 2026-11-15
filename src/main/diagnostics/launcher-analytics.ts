import { randomUUID } from 'node:crypto';
import type { PrivacySettings } from '../../shared/settings/settings-contract';
import { sanitizeDiagnosticValue } from './redaction';

export interface AnalyticsContext {
  privacy: PrivacySettings;
  identity: { userId: string; token: string } | null;
  metadata: Record<string, unknown>;
}
interface QueuedEvent {
  eventId: string;
  eventType: string;
  properties: Record<string, unknown>;
  timestamp: number;
}
const events = new Set([
  'launcher:started',
  'launcher:closed',
  'launcher:panel_changed',
  'launcher:settings_changed',
  'minecraft:started',
  'minecraft:closed',
  'minecraft:crashed',
  'installation:started',
  'installation:completed',
  'installation:failed',
  'mod:installed',
  'mod:removed',
  'theme:applied',
  'music:played',
  'music:paused',
  'music:skipped',
  'friend:added',
  'friend:removed',
  'message:sent',
  'operation:completed',
  'operation:failed',
  'error:occurred',
]);
const fields = new Set([
  'operation',
  'durationMs',
  'startupMs',
  'playtimeMs',
  'version',
  'minecraftVersion',
  'loader',
  'panel',
  'errorCategory',
  'exitCode',
  'success',
  'count',
  'safeMode',
]);

/** Only a fixed category leaves the process; raw messages, URLs and tokens stay local. */
export function analyticsErrorCategory(error: unknown): string {
  const object = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const value = [
    typeof error === 'string' ? error : object.message,
    object.code,
    object.name,
    typeof object.status === 'number' ? String(object.status) : '',
    typeof object.error === 'string' ? object.error : '',
    object.cause instanceof Error ? object.cause.message : '',
  ]
    .filter((v) => typeof v === 'string')
    .join(' ');
  if (/abort|cancel/i.test(value)) {
    return 'cancelled';
  }
  if (/ENOSPC|disk.*full|no space left/i.test(value)) {
    return 'disk-full';
  }
  if (/EACCES|EPERM|permission denied/i.test(value)) {
    return 'permission';
  }
  if (/not available in your country|geo.?restrict|blocked in your country/i.test(value)) {
    return 'music-region';
  }
  if (/sign in.*(bot|age)|confirm.*(bot|age)|age.?restrict/i.test(value)) {
    return 'music-verification';
  }
  if (
    /video unavailable|private video|removed by|copyright|not available|no audio source|requested format.*not available/i.test(
      value,
    )
  ) {
    return 'media-unavailable';
  }
  if (/\b429\b|too many requests/i.test(value)) {
    return 'rate-limit';
  }
  if (
    /\b(401|403)\b|invalid.?token|expired.?token|unauthorized|authentication|sesión.*(caduc|inválid)/i.test(
      value,
    )
  ) {
    return 'authentication';
  }
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|timeout|timed out|\b50[0234]\b/i.test(value)) {
    return 'network';
  }
  if (/checksum|hash mismatch|integrity/i.test(value)) {
    return 'integrity';
  }
  if (/ENOENT|no such file/i.test(value)) {
    return 'missing-file';
  }
  if (
    /UnsupportedClassVersion|class file major version|invalid maximum heap|could not.*java|java.*not found/i.test(
      value,
    )
  ) {
    return 'java-runtime';
  }
  if (/OutOfMemory|heap space|memory allocation/i.test(value)) {
    return 'out-of-memory';
  }
  if (
    /yt-dlp.*failed|extractor.?error|unable to extract|signature.*(failed|solv)|nsig/i.test(value)
  ) {
    return 'music-extractor';
  }
  return 'unknown';
}

/** A failed result is still observable even when the handler resolves instead of throwing. */
export function analyticsFailedResultCategory(result: unknown, operation: string): string {
  const value = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const category = analyticsErrorCategory(value);
  if (category !== 'unknown') {
    return category;
  }
  return operation.startsWith('auth:')
    ? 'authentication-result'
    : operation === 'music:resolve-source'
      ? 'music-source-result'
      : 'operation-result';
}

/** Main-owned identity, no disk queue or credentials in telemetry payloads. */
export class LauncherAnalytics {
  #context: AnalyticsContext | null = null;
  #queue: QueuedEvent[] = [];
  #logs: { logId: string; timestamp: number; level: string; message: string; context: unknown }[] =
    [];
  #recentLogs = new Map<string, number>();
  #heartbeatIntervalMs = 30000;
  #session = '';
  #generation = 0;
  #busy = false;
  #blocked = false;
  #failures = 0;
  #retryAt = 0;
  #heartbeatAt = 0;
  #abort = new AbortController();
  #timer: ReturnType<typeof setInterval> | undefined;
  #startedAt = Date.now();
  #lastPanel = '';
  #lastPanelAt = 0;
  #operations = new Map<string, { at: number; pending?: QueuedEvent }>();
  #logWindowAt = 0;
  #logWindowCount = 0;
  constructor(private readonly request: typeof fetch = fetch) {}

  configure(context: AnalyticsContext): void {
    const logsChanged =
      this.#context?.privacy.analyticsLogsEnabled !== context.privacy.analyticsLogsEnabled;
    const changed =
      this.#context?.identity?.token !== context.identity?.token ||
      this.#context?.identity?.userId !== context.identity?.userId ||
      this.#context?.privacy.telemetryEnabled !== context.privacy.telemetryEnabled;
    this.#context = context;
    if (!changed && logsChanged) {
      this.#generation++;
      this.#abort.abort();
      this.#abort = new AbortController();
    }
    if (changed) {
      this.#generation++;
      this.#abort.abort();
      this.#abort = new AbortController();
      this.#queue = [];
      this.#logs = [];
      this.#session = '';
      this.#recentLogs.clear();
      this.#heartbeatIntervalMs = 30000;
      this.#blocked = false;
      this.#failures = 0;
      this.#retryAt = 0;
      this.#lastPanel = '';
      this.#operations.clear();
      this.#logWindowAt = 0;
      this.#logWindowCount = 0;
    }
    if (!context.privacy.analyticsLogsEnabled) {
      this.#logs = [];
      this.#recentLogs.clear();
    }
    if (!this.enabled) {
      if (this.#timer) {
        clearInterval(this.#timer);
      }
      this.#timer = undefined;
      return;
    }
    if (!this.#timer) {
      this.#timer = setInterval(() => {
        void this.flush();
      }, 5000);
      this.#timer.unref();
    }
    if (changed) {
      this.track('launcher:started', { startupMs: Date.now() - this.#startedAt });
      void this.flush();
    }
  }
  get enabled(): boolean {
    return !!this.#context?.privacy.telemetryEnabled && !!this.#context.identity;
  }
  panel(value: unknown): void {
    if (
      typeof value !== 'string' ||
      ![
        'home',
        'instances',
        'mods',
        'music',
        'social',
        'settings',
        'servers',
        'news',
        'mybattly',
        'download',
        'play',
      ].includes(value)
    ) {
      return;
    }
    if (this.#lastPanel === value || Date.now() - this.#lastPanelAt < 500) {
      return;
    }
    this.#lastPanel = value;
    this.#lastPanelAt = Date.now();
    this.track('launcher:panel_changed', { panel: value });
  }
  track(eventType: string, data: Record<string, unknown> = {}): void {
    if (!this.enabled || this.#blocked || !events.has(eventType)) {
      return;
    }
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!fields.has(key)) {
        continue;
      }
      if (
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12)
      ) {
        properties[key] = value;
      } else if (typeof value === 'string' && /^[a-zA-Z0-9_.:+ -]{1,96}$/.test(value)) {
        properties[key] = value;
      }
    }
    const event = { eventId: randomUUID(), eventType, properties, timestamp: Date.now() };
    if (eventType === 'operation:completed' || eventType === 'operation:failed') {
      const operation = typeof properties.operation === 'string' ? properties.operation : '';
      const category = typeof properties.errorCategory === 'string' ? properties.errorCategory : '';
      const key = `${eventType}:${operation}:${category}`;
      const window = this.#operations.get(key);
      if (window) {
        const pending = window.pending;
        if (pending) {
          const count = Number(pending.properties.count);
          pending.properties.durationMs =
            (Number(pending.properties.durationMs ?? 0) * count +
              Number(properties.durationMs ?? 0)) /
            (count + 1);
          pending.properties.count = count + 1;
          pending.timestamp = event.timestamp;
        } else {
          window.pending = event;
          properties.count = 1;
        }
        return;
      }
      if (this.#operations.size >= 100) {
        this.#operations.delete(this.#operations.keys().next().value!);
      }
      this.#operations.set(key, { at: event.timestamp });
      properties.count = 1;
    }
    if (this.#queue.length >= 200) {
      this.#queue.shift();
    }
    this.#queue.push(event);
  }
  log(level: 'warn' | 'error', message: string, context: Record<string, unknown> = {}): void {
    if (!this.enabled || !this.#context?.privacy.analyticsLogsEnabled || this.#blocked) {
      return;
    }
    // Suppress repeated console failures without a second unbounded deduplication cache.
    const clean = String(sanitizeDiagnosticValue(message)).slice(0, 2000);
    const key = `${level}:${clean}`;
    if (Date.now() - (this.#recentLogs.get(key) ?? 0) < 60000) {
      return;
    }
    const now = Date.now();
    if (now - this.#logWindowAt >= 60000 || now < this.#logWindowAt) {
      this.#logWindowAt = now;
      this.#logWindowCount = 0;
    }
    if (this.#logWindowCount >= 20) {
      return;
    }
    this.#logWindowCount++;
    if (this.#recentLogs.size >= 100) {
      this.#recentLogs.delete(this.#recentLogs.keys().next().value!);
    }
    this.#recentLogs.set(key, Date.now());
    if (this.#logs.length >= 50) {
      this.#logs.shift();
    }
    const sanitized = sanitizeDiagnosticValue(context);
    const bounded =
      Buffer.byteLength(JSON.stringify(sanitized)) <= 3500 ? sanitized : { truncated: true };
    this.#logs.push({
      logId: randomUUID(),
      timestamp: Date.now(),
      level,
      message: clean.slice(0, 1000),
      context: bounded,
    });
  }
  async #post(
    path: string,
    body: unknown,
    context: AnalyticsContext,
  ): Promise<Record<string, unknown>> {
    const response = await this.request(`https://api.battlylauncher.com/api/analytics${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${context.identity!.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok) {
      throw Object.assign(new Error('Analytics request failed'), {
        status: response.status,
        retryAfter: Math.min(
          300000,
          Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1000,
        ),
      });
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Empty analytics response');
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error('Analytics response too large');
      }
      chunks.push(part.value);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const result: unknown = JSON.parse(text);
    if (
      !result ||
      typeof result !== 'object' ||
      !('success' in result) ||
      result.success !== true
    ) {
      throw new Error('Analytics rejected');
    }
    return result;
  }
  async flush(forceOperations = false): Promise<void> {
    if (this.#busy || !this.enabled || this.#blocked || Date.now() < this.#retryAt) {
      return;
    }
    this.#busy = true;
    for (const window of this.#operations.values()) {
      if (
        window.pending &&
        (forceOperations || Date.now() - window.at >= 60000 || Date.now() < window.at)
      ) {
        if (this.#queue.length >= 200) {
          this.#queue.shift();
        }
        this.#queue.push(window.pending);
        window.pending = undefined;
        window.at = Date.now();
      }
    }
    const generation = this.#generation,
      context = this.#context!;
    const current = (): boolean => generation === this.#generation && this.enabled;
    try {
      if (!this.#session) {
        const result = await this.#post(
          '/session/start',
          { userId: context.identity!.userId, metadata: context.metadata },
          context,
        );
        if (!current()) {
          return;
        }
        if (
          typeof result.sessionId !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(result.sessionId)
        ) {
          throw new Error('Invalid analytics session');
        }
        this.#session = result.sessionId;
        if (
          typeof result.heartbeatIntervalMs === 'number' &&
          result.heartbeatIntervalMs >= 30000 &&
          result.heartbeatIntervalMs <= 120000
        ) {
          this.#heartbeatIntervalMs = result.heartbeatIntervalMs;
        }
        this.#heartbeatAt = Date.now();
      }
      this.#queue = this.#queue.filter((entry) => Date.now() - entry.timestamp < 600000);
      const batch = this.#queue.slice(0, 20);
      if (batch.length) {
        await this.#post(
          '/events/batch',
          {
            userId: context.identity!.userId,
            sessionId: this.#session,
            events: batch,
            metadata: context.metadata,
          },
          context,
        );
        if (!current()) {
          return;
        }
        this.#queue = this.#queue.filter((entry) => !batch.includes(entry));
      }
      this.#logs = this.#logs.filter((entry) => Date.now() - entry.timestamp < 600000);
      const logs = this.#logs.slice(0, 5);
      if (logs.length && context.privacy.analyticsLogsEnabled) {
        await this.#post('/logs', { userId: context.identity!.userId, logs }, context);
        if (!current()) {
          return;
        }
        this.#logs = this.#logs.filter((entry) => !logs.includes(entry));
      }
      if (Date.now() - this.#heartbeatAt >= this.#heartbeatIntervalMs) {
        await this.#post(
          '/heartbeat',
          { userId: context.identity!.userId, sessionId: this.#session },
          context,
        );
        if (!current()) {
          return;
        }
        this.#heartbeatAt = Date.now() + Math.floor(Math.random() * 5000);
      }
      this.#failures = 0;
      this.#retryAt = 0;
    } catch (error) {
      if (!current()) {
        return;
      }
      const status = (error as { status?: number }).status;
      if (status === 401 || status === 403) {
        this.#blocked = true;
        this.#queue = [];
        this.#logs = [];
      } else {
        this.#failures++;
        this.#retryAt =
          Date.now() +
          Math.max(
            (error as { retryAfter?: number }).retryAfter ?? 0,
            Math.min(300000, 5000 * 2 ** Math.min(this.#failures, 6)),
          ) +
          Math.random() * 1000;
        if (this.#failures >= 5) {
          this.#queue = [];
          this.#logs = [];
        }
        if (status === 404) {
          this.#session = '';
        }
      }
    } finally {
      this.#busy = false;
    }
  }
  async close(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
    }
    this.#timer = undefined;
    const context = this.#context;
    if (!this.enabled || !context || this.#busy) {
      this.#abort.abort();
      return;
    }
    this.track('launcher:closed', { durationMs: Date.now() - this.#startedAt });
    const deadline = setTimeout(() => this.#abort.abort(), 2000);
    try {
      await this.flush(true);
      if (this.#session) {
        await this.#post(
          '/session/end',
          { userId: context.identity!.userId, sessionId: this.#session },
          context,
        );
      }
    } catch {
      /* Shutdown must not wait for analytics availability. */
    } finally {
      clearTimeout(deadline);
      this.#abort.abort();
    }
  }
}
