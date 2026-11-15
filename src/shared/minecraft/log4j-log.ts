/** Presentation-only decoder. Raw logs remain unchanged on disk. No XML execution. */
function entities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (source, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (!code.startsWith('#')) {
      return named[code] ?? source;
    }
    const value =
      code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : source;
  });
}

function xmlText(text: string): string {
  // CDATA is literal: do not interpret tags or entities inside it.
  return text
    .split(/(<!\[CDATA\[[\s\S]*?\]\]>)/u)
    .map((part) =>
      part.startsWith('<![CDATA[') ? part.slice(9, -3) : entities(part.replace(/<[^>]*>/gu, '')),
    )
    .join('');
}

function eventText(xml: string): string {
  const opening = xml.match(/^<log4j:Event\b([^>]*)>/u)?.[1] ?? '';
  const attributes: Record<string, string> = {};
  for (const match of opening.matchAll(/([\w:]+)\s*=\s*(["'])(.*?)\2/gu)) {
    attributes[match[1]] = entities(match[3]);
  }
  const parts = [...xml.matchAll(/<log4j:(Message|Throwable)\b[^>]*>([\s\S]*?)<\/log4j:\1>/gu)].map(
    (match) => xmlText(match[2]),
  );
  const timestamp = Number(attributes.timestamp);
  const date = new Date(timestamp);
  const time =
    attributes.timestamp && Number.isFinite(timestamp) && !Number.isNaN(date.getTime())
      ? `${date.toISOString()} `
      : '';
  const context =
    attributes.thread || attributes.level
      ? `[${attributes.thread ?? 'game'}/${attributes.level ?? 'INFO'}] `
      : '';
  const logger = attributes.logger ? `[${attributes.logger}] ` : '';
  return `${time}${context}${logger}${parts.length ? parts.join('\n') : xmlText(xml)}`;
}

/** Keeps partial XML events across stdout/JSONL messages, including multiline CDATA. */
export class Log4jLogDecoder {
  #pending = '';
  push(chunk: string): string[] {
    this.#pending += chunk.replaceAll('\r', '');
    const result: string[] = [];
    while (this.#pending) {
      const event = this.#pending.indexOf('<log4j:Event');
      if (event === 0) {
        const end = this.#pending.indexOf('</log4j:Event>');
        if (end < 0) {
          break;
        }
        result.push(eventText(this.#pending.slice(0, end + 14)));
        this.#pending = this.#pending.slice(end + 14);
        continue;
      }
      const fragment = this.#pending.match(/^\s*<log4j:(Message|Throwable)\b[^>]*>/u);
      if (fragment) {
        const closing = `</log4j:${fragment[1]}>`;
        const end = this.#pending.indexOf(closing);
        if (end < 0) {
          break;
        }
        result.push(xmlText(this.#pending.slice(fragment[0].length, end)));
        this.#pending = this.#pending.slice(end + closing.length);
        continue;
      }
      const newline = this.#pending.indexOf('\n');
      const boundary = event > 0 && (newline < 0 || event < newline) ? event : newline;
      if (boundary < 0) {
        break;
      }
      const plain = this.#pending.slice(0, boundary);
      if (!/^\s*<\/?log4j:[^>]+>\s*$/u.test(plain)) {
        result.push(plain);
      }
      this.#pending = this.#pending.slice(boundary + (boundary === newline ? 1 : 0));
    }
    // A damaged/unclosed event must not retain unbounded game output.
    if (this.#pending.length > 256 * 1024) {
      result.push(...this.flush());
    }
    return result;
  }
  flush(): string[] {
    const pending = this.#pending;
    this.#pending = '';
    if (!pending.trim()) {
      return [];
    }
    const clean = /<\/?log4j:|<!\[CDATA\[/u.test(pending)
      ? xmlText(pending).replaceAll('<![CDATA[', '').replaceAll(']]>', '')
      : pending;
    return clean.trim() ? [clean] : [];
  }
}

export function formatLog4jText(text: string): string {
  const decoder = new Log4jLogDecoder();
  return [...decoder.push(text), ...decoder.flush()].join('\n');
}
