import { randomUUID, createHash } from 'node:crypto';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import {
  normalizeNotice,
  type BattlyNotice,
  type NoticeSettings,
  type NoticeSnapshot,
} from '../../shared/notifications';

export class NotificationService {
  #items: BattlyNotice[] = [];
  #settings: NoticeSettings = { native: true, actions: true, announcements: true, social: true };
  #queue: Promise<unknown> = Promise.resolve();
  #loaded = false;
  #shown: number[] = [];
  #seen = new Map<string, number>();
  readonly #cleanupTimer: NodeJS.Timeout;
  constructor(
    private path: string,
    private changed: (state: NoticeSnapshot, openId?: string) => void,
    private native: (notice: BattlyNotice, clicked: () => void) => void,
  ) {
    this.#cleanupTimer = setInterval(() => {
      void this.snapshot().catch(() => {
        /* Retry cleanup on the next tick or operation if storage is temporarily unavailable. */
      });
    }, 60000);
    this.#cleanupTimer.unref();
  }
  async #load(): Promise<void> {
    if (this.#loaded) {
      return;
    }
    try {
      const data = JSON.parse(
        (await readBoundedRegularFile(this.path, 2 * 1024 * 1024)).toString(),
      ) as Record<string, unknown>;
      if (!Array.isArray(data.items) || data.items.length > 100) {
        throw new Error('Invalid notification history');
      }
      this.#items = data.items.map((v: unknown) => normalizeNotice(v));
      for (const notice of this.#items) {
        this.#seen.set(notice.id, notice.expiresAt);
      }
      if (Array.isArray(data.seen) && data.seen.length <= 2000) {
        for (const pair of data.seen as unknown[]) {
          if (
            Array.isArray(pair) &&
            typeof pair[0] === 'string' &&
            pair[0].length <= 128 &&
            typeof pair[1] === 'number' &&
            pair[1] > Date.now()
          ) {
            this.#seen.set(pair[0], pair[1]);
          }
        }
      }
      const settings =
        data.settings && typeof data.settings === 'object'
          ? (data.settings as Record<string, unknown>)
          : {};
      for (const key of Object.keys(this.#settings) as (keyof NoticeSettings)[]) {
        if (typeof settings[key] === 'boolean') {
          this.#settings[key] = settings[key];
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    this.#loaded = true;
  }
  #run<T>(operation: () => T | Promise<T>): Promise<T> {
    const pending = this.#queue.then(async () => {
      await this.#load();
      const before = {
        items: this.#items,
        settings: { ...this.#settings },
        seen: new Map(this.#seen),
      };
      try {
        const now = Date.now();
        const active = this.#items.filter((notice) => notice.expiresAt > now);
        if (
          active.length !== this.#items.length ||
          [...this.#seen.values()].some((expires) => expires <= now)
        ) {
          this.#items = active;
          await this.#save();
        }
        return await operation();
      } catch (error) {
        this.#items = before.items;
        this.#settings = before.settings;
        this.#seen = before.seen;
        throw error;
      }
    });
    this.#queue = pending.catch(() => undefined);
    return pending;
  }
  #snapshot(): NoticeSnapshot {
    return structuredClone({ items: this.#items, settings: this.#settings });
  }
  async #save(): Promise<void> {
    this.#seen = new Map(
      [...this.#seen].filter(([, expires]) => expires > Date.now()).slice(-2000),
    );
    await writeFileAtomically(
      this.path,
      JSON.stringify({ ...this.#snapshot(), seen: [...this.#seen] }),
    );
    this.changed(this.#snapshot());
  }
  snapshot(): Promise<NoticeSnapshot> {
    return this.#run(() => this.#snapshot());
  }
  async flush(): Promise<void> {
    clearInterval(this.#cleanupTimer);
    await this.#queue;
  }
  publish(value: unknown): Promise<void> {
    return this.#run(async () => {
      const candidate =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined;
      const notice = normalizeNotice(
        candidate && !candidate.id
          ? {
              ...candidate,
              id: `legacy-${createHash('sha256').update(JSON.stringify(candidate)).digest('hex')}`,
            }
          : value,
      );
      if (notice.expiresAt <= Date.now() || this.#seen.has(notice.id)) {
        return;
      }
      if (
        !this.#settings[
          notice.category === 'action'
            ? 'actions'
            : notice.category === 'social'
              ? 'social'
              : 'announcements'
        ]
      ) {
        return;
      }
      this.#items = [notice, ...this.#items.filter((v) => v.expiresAt > Date.now())].slice(0, 100);
      this.#seen.set(notice.id, notice.expiresAt);
      await this.#save();
      this.#shown = this.#shown.filter((time) => time > Date.now() - 60000);
      if (this.#settings.native && this.#shown.length < 5) {
        this.#shown.push(Date.now());
        try {
          this.native(notice, () => this.changed(this.#snapshot(), notice.id));
        } catch {
          /* The in-app history remains available. */
        }
      }
    });
  }
  action(title: string, body: string, category: BattlyNotice['category'] = 'action'): void {
    void this.publish({ id: randomUUID(), title, body, category }).catch((error: unknown) =>
      console.warn(
        '[notifications] Action could not be stored',
        error instanceof Error ? error.name : 'UnknownError',
      ),
    );
  }
  update(settings: unknown): Promise<NoticeSnapshot> {
    return this.#run(async () => {
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('Invalid notification settings');
      }
      for (const key of Object.keys(this.#settings) as (keyof NoticeSettings)[]) {
        const value = (settings as Record<string, unknown>)[key];
        if (value !== undefined && typeof value !== 'boolean') {
          throw new Error('Invalid notification setting');
        }
      }
      for (const key of Object.keys(this.#settings) as (keyof NoticeSettings)[]) {
        if (typeof (settings as Record<string, unknown>)[key] === 'boolean') {
          this.#settings[key] = (settings as Record<string, boolean>)[key];
        }
      }
      await this.#save();
      return this.#snapshot();
    });
  }
  read(id: unknown): Promise<NoticeSnapshot> {
    return this.#run(async () => {
      if (id !== null && typeof id !== 'string') {
        throw new Error('Invalid notification ID');
      }
      this.#items = this.#items.map((v) => (id === null || v.id === id ? { ...v, read: true } : v));
      await this.#save();
      return this.#snapshot();
    });
  }
  clear(): Promise<NoticeSnapshot> {
    return this.#run(async () => {
      this.#items = [];
      await this.#save();
      return this.#snapshot();
    });
  }
  link(id: unknown, url: unknown): Promise<string> {
    return this.#run(() => {
      const item = this.#items.find((v) => v.id === id && v.expiresAt > Date.now());
      const allowed =
        item &&
        [...item.actions, ...item.dropdowns.flatMap((v) => v.options)].find((v) => v.url === url);
      if (!allowed) {
        throw new Error('Unknown notification link');
      }
      return allowed.url;
    });
  }
}
