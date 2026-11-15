import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

/** Only renderer-owned preferences, never account credentials or arbitrary filesystem paths. */
export class RendererPreferences {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string) {}
  private async read(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(
        (await readBoundedRegularFile(this.path, 64 * 1024 * 1024)).toString('utf8'),
      );
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid renderer preferences');
      }
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        this.validate(key, value);
        if (typeof value !== 'string') {
          throw new Error('Invalid renderer preference');
        }
        values[key] = value;
      }
      return values;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }
  private validate(key: unknown, value: unknown): asserts key is string {
    if (
      typeof key !== 'string' ||
      key.length > 512 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      (value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 8 * 1024 * 1024))
    ) {
      throw new Error('Invalid renderer preference');
    }
  }
  migrate(legacy: unknown): Promise<Record<string, string>> {
    const operation = this.pending.then(async () => {
      if (
        !legacy ||
        typeof legacy !== 'object' ||
        Array.isArray(legacy) ||
        Object.keys(legacy).length > 2000
      ) {
        throw new Error('Invalid renderer preferences');
      }
      const values = await this.read();
      for (const [key, value] of Object.entries(legacy)) {
        this.validate(key, value);
        if (value !== null && !Object.hasOwn(values, key)) {
          values[key] = value as string;
        }
      }
      await this.save(values);
      return values;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  set(key: unknown, value: unknown): Promise<void> {
    this.validate(key, value);
    const operation = this.pending.then(async () => {
      const values = await this.read();
      if (value === null) {
        delete values[key];
      } else {
        values[key] = value as string;
      }
      await this.save(values);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  private async save(values: Record<string, string>): Promise<void> {
    const data = JSON.stringify(values);
    if (Buffer.byteLength(data) > 64 * 1024 * 1024 || Object.keys(values).length > 2000) {
      throw new Error('Renderer preference storage limit exceeded');
    }
    await writeFileAtomically(this.path, data);
  }
  async flush(): Promise<void> {
    await this.pending;
  }
}
