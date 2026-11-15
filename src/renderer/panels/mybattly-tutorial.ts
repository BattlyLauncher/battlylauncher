import { mountGuidedTutorial, type GuidedTutorial } from '../tutorial/guided-tutorial';
import { tutorialSession } from '../tutorial/tutorial-session';

export function mountMyBattlyTutorial(panel: HTMLElement): GuidedTutorial {
  const session = tutorialSession();
  let overlays: { element: HTMLElement; hidden: HTMLElement['hidden'] }[] = [];
  let blurred: HTMLElement[] = [];
  const reveal = (target: string) => async (): Promise<void> => {
    const overlay = panel.querySelector<HTMLElement>(
      '.b-mybattly-panel-overlay[data-target="' + target + '"]',
    );
    if (overlay && !overlay.hidden) {
      overlay.querySelector<HTMLButtonElement>('button')?.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 550));
    }
  };
  return mountGuidedTutorial({
    id: 'mybattly',
    label: 'Tutorial de Mi Battly',
    promptTitle: '¿Primera vez en Mi Battly?',
    promptText: 'Descubre todo lo que puedes gestionar.',
    root: panel,
    replayHost: '.b-mybattly-hero-actions',
    storageKey: 'mybattlyTutorialCompleted',
    onStart: () => {
      session.start();
      overlays = [...panel.querySelectorAll<HTMLElement>('.b-mybattly-panel-overlay')].map(
        (element) => ({ element, hidden: element.hidden }),
      );
      blurred = [...panel.querySelectorAll<HTMLElement>('.b-mybattly-blur-panel')];
    },
    onFinish: () => {
      session.finish();
      overlays.forEach(({ element, hidden }) => {
        element.hidden = hidden;
      });
      blurred.forEach((element) => element.classList.add('b-mybattly-blur-panel'));
    },
    steps: [
      {
        title: 'Bienvenido a Mi Battly',
        text: 'Este espacio reúne tu contenido local, tus copias y tu actividad de Battly.',
      },
      {
        selector: '.b-mybattly-main-panel-welcome',
        title: 'Tu perfil',
        text: 'Aquí puedes reconocer la cuenta activa y consultar un resumen de tus mods, mundos y packs.',
      },
      {
        selector: '#panel-mods',
        title: 'Tus mods',
        text: 'Activa, desactiva o archiva tus mods desde esta biblioteca.',
        onEnter: reveal('panel-mods'),
      },
      {
        selector: '#panel-worlds',
        title: 'Tus mundos',
        text: 'Consulta tus mundos y sus opciones de gestión antes de abrirlos o crear una copia.',
        onEnter: reveal('panel-worlds'),
      },
      {
        selector: '#panel-resourcepacks',
        title: 'Tus paquetes de recursos',
        text: 'Organiza los packs instalados y revisa cuáles tienes activados.',
        onEnter: reveal('panel-resourcepacks'),
      },
      {
        selector: '.b-mybattly-main-panel-stats',
        title: 'Estadísticas de usuario',
        text: 'Battly muestra aquí tu tiempo de juego real, copias registradas y mods activos.',
      },
      {
        selector: '[data-world-backups-dialog] .world-backups-card',
        scope: 'document',
        title: 'El historial de tus copias',
        text: 'Revisa tus copias, filtra el historial y consulta las opciones de recuperación. El tutorial no creará ni restaurará archivos.',
        onEnter: () => {
          panel.querySelector<HTMLButtonElement>('#view-backup-history-btn')?.click();
        },
        onLeave: () =>
          document.querySelector<HTMLDialogElement>('[data-world-backups-dialog]')?.close(),
      },
      {
        selector: '.b-mybattly-messages',
        title: 'Todo listo',
        text: 'También encontrarás tus notificaciones sociales y los últimos mundos que has modificado.',
      },
    ],
  });
}
