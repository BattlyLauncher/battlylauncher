import { privateStorage } from '../private-storage';
import { mountGuidedTutorial, type GuidedTutorialStep } from '../tutorial/guided-tutorial';
import { tutorialSession } from '../tutorial/tutorial-session';

const storageKey = 'battly.home-tutorial.september-2026';
interface TutorialStep {
  readonly selector: string | null;
  readonly text: string;
  readonly title: string;
}

const steps: readonly TutorialStep[] = [
  {
    selector: null,
    title: 'Novedades de Battly',
    text: 'Un repaso rápido a las nuevas funciones de instancias, música y juego con amigos. Puedes saltarlo cuando quieras.',
  },
  {
    selector: '[data-instances-open]',
    title: 'Tus instancias, organizadas',
    text: 'Gestiona mods, resourcepacks, shaders y mundos. Exporta una instancia como .bypack para compartirla e impórtala con su configuración.',
  },
  {
    selector: '[data-servers-options]',
    title: 'Juega con amigos',
    text: 'Servidores reúne Battly Worlds para compartir tu mundo y hablar por voz, y Battly Servers para gestionar tus servidores.',
  },
  {
    selector: '#music-btn',
    title: 'Más control de tu música',
    text: 'Selecciona canciones con las casillas y pulsa el botón derecho para crear una playlist, guardar favoritos o añadirlas a la cola. El audio descargado se conserva entre reinicios.',
  },
  {
    selector: '.home-news',
    title: 'Últimas novedades',
    text: 'Battly reúne aquí sus anuncios y las notas oficiales de Minecraft.',
  },
  {
    selector: '#typeofnewsMain',
    title: 'Noticias a tu gusto',
    text: 'Cambia entre las novedades de Battly y las noticias de Minecraft.',
  },
  {
    selector: '.main-home-panel-left-online-friends',
    title: 'Amigos conectados',
    text: 'Consulta quién está online y entra al panel social para conversar o jugar.',
  },
  {
    selector: '.main-home-panel-right',
    title: 'Estado de Battly',
    text: 'Aquí verás avisos, el estado de los servicios y cuántos usuarios están conectados.',
  },
  {
    selector: '[data-downloads-open]',
    title: 'Descargar versiones',
    text: 'Elige la versión de Minecraft y el loader que quieres utilizar.',
  },
  {
    selector: '[data-play-open]',
    title: 'Abrir versiones',
    text: 'Elige entre tus perfiles instalados, tus versiones recientes o inicia en modo seguro.',
  },
  {
    selector: '[data-account-trigger]',
    title: 'Tu cuenta',
    text: 'Cambia de cuenta, gestiona tus perfiles y personaliza tu skin desde este menú.',
  },
];

export function mountHomeTutorial(navigateHome: () => void): void {
  const root = document.querySelector<HTMLElement>('[data-panel-view="home"]');
  if (!root) {
    return;
  }
  const prompt = document.querySelector<HTMLElement>('[data-home-tutorial-prompt]');
  const session = tutorialSession();
  const click = (selector: string): void => {
    document.querySelector<HTMLElement>(selector)?.click();
  };
  const restore = (): void => {
    session.finish();
    navigateHome();
    const menu = document.querySelector<HTMLElement>('[data-account-dropdown]');
    if (menu) {
      menu.hidden = true;
      menu.classList.remove('show');
      menu.style.display = 'none';
    }
    const servers = document.querySelector<HTMLElement>('[data-servers-options]');
    if (servers?.getAttribute('aria-expanded') === 'true') {
      servers.click();
    }
  };
  const routes: Record<number, Partial<GuidedTutorialStep>> = {
    1: {
      selector: '[data-instances-dialog] .modal-card',
      onEnter: () => {
        navigateHome();
        click('[data-instances-open]');
      },
      onLeave: restore,
    },
    2: {
      selector: '[data-servers-options-menu]',
      onEnter: () => {
        navigateHome();
        const button = document.querySelector('[data-servers-options]');
        if (button?.getAttribute('aria-expanded') !== 'true') {
          click('[data-servers-options]');
        }
      },
      onLeave: restore,
    },
    3: {
      selector: '[data-panel-view="music"]',
      onEnter: () => {
        navigateHome();
        click('#music-btn');
      },
      onLeave: restore,
    },
    6: {
      selector: '[data-panel-view="social"]',
      onEnter: () => {
        navigateHome();
        click('#friends-btn');
      },
      onLeave: restore,
    },
    8: {
      selector: '[data-download-dialog] .download-modal-panel',
      onEnter: () => {
        navigateHome();
        click('[data-downloads-open]');
      },
      onLeave: restore,
    },
    9: {
      selector: '[data-play-dialog] .modal-card',
      onEnter: () => {
        navigateHome();
        click('[data-play-open]');
      },
      onLeave: restore,
    },
    10: {
      selector: '[data-account-dropdown]',
      onEnter: () => {
        navigateHome();
        click('[data-account-trigger]');
      },
      onLeave: restore,
    },
  };
  const tutorial = mountGuidedTutorial({
    id: 'home',
    label: 'Tutorial de inicio',
    root,
    storageKey,
    replayHost: '.main-home-panel-left-title',
    promptTitle: 'Novedades de Battly',
    promptText: steps[0].text,
    onStart: () => {
      navigateHome();
      session.start();
      if (prompt) {
        prompt.hidden = true;
      }
    },
    onFinish: () => {
      restore();
      if (prompt) {
        prompt.hidden = true;
      }
    },
    steps: steps.map((step, index) => ({
      title: step.title,
      text: step.text,
      selector: step.selector ?? undefined,
      scope: 'document',
      ...routes[index],
    })),
  });
  document.querySelectorAll<HTMLElement>('[data-home-tutorial-start]').forEach((control) => {
    control.addEventListener('click', (event) => {
      event.preventDefault();
      tutorial.start();
    });
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        tutorial.start();
      }
    });
  });
  document.querySelector('[data-home-tutorial-dismiss]')?.addEventListener('click', () => {
    if (prompt) {
      prompt.hidden = true;
    }
    try {
      privateStorage.setItem(storageKey, 'true');
    } catch {
      /* Keep the tour dismissible without local storage. */
    }
  });
  if (prompt) {
    try {
      const complete = privateStorage.getItem(storageKey);
      prompt.hidden = complete === 'true' || complete === 'complete';
    } catch {
      prompt.hidden = false;
    }
  }
}
