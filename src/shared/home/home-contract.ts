export interface BattlyNewsItem {
  readonly author: string;
  readonly content: string;
  readonly id: string;
  readonly publishedAt: string;
  readonly title: string;
  readonly articleHtml?: string;
  readonly translatedHtml?: string;
  readonly originalTitle?: string;
  readonly originalContent?: string;
  readonly imageUrl?: string;
}

export interface HomeSnapshot {
  readonly pendingNews?: boolean;
  readonly pendingMinecraftNews?: boolean;
  readonly minecraftNews: readonly BattlyNewsItem[];
  readonly news: readonly BattlyNewsItem[];
  readonly onlineUsers: number | null;
  readonly services: {
    readonly api: boolean | null;
    readonly web: boolean | null;
  };
  readonly warning: {
    readonly enabled: boolean;
    readonly text: string;
    readonly tone: 'danger' | 'info' | 'warning';
  };
}

const newsIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new TypeError(`Invalid news ${label}`);
  }
  return value;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

export function remoteHtmlToText(value: string, maximumLength = 20_000): string {
  const withoutDangerousBlocks = value.replace(
    /<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  return decodeEntities(
    withoutDangerousBlocks
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/?(?:p|div|section|article|h[1-6]|ul|ol|blockquote|pre|tr)\b[^>]*>/gi, '\n')
      .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maximumLength);
}

export function validateBattlyNews(value: unknown): readonly BattlyNewsItem[] {
  if (!Array.isArray(value)) {
    throw new TypeError('News document must be an array');
  }
  return value.slice(0, 50).map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('Invalid news item');
    }
    const source = candidate as Record<string, unknown>;
    const id = text(own(source, 'id'), 'id', 64);
    if (!newsIdPattern.test(id)) {
      throw new TypeError('Invalid news id');
    }
    const publishDate = text(own(source, 'publish_date'), 'date', 32);
    if (!datePattern.test(publishDate)) {
      throw new TypeError('Invalid news date');
    }
    return {
      id,
      title: remoteHtmlToText(text(own(source, 'title'), 'title', 4096), 256),
      content: remoteHtmlToText(text(own(source, 'content'), 'content', 100_000)),
      articleHtml: text(own(source, 'content'), 'content', 100_000),
      author: remoteHtmlToText(text(own(source, 'author'), 'author', 512), 128),
      publishedAt: publishDate.replace(' ', 'T'),
    };
  });
}
