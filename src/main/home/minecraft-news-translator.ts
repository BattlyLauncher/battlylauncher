import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdir, unlink, lstat } from 'node:fs/promises';
import { remoteHtmlToText, type BattlyNewsItem } from '../../shared/home/home-contract';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

const languages: Readonly<Record<string, string>> = {
  es: 'es',
  pt: 'pt',
  fr: 'fr',
  de: 'de',
  it: 'it',
  ru: 'ru',
  ja: 'ja',
  ar: 'ar',
  zh: 'zh-CN',
};
const MAX_CHUNK = 4000;
const MAX_RESPONSE = 128 * 1024;

/** Public Mojang text only. Never send account, profile or launcher data. */
export class MinecraftNewsTranslator {
  readonly #pending = new Map<string, Promise<BattlyNewsItem>>();
  readonly #failed = new Map<string, number>();
  readonly #cache: string;
  readonly #fetch: typeof fetch;
  constructor(cache: string, fetchImplementation: typeof fetch = fetch) {
    this.#cache = cache;
    this.#fetch = fetchImplementation;
  }

  async translate(
    items: readonly BattlyNewsItem[],
    language: string,
    updated: (items: readonly BattlyNewsItem[]) => void,
  ): Promise<readonly BattlyNewsItem[]> {
    const target = languages[language.toLowerCase().split(/[-_]/)[0]];
    if (!target) {
      updated(items);
      return items;
    }
    const result = [...items];
    let index = 0;
    // At most two articles translate at once; each article sends bounded sequential chunks.
    await Promise.all(
      Array.from({ length: Math.min(2, items.length) }, async () => {
        while (index < items.length) {
          const current = index++;
          const item = items[current];
          result[current] = await this.#item(item, target).catch(() => item);
          updated([...result]);
        }
      }),
    );
    await this.#prune().catch(() => undefined);
    return result;
  }

  #item(item: BattlyNewsItem, target: string): Promise<BattlyNewsItem> {
    const key = createHash('sha256')
      .update(JSON.stringify([2, target, item.title, item.content, item.articleHtml]))
      .digest('hex');
    const pending = this.#pending.get(key);
    if (pending) {
      return pending.then((translated) => ({
        ...item,
        title: translated.title,
        content: translated.content,
        translatedHtml: translated.translatedHtml,
        originalTitle: item.title,
        originalContent: item.content,
      }));
    }
    const promise = this.#load(item, target, key)
      .catch((error) => {
        this.#failed.set(key, Date.now());
        if (this.#failed.size > 200) {
          this.#failed.delete(this.#failed.keys().next().value!);
        }
        throw error;
      })
      .finally(() => this.#pending.delete(key));
    this.#pending.set(key, promise);
    return promise;
  }

  async #load(item: BattlyNewsItem, target: string, key: string): Promise<BattlyNewsItem> {
    const path = join(this.#cache, `${key}.json`);
    try {
      const cached = JSON.parse(
        (await readBoundedRegularFile(path, 200_000)).toString('utf8'),
      ) as Record<string, unknown>;
      if (
        cached.version === 2 &&
        cached.key === key &&
        cached.language === target &&
        typeof cached.title === 'string' &&
        cached.title.length <= 256 &&
        typeof cached.content === 'string' &&
        cached.content.length <= 40_000
      ) {
        return {
          ...item,
          title: remoteHtmlToText(cached.title, 256),
          content: remoteHtmlToText(cached.content, 40_000),
          originalTitle: item.title,
          originalContent: item.content,
          translatedHtml:
            typeof cached.translatedHtml === 'string' && cached.translatedHtml.length <= 200_000
              ? cached.translatedHtml
              : undefined,
        };
      }
    } catch {
      /* Missing/corrupt cache is regenerated from public source text. */
    }
    if (Date.now() - (this.#failed.get(key) ?? 0) < 60_000) {
      throw new Error('News translation temporarily unavailable');
    }
    const title = remoteHtmlToText(await this.#text(item.title, target), 256);
    const translatedHtml = item.articleHtml
      ? await this.#html(item.articleHtml, target)
      : undefined;
    const content = translatedHtml
      ? remoteHtmlToText(translatedHtml, 40_000)
      : remoteHtmlToText(await this.#text(item.content, target), 40_000);
    if (!title || (item.content && !content)) {
      throw new Error('Empty news translation');
    }
    const translated = {
      ...item,
      title,
      content,
      translatedHtml,
      originalTitle: item.title,
      originalContent: item.content,
    };
    await writeFileAtomically(
      path,
      JSON.stringify({ version: 2, key, language: target, title, content, translatedHtml }),
    ).catch(() => undefined);
    return translated;
  }

  /** Translate only prose, retaining source tags, links and code verbatim. */
  async #html(html: string, target: string): Promise<string> {
    const tokens = html.split(/(<[^>]*>)/u);
    const prose: { index: number; text: string }[] = [];
    let protectedDepth = 0;
    tokens.forEach((token, index) => {
      if (token.startsWith('<')) {
        if (/^<(?:code|pre|script|style)\b/iu.test(token)) {
          protectedDepth++;
        }
        if (/^<\/(?:code|pre|script|style)\s*>/iu.test(token)) {
          protectedDepth = Math.max(0, protectedDepth - 1);
        }
      } else if (!protectedDepth && token.trim()) {
        prose.push({ index, text: remoteHtmlToText(token) });
      }
    });
    for (let start = 0; start < prose.length;) {
      const batch: typeof prose = [];
      let size = 0;
      while (start < prose.length && (size < 2500 || !batch.length)) {
        const part = prose[start++];
        batch.push(part);
        size += part.text.length + 32;
      }
      const marked = batch.map((part, index) => `BATTLYBLOCK${index}END\n${part.text}`).join('\n');
      const translated = await this.#text(marked, target);
      const matches = [...translated.matchAll(/BATTLYBLOCK\s*(\d+)\s*END/gu)];
      if (
        matches.length !== batch.length ||
        matches.some((match, index) => Number(match[1]) !== index)
      ) {
        throw new Error('News translation lost article structure');
      }
      batch.forEach((part, index) => {
        const match = matches[index];
        const text = translated
          .slice(match.index + match[0].length, matches[index + 1]?.index ?? translated.length)
          .trim();
        if (!text) {
          throw new Error('Empty article translation');
        }
        const original = tokens[part.index];
        tokens[part.index] =
          (original.match(/^\s*/u)?.[0] ?? '') +
          text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;') +
          (original.match(/\s*$/u)?.[0] ?? '');
      });
    }
    return tokens.join('');
  }

  async #text(text: string, target: string): Promise<string> {
    if (text.length > 20_000) {
      throw new RangeError('News translation input is too large');
    }
    const output: string[] = [];
    let remainder = text;
    while (remainder) {
      let length = Math.min(MAX_CHUNK, remainder.length);
      if (length < remainder.length) {
        const boundary = remainder.lastIndexOf('\n', length);
        if (boundary > length / 2) {
          length = boundary + 1;
        }
        if (/^[\uDC00-\uDFFF]$/.test(remainder[length])) {
          length--;
        }
      }
      const chunk = remainder.slice(0, length);
      remainder = remainder.slice(length);
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.search = new URLSearchParams({
        client: 'gtx',
        sl: 'en',
        tl: target,
        dt: 't',
        q: chunk,
      }).toString();
      const response = await this.#fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok || !response.body) {
        throw new Error('News translation request failed');
      }
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        bytes += next.value.byteLength;
        if (bytes > MAX_RESPONSE) {
          await reader.cancel();
          throw new RangeError('News translation response is too large');
        }
        chunks.push(Buffer.from(next.value));
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new TypeError('Invalid news translation response');
      }
      const translated = data[0]
        .map((segment: unknown) => {
          if (!Array.isArray(segment) || typeof segment[0] !== 'string') {
            throw new TypeError('Invalid news translation segment');
          }
          return segment[0];
        })
        .join('');
      if (!translated || translated.length > 16_000) {
        throw new TypeError('Invalid news translation text');
      }
      output.push(translated);
    }
    return output.join('');
  }

  async #prune(): Promise<void> {
    const entries = (await readdir(this.#cache)).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    if (entries.length <= 200) {
      return;
    }
    const dated = await Promise.all(
      entries.map(async (name) => ({
        name,
        modified: (await lstat(join(this.#cache, name))).mtimeMs,
      })),
    );
    dated.sort((left, right) => left.modified - right.modified);
    // Keep recent content while bounding disk usage across language/source changes.
    for (const { name } of dated.slice(0, entries.length - 200)) {
      if (!this.#pending.has(name.slice(0, -5))) {
        await unlink(join(this.#cache, name)).catch(() => undefined);
      }
    }
  }
}
