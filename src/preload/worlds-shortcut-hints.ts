import { formatWorldsShortcut, type WorldsShortcuts } from '../shared/social/worlds-shortcuts';

// The renderer can come from the separately versioned Battly Overlay release.
// Replace the defaults in its existing labels without changing the translated copy.
export function bindWorldsShortcutHints(initial: WorldsShortcuts) {
  const mac = /Macintosh|Mac OS X/.test(navigator.userAgent);
  const originals = new WeakMap<Node, { source: string; shown: string }>();
  const defaults = /(?:Ctrl|Strg|⌘)\s*\+?\s*([BH])\b/gi;
  const hints = '.hud-shortcut, [data-room-summary] small, .hud-visibility-hint, footer span';
  let shortcuts = initial;

  function update(): void {
    const substitute = (text: string) =>
      text.replace(defaults, (_match, key: string) =>
        formatWorldsShortcut(
          key.toUpperCase() === 'B' ? shortcuts.menu : shortcuts.visibility,
          mac,
        ),
      );
    function render(node: Node, current: string, format: (source: string) => string) {
      const previous = originals.get(node);
      const source = previous?.shown === current ? previous.source : current;
      const shown = format(source);
      originals.set(node, { source, shown });
      return shown;
    }
    for (const target of document.querySelectorAll(hints)) {
      const tree = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = tree.nextNode(); node; node = tree.nextNode()) {
        const current = node.nodeValue ?? '';
        const value = render(node, current, substitute);
        if (value !== current) {
          node.nodeValue = value;
        }
      }
    }
    const toggle = document.querySelector('[data-toggle]');
    const title = toggle?.getAttribute('title');
    if (toggle && title) {
      const shown = render(toggle, title, substitute);
      if (shown !== title) {
        toggle.setAttribute('title', shown);
      }
    }
    for (const [selector, shortcut] of [
      ['[data-lan-accept] kbd', shortcuts.acceptLan],
      ['[data-lan-ignore] kbd', shortcuts.dismissLan],
    ]) {
      const hint = document.querySelector(selector);
      const label = formatWorldsShortcut(shortcut, mac);
      if (hint && hint.textContent !== label) {
        hint.textContent = label;
      }
    }
  }

  window.addEventListener(
    'DOMContentLoaded',
    () => {
      const observer = new MutationObserver(update);
      for (const element of document.querySelectorAll(hints)) {
        observer.observe(element, { subtree: true, characterData: true, childList: true });
      }
      const toggle = document.querySelector('[data-toggle]');
      if (toggle) {
        observer.observe(toggle, { attributes: true, attributeFilter: ['title'] });
      }
      update();
    },
    { once: true },
  );

  return (value: WorldsShortcuts): void => {
    shortcuts = value;
    update();
  };
}
