const paths = {
  computer: '<rect x="3" y="3" width="18" height="13" rx="1"/><path d="M12 16v5M7 21h10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  micOff:
    '<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v4M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8"/>',
  headphones: /* HTML */ `<path d="M3 14v-2a9 9 0 0 1 18 0v2" /><rect
      x="3"
      y="12"
      width="4"
      height="9"
      rx="2"
    /><rect
      x="17"
      y="12"
      width="4"
      height="9"
      rx="2"
    />`,
  deafened: /* HTML */ `<path d="m3 3 18 18M3 14v-2a9 9 0 0 1 1-4M8 4a9 9 0 0 1 13 8v2" /><rect
      x="3"
      y="12"
      width="4"
      height="9"
      rx="2"
    /><path d="M17 15v4a2 2 0 0 0 4 0v-1" />`,
  invite: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M20 7v6M17 10h6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  leave: '<path d="M9 21H3V3h6M9 12h13m-5-5 5 5-5 5"/>',
  room: '<path d="m3 10 9-7 9 7v11H3ZM9 21v-8h6v8"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  settings: /* HTML */ `<path d="M4 6h16M4 12h16M4 18h16" /><circle
      cx="9"
      cy="6"
      r="2"
    /><circle
      cx="16"
      cy="12"
      r="2"
    /><circle
      cx="7"
      cy="18"
      r="2"
    />`,
  refresh: '<path d="M21 4v6h-6M3 20v-6h6M5 7a8 8 0 0 1 13-2l3 5M3 14l3 5a8 8 0 0 0 13-2"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  play: '<path d="m7 3 14 9-14 9Z"/>',
};
export type WorldsIcon = keyof typeof paths;
export const worldsIcon = (name: WorldsIcon): string =>
  /* HTML */ `<svg
    class="worlds-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths[name]}
  </svg>`;
export function decorateWorldsButtons(root: HTMLElement): void {
  const decorate = () => {
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
      if (
        button.matches(
          '[data-toggle],[data-mini-mute],[data-mini-deafen],[data-lan-accept],[data-lan-ignore],[data-close],.hud-editor-move,.hud-editor-resize',
        ) ||
        button.querySelector('.worlds-icon')
      ) {
        continue;
      }
      const text = (button.getAttribute('aria-label') || button.textContent || '').toLowerCase();
      const name: WorldsIcon = /invita|grupo/.test(text)
        ? 'invite'
        : /copi/.test(text)
          ? 'copy'
          : /salir|descartar/.test(text)
            ? 'leave'
            : /actualizar|restablecer/.test(text)
              ? 'refresh'
              : /silenciar micro/.test(text)
                ? 'micOff'
                : /micro|voz/.test(text)
                  ? 'mic'
                  : /silenciar audio/.test(text)
                    ? 'deafened'
                    : /escuchar/.test(text)
                      ? 'headphones'
                      : /pública|publicar|privada/.test(text)
                        ? 'globe'
                        : /aspecto/.test(text)
                          ? 'settings'
                          : /sala|compartir/.test(text)
                            ? 'room'
                            : /unir/.test(text)
                              ? 'play'
                              : 'check';
      button.insertAdjacentHTML('afterbegin', worldsIcon(name));
    }
  };
  const observer = new MutationObserver(decorate);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  decorate();
  window.addEventListener('beforeunload', () => observer.disconnect());
}
