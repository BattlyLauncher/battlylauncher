/** Move existing controls without replacing them, preserving their bindings and saved values. */
export function mountSettingsSubsections(root: HTMLElement): void {
  const launcher = root.querySelector<HTMLElement>('#b-settings-panel-launcher');
  if (!launcher) {
    return;
  }
  if (launcher.querySelector('.settings-subnav')) {
    return;
  }
  const groups = [
    { label: 'General', icon: 'fa-sliders', selector: '' },
    { label: 'Pantalla', icon: 'fa-desktop', selector: '.minecraft-window-settings' },
    { label: 'Battly Worlds', icon: 'fa-earth-americas', selector: '[data-worlds-settings]' },
    { label: 'Audio', icon: 'fa-volume-high', selector: '[name="sound"], [name="music"]' },
    {
      label: 'Descargas y archivos',
      icon: 'fa-download',
      selector: '#download-multiple-preset, #battly-path-display',
    },
    { label: 'Mundos', icon: 'fa-earth-americas', selector: '#auto-sync-enabled' },
    { label: 'Privacidad', icon: 'fa-shield-halved', selector: '#privacy-presence-status-enabled' },
    { label: 'Registros', icon: 'fa-file-lines', selector: '[data-settings-log-content]' },
    { label: 'Actualizaciones', icon: 'fa-arrows-rotate', selector: '[data-updates]' },
  ];
  const children = [...launcher.children].filter(
    (node) => !node.matches('[data-string-id="settings.configureBattlySettings"]'),
  );
  launcher.querySelector('[data-string-id="settings.configureBattlySettings"]')?.remove();
  const content = document.createElement('div');
  content.className = 'settings-subsection-content';
  const nav = document.createElement('nav');
  nav.className = 'settings-subnav';
  nav.setAttribute('aria-label', 'Apartados del launcher');
  const sections = groups.map((group, index) => {
    const section = document.createElement('section');
    section.className = 'settings-subsection';
    section.id = `launcher-subsection-${index}`;
    section.dataset.settingsGroup = group.label;
    section.setAttribute('aria-label', group.label);
    section.hidden = index !== 0;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-controls', section.id);
    button.setAttribute('aria-pressed', String(index === 0));
    if (group.selector === '[data-updates]') {
      button.dataset.updateTab = '';
    }
    button.innerHTML = `<i class="fa-solid ${group.icon}" aria-hidden="true"></i><span>${group.label}</span>`;
    button.addEventListener('click', () => {
      content.scrollTop = 0;
      sections.forEach((panel, current) => {
        panel.hidden = current !== index;
      });
      [...nav.children].forEach((item, current) =>
        item.setAttribute('aria-pressed', String(current === index)),
      );
      section.dispatchEvent(new Event('battly:settings-subsection-enter'));
    });
    nav.append(button);
    return section;
  });
  for (const child of children) {
    const group = groups.findIndex(
      (group, index) =>
        index > 0 && (child.matches(group.selector) || child.querySelector(group.selector)),
    );
    sections[Math.max(0, group)].append(child);
  }
  content.append(...sections);
  launcher.append(nav, content);
}
