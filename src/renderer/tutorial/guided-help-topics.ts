export interface GuidedHelpTopic {
  readonly id: string;
  readonly question: string;
  readonly selectors: readonly string[];
}

/** Each answer reuses the steps that open and explain the actual controls. */
export const guidedHelpTopics: Readonly<Record<string, readonly GuidedHelpTopic[]>> = {
  servers: [
    { id: 'create', question: '¿Cómo creo un servidor?', selectors: ['@create'] },
    {
      id: 'start',
      question: '¿Cómo lo inicio y veo la consola?',
      selectors: ['@runtime', '@console'],
    },
    { id: 'share', question: '¿Cómo lo comparto con mis amigos?', selectors: ['@sharing'] },
    {
      id: 'manage',
      question: '¿Dónde gestiono archivos, mods y ajustes?',
      selectors: ['@files', '@content', '@options', '@players', '@logs'],
    },
  ],
  mods: [
    {
      id: 'install',
      question: '¿Cómo instalo un mod?',
      selectors: [
        '[data-mod-query]',
        '[data-mod-loader]',
        '.mod-version-popover',
        '[data-mod-grid]',
        '[data-mod-detail-panel="description"]',
        '[data-mod-download-destination-section]',
        '[data-mod-download-loaders]',
      ],
    },
    {
      id: 'project',
      question: '¿Dónde veo las capturas, versiones y dependencias?',
      selectors: [
        '[data-mod-detail-panel="description"]',
        '[data-mod-detail-panel="gallery"]',
        '[data-mod-detail-panel="releases"]',
        '[data-mod-detail-panel="details"]',
      ],
    },
    {
      id: 'compatibility',
      question: '¿Cómo reviso si mis mods son compatibles?',
      selectors: ['.local-mods-toolbar', '[data-mod-compatibility-report]'],
    },
    {
      id: 'installed',
      question: '¿Cómo activo o desactivo mis mods?',
      selectors: ['.local-mods-toolbar', '@toggle-local'],
    },
    {
      id: 'basket',
      question: '¿Cómo preparo varios mods en la cesta?',
      selectors: ['@basket-add', '.mod-basket-modal .mod-basket-body'],
    },
  ],
  instances: [
    {
      id: 'create',
      question: '¿Cómo creo o importo una instancia?',
      selectors: [
        '[data-instance-create-open]',
        '[data-instance-form] input[name="name"]',
        '[data-instance-form] [data-instance-version]',
      ],
    },
    {
      id: 'content',
      question: '¿Dónde gestiono sus mods, resourcepacks y shaders?',
      selectors: ['@mods', '@resourcepacks', '@shaderpacks'],
    },
    { id: 'worlds', question: '¿Dónde están los mundos y sus copias?', selectors: ['@saves'] },
    {
      id: 'share',
      question: '¿Cómo comparto una instancia o creo un acceso directo?',
      selectors: ['[data-instance-export], [data-instance-shortcut]'],
    },
  ],
  settings: [
    {
      id: 'accounts',
      question: '¿Cómo cambio de cuenta o añado otra?',
      selectors: ['.b-settings-acc-list', '#b-settings-profile-menu'],
    },
    {
      id: 'appearance',
      question: '¿Cómo cambio el tema y los sonidos?',
      selectors: [
        '[data-settings-view="appearance"]',
        '[data-settings-group="Audio"]',
        '[data-settings-save]',
      ],
    },
    {
      id: 'java-memory',
      question: '¿Cómo elijo Java y cuánta RAM usar?',
      selectors: [
        '[data-settings-view="java"]',
        '[data-settings-view="ram"]',
        '[data-settings-save]',
      ],
    },
    {
      id: 'privacy',
      question: '¿Qué información comparte Battly?',
      selectors: ['[data-settings-group="Privacidad"]', '[data-settings-save]'],
    },
    {
      id: 'updates',
      question: '¿Cómo cambio entre el canal estable y beta?',
      selectors: ['[data-settings-group="Actualizaciones"]'],
    },
    {
      id: 'logs',
      question: '¿Dónde consulto los registros de un error?',
      selectors: ['[data-settings-group="Registros"]'],
    },
  ],
  friends: [
    {
      id: 'add',
      question: '¿Cómo añado a un amigo?',
      selectors: ['[data-social-search-form] input'],
    },
    {
      id: 'requests',
      question: '¿Dónde acepto las solicitudes de amistad?',
      selectors: ['[data-social-requests-dialog] .social-modal-card'],
    },
    {
      id: 'profile',
      question: '¿Cómo veo el perfil de un amigo?',
      selectors: ['[data-social-filter]', '[data-social-profile-dialog] .modal-card'],
    },
    {
      id: 'filter',
      question: '¿Cómo encuentro a mis amigos conectados?',
      selectors: ['[data-social-filter]', '.filter-buttons'],
    },
  ],
  mybattly: [
    { id: 'mods', question: '¿Dónde gestiono mis mods instalados?', selectors: ['#panel-mods'] },
    {
      id: 'worlds',
      question: '¿Dónde encuentro mis mundos y resourcepacks?',
      selectors: ['#panel-worlds', '#panel-resourcepacks'],
    },
    {
      id: 'backups',
      question: '¿Cómo consulto mis copias de seguridad?',
      selectors: ['[data-world-backups-dialog] .world-backups-card'],
    },
    {
      id: 'activity',
      question: '¿Dónde veo mi tiempo de juego y mi actividad?',
      selectors: ['.b-mybattly-main-panel-stats', '.b-mybattly-messages'],
    },
  ],
  home: [
    {
      id: 'instances',
      question: '¿Dónde organizo mis instancias?',
      selectors: ['[data-instances-dialog] .modal-card'],
    },
    {
      id: 'friends',
      question: '¿Cómo juego con mis amigos?',
      selectors: ['[data-servers-options-menu]', '[data-panel-view="social"]'],
    },
    {
      id: 'music',
      question: '¿Dónde escucho y organizo mi música?',
      selectors: ['[data-panel-view="music"]'],
    },
    {
      id: 'play',
      question: '¿Cómo descargo una versión y empiezo a jugar?',
      selectors: ['[data-download-dialog] .download-modal-panel', '[data-play-dialog] .modal-card'],
    },
    { id: 'account', question: '¿Dónde cambio de cuenta?', selectors: ['[data-account-dropdown]'] },
  ],
};
