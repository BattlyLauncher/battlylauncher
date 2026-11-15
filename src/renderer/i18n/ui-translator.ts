import type { LanguageStrings } from './language-service';
import { configureUiText, plainLocaleText, setUiText, translateUiText } from './dialog-text';
const translatedAttributes = [
  'title',
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'alt',
  'label',
  'value',
] as const;
const attributeSelector = translatedAttributes.map((attribute) => `[${attribute}]`).join(',');
export { plainLocaleText } from './dialog-text';

export function setUserText(
  element: HTMLElement,
  value: string | null | undefined,
  fallback?: string,
): void {
  if (!value && fallback !== undefined) {
    element.removeAttribute('translate');
    element.removeAttribute('data-i18n-dynamic');
    setUiText(element, fallback);
    return;
  }
  delete element.dataset.uiSource;
  element.setAttribute('translate', 'no');
  element.textContent = value ?? '';
}

export function flattenStrings(
  strings: LanguageStrings,
  prefix = '',
  result = new Map<string, string>(),
): Map<string, string> {
  for (const [key, value] of Object.entries(strings)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result.set(path, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenStrings(value as LanguageStrings, path, result);
    }
  }
  return result;
}

/** Translate application copy only. User content must opt out with translate=no. */
export class UiTranslator {
  readonly #source: Map<string, string>;
  readonly #texts = new WeakMap<Node, { source: string; rendered: string }>();
  readonly #attributes = new WeakMap<Element, Map<string, { source: string; rendered: string }>>();
  #dictionary = new Map<string, string>();
  #target = new Map<string, string>();
  #observer: MutationObserver | undefined;
  #queued = new Set<Node>();
  #scheduled = false;
  #title: { source: string; rendered: string } | undefined;
  constructor(
    source: LanguageStrings,
    private readonly formatText: (text: string) => string = (text) => text,
  ) {
    this.#source = flattenStrings(source);
  }
  setStrings(strings: LanguageStrings): void {
    const target = flattenStrings(strings);
    this.#target = target;
    this.#dictionary.clear();
    // Complete, reviewed UI catalogues take precedence over legacy aliases and
    // the English-only modal fallback merged into an incomplete language pack.
    const priority = (key: string): number =>
      /^(reviewedCopy|interface|modalCopy|gameSettings)\./.test(key)
        ? 0
        : key.startsWith('modalFallback.')
          ? 2
          : 1;
    const entries = [...this.#source].sort(([a], [b]) => priority(a) - priority(b));
    for (const [key, source] of entries) {
      const translated = target.get(key);
      if (source.trim() && translated && !this.#dictionary.has(source.trim())) {
        this.#dictionary.set(source.trim(), translated);
      }
    }
    configureUiText(this.#dictionary);
    const titleSource =
      this.#title?.rendered === document.title ? this.#title.source : document.title;
    const title = this.#translate(titleSource);
    this.#title = { source: titleSource, rendered: title };
    if (title !== document.title) {
      document.title = title;
    }
    this.apply(document.body);
  }
  start(): void {
    if (this.#observer) {
      return;
    }
    this.#observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach((node) => this.#queued.add(node));
        } else {
          this.#queued.add(record.target);
        }
      }
      if (this.#scheduled) {
        return;
      }
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        const roots = [...this.#queued];
        this.#queued.clear();
        // Keep observing: disconnecting here drops concurrent async UI updates.
        // apply() writes only changed values, so our own records converge safely.
        for (const root of roots) {
          if (root.isConnected) {
            this.apply(root);
          }
        }
      });
    });
    this.#observe();
  }
  #observe(): void {
    this.#observer?.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        ...translatedAttributes,
        'data-string-id',
        'data-string-id-placeholder',
        'data-string-id-title',
        'data-string-id-alt',
      ],
    });
  }
  #skip(element: Element | null, attribute = false): boolean {
    return (
      !element ||
      (!attribute && Boolean(element.closest('textarea'))) ||
      Boolean(
        element.closest('script,style,[contenteditable], [translate="no"], [data-i18n-dynamic]'),
      ) ||
      (!attribute && Boolean(element.closest('pre,code'))) ||
      (!attribute && element.matches('[data-string-id], [data-string-target]'))
    );
  }
  #translate(source: string): string {
    return this.formatText(translateUiText(source));
  }
  apply(root: Node): void {
    if (!root) {
      return;
    }
    // Panels and dialogs can mount after the initial language change.
    const bindingRoot = root.nodeType === Node.TEXT_NODE ? root.parentElement : root;
    const bound =
      bindingRoot instanceof Element || bindingRoot instanceof Document
        ? [
            ...(bindingRoot instanceof Element ? [bindingRoot] : []),
            ...bindingRoot.querySelectorAll(
              '[data-string-id],[data-string-id-placeholder],[data-string-id-title],[data-string-id-alt]',
            ),
          ]
        : [];
    for (const element of bound) {
      if (
        element.closest(
          'script,style,pre,code,[contenteditable],[translate="no"],[data-i18n-dynamic]',
        )
      ) {
        continue;
      }
      for (const attribute of [
        'data-string-id',
        'data-string-id-placeholder',
        'data-string-id-title',
        'data-string-id-alt',
      ]) {
        const key = element.getAttribute(attribute);
        const value = key ? this.#target.get(key) : undefined;
        if (value === undefined) {
          continue;
        }
        const translated = plainLocaleText(value);
        if (attribute === 'data-string-id-title' || attribute === 'data-string-id-alt') {
          const targetAttribute = attribute.endsWith('-title') ? 'title' : 'alt';
          if (element.getAttribute(targetAttribute) !== translated) {
            element.setAttribute(targetAttribute, translated);
          }
        } else if (
          attribute.endsWith('-placeholder') ||
          (element instanceof HTMLInputElement && element.hasAttribute('placeholder'))
        ) {
          if (element.getAttribute('placeholder') !== translated) {
            element.setAttribute('placeholder', translated);
          }
        } else {
          const target = element.querySelector(':scope > [data-string-target]');
          if (target) {
            if (target.textContent !== translated) {
              target.textContent = translated;
            }
          } else if (!element.children.length) {
            if (element.textContent !== translated) {
              element.textContent = translated;
            }
          } else {
            const nodes = [...element.childNodes].filter(
              (node) => node.nodeType === Node.TEXT_NODE,
            );
            if (!nodes.length) {
              element.prepend(document.createTextNode(translated + ' '));
            } else if (nodes[0].textContent !== translated + ' ') {
              nodes[0].textContent = translated + ' ';
            }
            for (const node of nodes.slice(1)) {
              if (node.textContent) {
                node.textContent = '';
              }
            }
          }
        }
      }
    }
    const text = (node: Node) => {
      if (this.#skip(node.parentElement)) {
        return;
      }
      const current = node.textContent ?? '',
        previous = this.#texts.get(node);
      const source =
        node.parentElement?.dataset.uiSource ??
        (previous?.rendered === current ? previous.source : current);
      const rendered = this.#translate(source);
      this.#texts.set(node, { source, rendered });
      if (current !== rendered) {
        node.textContent = rendered;
      }
    };
    if (root.nodeType === Node.TEXT_NODE) {
      text(root);
    } else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        text(walker.currentNode);
      }
    }
    const elements =
      root instanceof Element ? [root, ...root.querySelectorAll(attributeSelector)] : [];
    for (const element of elements) {
      if (this.#skip(element, true)) {
        continue;
      }
      const saved =
        this.#attributes.get(element) ?? new Map<string, { source: string; rendered: string }>();
      this.#attributes.set(element, saved);
      for (const attr of translatedAttributes) {
        const boundKey = element.getAttribute(`data-string-id-${attr}`);
        if (boundKey && this.#target.has(boundKey)) {
          continue;
        }
        // Never translate editable values, filenames or identifiers.
        if (
          attr === 'value' &&
          !element.matches('input[type="button"],input[type="submit"],input[type="reset"]')
        ) {
          continue;
        }
        if (attr === 'label' && !element.matches('optgroup,option')) {
          continue;
        }
        const current = element.getAttribute(attr);
        if (current === null) {
          continue;
        }
        const previous = saved.get(attr);
        const source = previous?.rendered === current ? previous.source : current,
          rendered = this.#translate(source);
        saved.set(attr, { source, rendered });
        if (current !== rendered) {
          element.setAttribute(attr, rendered);
        }
      }
    }
  }
}
