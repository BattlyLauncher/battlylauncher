import { sourceAliases } from './i18n-source-aliases';

interface Template {
  prefix: string;
  pattern: RegExp;
  keys: string[];
  target: string;
  specificity: number;
}
let activeTranslate = (source: string): string => source;
let activeCatalogueSources = new Set<string>();
/** Catalog markup is presentation, never executable HTML or visible source code. */
export function plainLocaleText(value: string): string {
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  if (typeof document === 'undefined') {
    return text;
  }
  const decoder = document.createElement('textarea');
  decoder.innerHTML = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return decoder.value;
}
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches only catalogued sentences; captured names and paths are never translated. */
export function createTextTranslator(entries: Map<string, string>): (source: string) => string {
  const dictionary = new Map<string, string>();
  for (const [source, target] of entries) {
    const key = plainLocaleText(source).replace(/\s+/g, ' ').trim();
    // Keep the catalogue priority when markup aliases normalize to the same text.
    if (key && !dictionary.has(key)) {
      dictionary.set(key, plainLocaleText(target));
    }
  }
  // Internal services may throw English messages. Resolve their original source
  // through the same localized sentence, including when Spanish is selected.
  for (const [original, canonical] of sourceAliases) {
    const target = dictionary.get(plainLocaleText(canonical).replace(/\s+/g, ' ').trim());
    const key = plainLocaleText(original).replace(/\s+/g, ' ').trim();
    if (target && !dictionary.has(key)) {
      dictionary.set(key, target);
    }
  }
  const templates: Template[] = [];
  for (const [source, target] of dictionary) {
    const slots = [...source.matchAll(/\{(\d+|[A-Za-z_]\w*)\}/g)];
    if (
      !slots.length ||
      slots.length > 8 ||
      (source.replace(/\{(?:\d+|[A-Za-z_]\w*)\}/g, '').trim().length < 4 &&
        !slots.every((slot) => /^(?:count|currentPage|totalPages)$/.test(slot[1])))
    ) {
      continue;
    }
    let offset = 0,
      pattern = '^';
    const keys: string[] = [];
    for (const slot of slots) {
      const after = source.slice(slot.index + slot[0].length);
      const before = source.slice(0, slot.index);
      // A count template must not swallow static prose ("Tus playlists" ->
      // "Tus playlists" in another language). Names and paths stay unrestricted.
      const count =
        /^(?:count|hours|minutes|percentage|currentPage|totalPages|start|end|totalHits)$/i.test(
          slot[1],
        ) ||
        /^\s*(?:%|KB\b|MB\b|GB\b|canciones?\b|playlists?\b|archivos?\b|usuarios?\b|jugadores?\b|en sala\b)/i.test(
          after,
        );
      const version = /(?:Versión|Java)\s*$/i.test(before);
      const capture = count ? '([\\d.,\\s]+)' : version ? '([\\w.+-]+)' : '([\\s\\S]*?)';
      pattern += escapePattern(source.slice(offset, slot.index)) + capture;
      keys.push(slot[1]);
      offset = slot.index + slot[0].length;
    }
    pattern += escapePattern(source.slice(offset)) + '$';
    templates.push({
      prefix: source.slice(0, slots[0].index),
      pattern: new RegExp(pattern),
      keys,
      target,
      specificity: source.replace(/\{(?:\d+|[A-Za-z_]\w*)\}/g, '').length,
    });
  }
  templates.sort((a, b) => b.specificity - a.specificity || b.prefix.length - a.prefix.length);
  const translate = (source: string, depth = 0): string => {
    const original = source.trim();
    const trimmed = original.replace(/\s+/g, ' ');
    // Strip catalog markup only for exact static entries. Dynamic captures may
    // contain literal angle brackets in user names and must remain unchanged.
    const direct =
      dictionary.get(trimmed) ??
      (/[<&]/.test(original)
        ? dictionary.get(plainLocaleText(original).replace(/\s+/g, ' '))
        : undefined);
    if (direct) {
      return source.replace(original, () => direct);
    }
    if (trimmed.length > 8000) {
      return source;
    }
    const remoteError =
      /^(?:Error invoking remote method '[^']+':\s*)?(?:Error|TypeError|RangeError):\s*([\s\S]+)$/.exec(
        trimmed,
      );
    if (remoteError && depth < 3) {
      const body = remoteError[1],
        translated = translate(body, depth + 1);
      if (
        translated !== body ||
        dictionary.has(body) ||
        templates.some(
          (template) => body.startsWith(template.prefix) && template.pattern.test(body),
        )
      ) {
        return source.replace(original, () => translated);
      }
    }
    for (const template of templates) {
      if (!trimmed.startsWith(template.prefix)) {
        continue;
      }
      const match = template.pattern.exec(trimmed);
      if (!match) {
        continue;
      }
      const values = new Map(template.keys.map((key, index) => [key, match[index + 1]]));
      const translated = template.target.replace(
        /\{(\d+|[A-Za-z_]\w*)\}/g,
        (slot, key: string) => values.get(key) ?? slot,
      );
      return source.replace(original, () => translated);
    }
    return source;
  };
  return (source) => translate(source);
}

export function configureUiText(entries: Map<string, string>): void {
  activeTranslate = createTextTranslator(entries);
  activeCatalogueSources = new Set(
    [...entries.keys()].map((source) => plainLocaleText(source).replace(/\s+/g, ' ').trim()),
  );
}
/** Keep reviewed multi-sentence copy together; split only uncatalogued composition. */
export function catalogParagraphParts(source: string): readonly string[] {
  const sentences = source.split(/(?<=[.!?])\s+/u),
    parts: string[] = [];
  for (let i = 0; i < sentences.length;) {
    let end = i + 1;
    for (let j = Math.min(sentences.length, i + 8); j > i; j--) {
      if (activeCatalogueSources.has(sentences.slice(i, j).join(' ').replace(/\s+/g, ' ').trim())) {
        end = j;
        break;
      }
    }
    parts.push(sentences.slice(i, end).join(' '));
    i = end;
  }
  return parts;
}
export function translateUiText(source: string): string {
  return activeTranslate(source);
}

export function setUiText(element: HTMLElement, source: string): void {
  // A reused element may previously have displayed a username or other user data.
  element.removeAttribute('translate');
  element.removeAttribute('data-i18n-dynamic');
  element.dataset.uiSource = source;
  element.textContent = translateUiText(source);
}
