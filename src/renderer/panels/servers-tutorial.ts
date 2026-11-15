import { mountGuidedTutorial, type GuidedTutorialStep } from '../tutorial/guided-tutorial';
import { tutorialSession } from '../tutorial/tutorial-session';
import { translateUiText } from '../i18n/dialog-text';

export function mountServersTutorial(root: HTMLElement, hasServer: () => boolean) {
  const session = tutorialSession();
  let previousTab = 'general';
  let sharingWasOpen = false;
  let ready = false;
  const openTab = (tab: string) => (): void => {
    if (!hasServer()) {
      throw new Error('SERVER_REQUIRED');
    }
    root.querySelector<HTMLElement>(`[data-server-tab="${tab}"]`)?.click();
  };
  const unavailableText =
    'Crea primero tu servidor. Después podrás volver aquí para aprender a gestionarlo.';
  const creation: GuidedTutorialStep[] = [
    {
      id: 'create',
      get selector() {
        return hasServer() ? '[data-server-title]' : '#domainInput';
      },
      title: 'Dominio del servidor',
      get text() {
        return hasServer()
          ? 'Ya tienes un servidor. Puedes gestionarlo desde este panel.'
          : 'Elige el nombre de tu dirección. Tus amigos usarán esta IP para entrar cuando compartas el servidor.';
      },
    },
    {
      selector: '#versionSelectServers',
      title: 'Versión de Minecraft',
      text: 'Elige la versión de Minecraft que vais a usar tú y tus amigos.',
    },
    {
      selector: '[name="software"]',
      title: 'Software del servidor',
      text: 'Vanilla es para jugar sin mods. Elige Fabric o Forge para mods, y Paper o Spigot para plugins.',
    },
    {
      selector: '#regionSelectServers',
      title: 'Región del servidor',
      text: 'La latencia indica cuánto tarda la conexión. Un valor más bajo suele dar una respuesta más rápida.',
    },
    {
      selector: '[name="eulaAccepted"]',
      title: 'EULA de Minecraft',
      text: 'Lee el EULA de Minecraft y marca la casilla si lo aceptas.',
    },
    {
      selector: '#create-server',
      title: 'Crear servidor',
      text: 'Cuando pulses Crear servidor, verás el registro y la instalación paso a paso.',
    },
  ];
  const dashboard: GuidedTutorialStep[] = [
    {
      id: 'runtime',
      selector: '[data-server-runtime="toggle"]',
      onEnter: openTab('general'),
      title: 'Iniciar servidor',
      text: 'Inicia o detén tu servidor desde aquí. Espera a que termine de arrancar antes de conectarte.',
      unavailableText,
    },
    {
      id: 'console',
      selector: '[data-server-console]',
      onEnter: openTab('general'),
      title: 'Consola',
      text: 'Aquí ves lo que ocurre en el servidor. Puedes consultar errores y enviar comandos desde la consola.',
      unavailableText,
    },
    {
      id: 'sharing',
      selector: '[data-server-share-dialog] .modal-card',
      scope: 'document',
      title: 'Compartir servidor',
      text: 'Activa la conexión para tus amigos y comparte la dirección. Desde aquí también puedes gestionar quién tiene acceso.',
      unavailableText,
      onEnter: () => {
        if (!hasServer()) {
          throw new Error('SERVER_REQUIRED');
        }
        root.querySelector<HTMLElement>('[data-server-share]')?.click();
      },
      onLeave: () => {
        if (!sharingWasOpen) {
          root
            .querySelector<HTMLElement>('[data-server-share-dialog]')
            ?.classList.remove('is-active');
        }
      },
    },
    {
      id: 'players',
      selector: '[data-server-view="players"]',
      onEnter: openTab('players'),
      title: 'Jugadores',
      text: 'Consulta los jugadores conectados y gestiona las listas de acceso de tu servidor.',
      unavailableText,
    },
    {
      id: 'content',
      selector: '[data-server-view="modloaders"]',
      onEnter: openTab('modloaders'),
      title: 'Mods y plugins',
      text: 'Instala contenido compatible con la versión y el software de tu servidor.',
      unavailableText,
    },
    {
      id: 'files',
      selector: '[data-server-view="files"]',
      onEnter: openTab('files'),
      title: 'Archivos',
      text: 'Explora los archivos del servidor. Puedes editar configuraciones, exportar archivos y archivar lo que ya no uses.',
      unavailableText,
    },
    {
      id: 'options',
      selector: '[data-server-view="options"]',
      onEnter: openTab('options'),
      title: 'Opciones',
      text: 'Revisa la RAM, los jugadores permitidos y las opciones del mundo antes de guardar los cambios.',
      unavailableText,
    },
    {
      id: 'logs',
      selector: '[data-server-view="logs"]',
      onEnter: openTab('logs'),
      title: 'Registros',
      text: 'Abre los registros para investigar errores o compartirlos cuando necesites ayuda.',
      unavailableText,
    },
  ];
  const tutorial = mountGuidedTutorial({
    id: 'servers',
    label: 'Battly Servers',
    promptTitle: 'Battly Servers',
    promptText: 'Te enseño a crear y gestionar tu servidor.',
    storageKey: 'serversTutorialCompleted',
    root,
    replay: false,
    get steps() {
      return hasServer() ? dashboard : creation;
    },
    helpSteps: [...creation, ...dashboard],
    onStart: () => {
      session.start();
      sharingWasOpen =
        root.querySelector('[data-server-share-dialog]')?.classList.contains('is-active') ?? false;
      previousTab =
        root.querySelector<HTMLElement>('[data-server-tab].is-active')?.dataset.serverTab ??
        'general';
    },
    onFinish: () => {
      session.finish();
      if (hasServer()) {
        root.querySelector<HTMLElement>(`[data-server-tab="${previousTab}"]`)?.click();
      }
    },
  });
  const help = document.createElement('button');
  help.type = 'button';
  help.className = 'button is-small is-info is-outlined tutorial-replay server-tutorial-help';
  help.textContent = '?';
  help.dataset.guidedHelpOpen = 'servers';
  help.title = translateUiText('Ayuda de Nivix');
  help.setAttribute('aria-label', help.title);
  help.addEventListener('click', tutorial.help);
  const visible = (): void => {
    if (
      ready &&
      document.body.dataset.panel === 'servers' &&
      root.getBoundingClientRect().width > 0 &&
      (hasServer() || window.innerHeight >= 780)
    ) {
      tutorial.offer();
    } else {
      const prompt = document.querySelector<HTMLElement>('[data-guided-tutorial-prompt="servers"]');
      if (prompt) {
        prompt.hidden = true;
      }
    }
  };
  const observer = new MutationObserver(visible);
  window.addEventListener('resize', visible);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-panel'] });
  window.addEventListener(
    'beforeunload',
    () => {
      observer.disconnect();
      window.removeEventListener('resize', visible);
    },
    { once: true },
  );
  return {
    refresh(): void {
      ready = true;
      (
        root.querySelector(hasServer() ? '.server-header-actions' : '[data-server-create-form]') ??
        root
      ).append(help);
      visible();
    },
  };
}
