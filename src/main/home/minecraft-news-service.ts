import { remoteHtmlToText, type BattlyNewsItem } from '../../shared/home/home-contract';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

const MAX_BYTES = 2 * 1024 * 1024;

function trustedUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Minecraft news URL is not trusted');
  }
  return url;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    throw new Error('Minecraft news request failed');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    length += result.value.byteLength;
    if (length > MAX_BYTES) {
      await reader.cancel();
      throw new RangeError('Minecraft news response is too large');
    }
    chunks.push(result.value);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(data)) as unknown;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Minecraft news document');
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

export class MinecraftNewsService {
  readonly #fetch: typeof fetch;
  readonly #indexUrl: URL;
  readonly #timeoutMs: number;
  readonly #cachePath: string | undefined;

  constructor(
    indexUrl = 'https://launchercontent.mojang.com/v2/javaPatchNotes.json',
    fetchImplementation: typeof fetch = fetch,
    timeoutMs = 10_000,
    cachePath?: string,
  ) {
    this.#indexUrl = trustedUrl(indexUrl);
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
    this.#cachePath = cachePath;
  }

  async load(): Promise<readonly BattlyNewsItem[]> {
    try {
      const items = await this.#loadRemote();
      if (this.#cachePath) {
        await writeFileAtomically(this.#cachePath, JSON.stringify(items)).catch(() => undefined);
      }
      return items;
    } catch (error) {
      const cached = await this.cached();
      if (cached.length) {
        return cached;
      }
      throw error;
    }
  }

  async cached(): Promise<readonly BattlyNewsItem[]> {
    if (!this.#cachePath) {
      return [];
    }
    try {
      const items: unknown = JSON.parse(
        (await readBoundedRegularFile(this.#cachePath, MAX_BYTES)).toString('utf8'),
      );
      if (!Array.isArray(items) || items.length > 10) {
        return [];
      }
      return items.map((item) => {
        const source = object(item);
        if (
          typeof source.id !== 'string' ||
          source.id.length > 64 ||
          typeof source.title !== 'string' ||
          source.title.length > 256 ||
          typeof source.content !== 'string' ||
          source.content.length > 20_000 ||
          typeof source.publishedAt !== 'string' ||
          Number.isNaN(Date.parse(source.publishedAt))
        ) {
          throw new TypeError('Invalid cached Minecraft news');
        }
        return {
          id: source.id,
          title: remoteHtmlToText(source.title, 256),
          content: remoteHtmlToText(source.content),
          author: 'Mojang',
          publishedAt: source.publishedAt,
          articleHtml:
            typeof source.articleHtml === 'string' && source.articleHtml.length <= 100_000
              ? source.articleHtml
              : undefined,
          imageUrl:
            typeof source.imageUrl === 'string' &&
            source.imageUrl.startsWith(`${this.#indexUrl.origin}/`)
              ? source.imageUrl
              : undefined,
        };
      });
    } catch {
      return [];
    }
  }

  async #loadRemote(): Promise<readonly BattlyNewsItem[]> {
    const index = object(await this.#request(this.#indexUrl));
    const entries = own(index, 'entries');
    if (!Array.isArray(entries) || entries.length > 5_000) {
      throw new TypeError('Invalid Minecraft news entries');
    }
    const summaries = entries
      .flatMap((candidate) => {
        const entry = object(candidate);
        const title = own(entry, 'title');
        const date = own(entry, 'date');
        const contentPath = own(entry, 'contentPath');
        const shortText = own(entry, 'shortText');
        if (
          typeof title !== 'string' ||
          title.length > 512 ||
          typeof date !== 'string' ||
          Number.isNaN(new Date(date).valueOf()) ||
          typeof contentPath !== 'string' ||
          contentPath.length > 512 ||
          contentPath.includes('..')
        ) {
          return [];
        }
        return [
          {
            title,
            date,
            contentPath,
            shortText: typeof shortText === 'string' && shortText.length <= 20_000 ? shortText : '',
            image:
              typeof own(entry, 'image') === 'object' && own(entry, 'image') !== null
                ? own(object(own(entry, 'image')), 'url')
                : undefined,
          },
        ];
      })
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 10);
    return Promise.all(
      summaries.map(async (summary, index) => {
        const contentUrl = trustedUrl(new URL(summary.contentPath, this.#indexUrl).toString());
        if (contentUrl.origin !== this.#indexUrl.origin) {
          throw new TypeError('Invalid Minecraft content origin');
        }
        const body = await this.#request(contentUrl)
          .then((value) => own(object(value), 'body'))
          .catch(() => summary.shortText);
        return {
          id: `minecraft-${index}-${new Date(summary.date).valueOf()}`,
          title: remoteHtmlToText(summary.title, 256),
          content: remoteHtmlToText(
            typeof body === 'string' && body ? body : summary.shortText,
            20_000,
          ),
          author: 'Mojang',
          publishedAt: new Date(summary.date).toISOString(),
          articleHtml: typeof body === 'string' && body.length <= 100_000 ? body : undefined,
          imageUrl:
            typeof summary.image === 'string' && summary.image.startsWith('/v2/images/')
              ? new URL(summary.image, this.#indexUrl).toString()
              : undefined,
        };
      }),
    );
  }

  async #request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await boundedJson(
        await this.#fetch(url, { cache: 'no-store', redirect: 'error', signal: controller.signal }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
