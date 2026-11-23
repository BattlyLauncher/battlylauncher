import { privateStorage } from '../private-storage';
import { translateUiText } from '../i18n/dialog-text';
import { positionTutorialCard, type TutorialRectangle } from '../home/home-tutorial-layout';
import nivixUrl from '../assets/nivix.png';
import { mountGuidedHelp } from './guided-help';
import { guidedHelpTopics, type GuidedHelpTopic } from './guided-help-topics';

export interface GuidedTutorialStep {
  readonly id?: string;
  readonly selector?: string;
  readonly onEnter?: () => void | Promise<void>;
  readonly scope?: 'root' | 'document';
  readonly unavailableText?: string;
  readonly onLeave?: () => void | Promise<void>;
  readonly text: string;
  readonly title: string;
}

export interface GuidedTutorialOptions {
  readonly id: string;
  readonly label: string;
  readonly promptText: string;
  readonly promptTitle: string;
  readonly root: HTMLElement;
  readonly steps: readonly GuidedTutorialStep[];
  readonly storageKey: string;
  readonly helpSteps?: readonly GuidedTutorialStep[];
  readonly onStart?: () => void | Promise<void>;
  readonly onFinish?: () => void | Promise<void>;
  readonly replay?: boolean;
  readonly replayHost?: string;
}

export interface GuidedTutorial {
  readonly start: () => void;
  readonly offer: () => void;
  readonly help: () => void;
}

function completed(storageKey: string): boolean {
  try {
    return privateStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

function persistCompletion(storageKey: string): void {
  try {
    privateStorage.setItem(storageKey, 'true');
  } catch {
    // The tutorial remains dismissible when local persistence is unavailable.
  }
}

let activeGuidedTutorial: (() => Promise<void>) | null = null;

function visibleTarget(
  target: HTMLElement,
  viewport: { width: number; height: number },
): TutorialRectangle | null {
  const rect = target.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(viewport.width, rect.right);
  let bottom = Math.min(viewport.height, rect.bottom);
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) {break;}
    const style = getComputedStyle(parent);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') {continue;}
    const bounds = parent.getBoundingClientRect();
    const scaleX = parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const scaleY = parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    if (style.overflowX !== 'visible') {
      const clipLeft = bounds.left + parent.clientLeft * scaleX;
      left = Math.max(left, clipLeft);
      right = Math.min(right, clipLeft + parent.clientWidth * scaleX);
    }
    if (style.overflowY !== 'visible') {
      const clipTop = bounds.top + parent.clientTop * scaleY;
      top = Math.max(top, clipTop);
      bottom = Math.min(bottom, clipTop + parent.clientHeight * scaleY);
    }
    if (parent.matches('dialog:modal')) {break;}
  }
  return right - left >= 1 && bottom - top >= 1
    ? { left, top, right, bottom, width: right - left, height: bottom - top }
    : null;
}

export function mountGuidedTutorial(options: GuidedTutorialOptions): GuidedTutorial {
  const prompt = document.createElement('aside');
  prompt.className = 'guided-tutorial-prompt';
  prompt.dataset.guidedTutorialPrompt = options.id;
  prompt.hidden = true;
  prompt.innerHTML = /* HTML */ `<i
      class="fa-solid fa-compass"
      aria-hidden="true"
    ></i
    ><span><strong></strong><span></span></span
    ><button
      type="button"
      data-guided-tutorial-start
    >
      Empezar tour</button
    ><button
      type="button"
      data-guided-tutorial-dismiss
      aria-label="No mostrar el tour"
    >
      ×
    </button>`;
  const promptNivix = document.createElement('img');
  promptNivix.src = nivixUrl;
  promptNivix.alt = 'Nivix';
  promptNivix.className = 'tutorial-nivix';
  prompt.querySelector('i')?.replaceWith(promptNivix);
  const promptStrong = prompt.querySelector('strong');
  const promptDescription = prompt.querySelector('span span');
  if (promptStrong) {
    promptStrong.textContent = options.promptTitle;
  }
  if (promptDescription) {
    promptDescription.textContent = options.promptText;
  }

  const tutorial = document.createElement('section');
  tutorial.className = 'home-tutorial';
  tutorial.dataset.guidedTutorial = options.id;
  tutorial.hidden = true;
  tutorial.setAttribute('popover', 'manual');
  tutorial.setAttribute('aria-label', options.label);
  tutorial.innerHTML = /* HTML */ `<div
      class="home-tutorial-backdrop"
      aria-hidden="true"
    ></div>
    <div
      class="home-tutorial-focus"
      data-guided-tutorial-focus
      hidden
    ></div>
    <article
      class="home-tutorial-card"
      role="dialog"
      aria-modal="true"
    >
      <div class="tutorial-guide">
        <i
          class="fa-solid fa-compass"
          aria-hidden="true"
        ></i
        ><span><strong>Nivix</strong> · Tu guía en Battly</span>
      </div>
      <span data-guided-tutorial-counter></span>
      <h2 data-guided-tutorial-title></h2>
      <p data-guided-tutorial-text></p>
      <footer>
        <button
          type="button"
          data-guided-tutorial-help
        >
          Otra pregunta</button
        ><button
          type="button"
          data-guided-tutorial-skip
        >
          Saltar tutorial</button
        ><button
          type="button"
          data-guided-tutorial-previous
        >
          Anterior</button
        ><button
          type="button"
          data-guided-tutorial-next
        >
          Siguiente
        </button>
      </footer>
    </article>`;
  const tutorialNivix = promptNivix.cloneNode() as HTMLImageElement;
  tutorial.querySelector('.tutorial-guide i')?.replaceWith(tutorialNivix);
  const dialog = tutorial.querySelector<HTMLElement>('[role="dialog"]');
  const title = tutorial.querySelector<HTMLElement>('[data-guided-tutorial-title]');
  const description = tutorial.querySelector<HTMLElement>('[data-guided-tutorial-text]');
  const counter = tutorial.querySelector<HTMLElement>('[data-guided-tutorial-counter]');
  const previous = tutorial.querySelector<HTMLButtonElement>('[data-guided-tutorial-previous]');
  const next = tutorial.querySelector<HTMLButtonElement>('[data-guided-tutorial-next]');
  const focus = tutorial.querySelector<HTMLElement>('[data-guided-tutorial-focus]');
  const titleId = `${options.id}-tutorial-title`;
  if (title) {
    title.id = titleId;
  }
  dialog?.setAttribute('aria-labelledby', titleId);
  // A panel can create its own stacking context through transforms/filters. Keeping
  // the tour inside it made the modal appear below the content it was explaining.
  document.body.append(prompt, tutorial);

  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'button is-small is-info is-outlined tutorial-replay';
  replay.textContent = '?';
  replay.title = translateUiText('Ayuda de Nivix');
  replay.setAttribute('aria-label', replay.title);
  const replayHost = options.root.querySelector(
    options.replayHost ?? '.modal-card-head, [data-settings-heading], h1, h2',
  );
  if (options.replay !== false) {
    const close = replayHost?.querySelector('[data-instances-close], #volver, .delete');
    if (close) {
      close.before(replay);
    } else if (replayHost?.matches('h1, h2, [data-settings-heading]')) {
      replayHost.parentElement?.append(replay);
    } else {
      (replayHost ?? options.root).append(replay);
    }
  }

  let steps = options.steps;
  let index = 0;
  let active = false;
  let revision = 0;
  let busy = false;
  let pending: Promise<void> = Promise.resolve();
  let leaveStep: GuidedTutorialStep['onLeave'];
  let highlighted: HTMLElement | null = null;
  let previousFocus: HTMLElement | null = null;
  let highlightFrame = 0;
  let lastPosition = '';

  const clearHighlight = (): void => {
    cancelAnimationFrame(highlightFrame);
    lastPosition = '';
    highlighted?.classList.remove('home-tutorial-highlight');
    highlighted = null;
    if (focus) {
      focus.hidden = true;
    }
  };
  const showAboveDialog = (): void => {
    if (!active) {
      return;
    }
    const host =
      highlighted?.closest('dialog[open]') ??
      [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ??
      document.body;
    if (tutorial.parentElement !== host) {
      if (tutorial.matches(':popover-open')) {
        tutorial.hidePopover();
      }
      host.append(tutorial);
    }
    if (!tutorial.matches(':popover-open')) {
      tutorial.showPopover();
    }
  };
  const positionHighlight = (): void => {
    if (!dialog) {
      return;
    }
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = highlighted?.isConnected ? visibleTarget(highlighted, viewport) : null;
    if (!rect) {
      if (focus) {
        focus.hidden = true;
      }
      lastPosition = '';
      dialog.style.removeProperty('left');
      dialog.style.removeProperty('top');
      return;
    }
    const left = Math.max(2, rect.left - 6);
    const top = Math.max(2, rect.top - 6);
    const right = Math.min(viewport.width - 2, rect.right + 6);
    const bottom = Math.min(viewport.height - 2, rect.bottom + 6);
    const card = { width: dialog.offsetWidth, height: dialog.offsetHeight };
    const signature = [
      left, top, right, bottom, card.width, card.height, viewport.width, viewport.height,
    ].join('/');
    if (signature === lastPosition) {return;}
    lastPosition = signature;
    if (focus) {
      focus.hidden = false;
      Object.assign(focus.style, {
        left: left + 'px',
        top: top + 'px',
        width: Math.max(1, right - left) + 'px',
        height: Math.max(1, bottom - top) + 'px',
      });
    }
    const position = positionTutorialCard(
      { left, top, right, bottom, width: right - left, height: bottom - top },
      card,
      viewport,
    );
    Object.assign(dialog.style, {
      left: position.left + 'px',
      top: position.top + 'px',
    });
  };
  const followHighlight = (): void => {
    if (!active || !highlighted) {return;}
    positionHighlight();
    highlightFrame = requestAnimationFrame(followHighlight);
  };
  let finishing: Promise<void> | null = null;
  const finishOnce = async (): Promise<void> => {
    if (!active) {
      prompt.hidden = true;
      persistCompletion(options.storageKey);
      return;
    }
    active = false;
    revision++;
    clearHighlight();
    if (tutorial.matches(':popover-open')) {
      tutorial.hidePopover();
    }
    tutorial.hidden = true;
    prompt.hidden = true;
    document.body.append(tutorial);
    await pending.catch(() => undefined);
    const leave = leaveStep;
    leaveStep = undefined;
    await leave?.();
    await options.onFinish?.();
    persistCompletion(options.storageKey);
    if (activeGuidedTutorial === finish) {
      activeGuidedTutorial = null;
    }
    if (previousFocus?.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  };
  const finish = (): Promise<void> => {
    finishing ??= finishOnce().finally(() => {
      finishing = null;
    });
    return finishing;
  };
  const render = async (): Promise<void> => {
    const current = ++revision;
    const step = steps[index];
    busy = true;
    if (previous) {
      previous.disabled = true;
    }
    if (next) {
      next.disabled = true;
    }
    tutorial.dataset.stepState = 'loading';
    tutorial.dataset.stepIndex = String(index);
    tutorial.dataset.stepSelector = step.selector ?? '';
    clearHighlight();
    if (title) {
      title.textContent = step.title;
    }
    if (description) {
      description.textContent = 'Cargando…';
    }
    const leave = leaveStep;
    leaveStep = undefined;
    const layerTimer = window.setInterval(showAboveDialog, 60);
    try {
      await leave?.();
      if (!active || current !== revision) {
        return;
      }
      await step.onEnter?.();
      leaveStep = step.onLeave;
      if (!active || current !== revision) {
        return;
      }
      const scope = step.scope === 'document' ? document : options.root;
      highlighted = step.selector
        ? await waitForTutorialElement(step.selector, scope, () => active && current === revision)
        : null;
      if (!active || current !== revision) {
        return;
      }
      const unavailable = Boolean(step.selector && !highlighted);
      tutorial.dataset.stepState = unavailable ? 'unavailable' : 'ready';
      if (description) {
        description.textContent = unavailable
          ? (step.unavailableText ??
            'Este apartado no está disponible ahora. Puedes continuar y volver a intentarlo más tarde.')
          : step.text;
      }
      if (highlighted) {
        highlighted.classList.add('home-tutorial-highlight');
        highlighted.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    } catch {
      if (!active || current !== revision) {
        return;
      }
      tutorial.dataset.stepState = 'unavailable';
      if (description) {
        description.textContent =
          step.unavailableText ??
          'Este apartado no está disponible ahora. Puedes continuar y volver a intentarlo más tarde.';
      }
    } finally {
      window.clearInterval(layerTimer);
      if (active && current === revision) {
        if (counter) {
          counter.textContent = index + 1 + ' / ' + steps.length;
        }
        if (previous) {
          previous.disabled = index === 0;
        }
        if (next) {
          next.disabled = false;
          next.textContent = index === steps.length - 1 ? 'Terminar' : 'Siguiente';
        }
        showAboveDialog();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (active && current === revision) {
          positionHighlight();
          if (highlighted) {highlightFrame = requestAnimationFrame(followHighlight);}
          next?.focus({ preventScroll: true });
          busy = false;
        }
      }
    }
  };
  const start = async (topic?: GuidedHelpTopic): Promise<void> => {
    if (finishing) {
      await finishing;
    }
    if (active) {
      return;
    }
    if (activeGuidedTutorial) {
      await activeGuidedTutorial();
    }
    steps = topic
      ? topic.selectors.map((selector) => {
          const step = [...options.steps, ...(options.helpSteps ?? [])].find((entry) =>
            selector.startsWith('@') ? entry.id === selector.slice(1) : entry.selector === selector,
          );
          if (!step) {
            throw new Error('TUTORIAL_TOPIC_STEP_UNAVAILABLE');
          }
          return step;
        })
      : options.steps;
    tutorial.dataset.helpTopic = topic?.id ?? '';
    activeGuidedTutorial = finish;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active = true;
    index = 0;
    prompt.hidden = true;
    tutorial.hidden = false;
    showAboveDialog();
    await options.onStart?.();
    if (active) {
      pending = render();
      await pending;
    }
  };
  const begin = (): void => {
    void start();
  };
  const stop = (): void => {
    void finish();
  };
  const help = mountGuidedHelp({
    id: options.id,
    topics: guidedHelpTopics[options.id] ?? [],
    choose: (topic) => {
      void start(topic);
    },
  });
  const openHelp = (): void => {
    void (async () => {
      if (activeGuidedTutorial) {
        await activeGuidedTutorial();
      }
      help.open();
    })();
  };
  replay.dataset.guidedHelpOpen = options.id;
  replay.setAttribute('aria-haspopup', 'dialog');
  replay.addEventListener('click', openHelp);
  tutorial.querySelector('[data-guided-tutorial-help]')?.addEventListener('click', openHelp);
  prompt
    .querySelector<HTMLButtonElement>('[data-guided-tutorial-start]')
    ?.addEventListener('click', begin);
  prompt
    .querySelector<HTMLButtonElement>('[data-guided-tutorial-dismiss]')
    ?.addEventListener('click', stop);
  tutorial
    .querySelector<HTMLButtonElement>('[data-guided-tutorial-skip]')
    ?.addEventListener('click', stop);
  previous?.addEventListener('click', () => {
    if (busy || index === 0) {
      return;
    }
    index--;
    pending = render();
  });
  next?.addEventListener('click', () => {
    if (busy) {
      return;
    }
    if (index === steps.length - 1) {
      return stop();
    }
    index++;
    pending = render();
  });
  tutorial.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stop();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous?.click();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      next?.click();
    }
    if (event.key === 'Tab') {
      const controls = [...tutorial.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  return {
    start: begin,
    help: openHelp,
    offer: () => {
      if (!activeGuidedTutorial && !completed(options.storageKey) && tutorial.hidden) {
        prompt.hidden = false;
      }
    },
  };
}

export async function waitForTutorialElement(
  selector: string,
  scope: ParentNode = document,
  current: () => boolean = () => true,
  timeoutMs = 2500,
): Promise<HTMLElement | null> {
  const deadline = performance.now() + timeoutMs;
  while (current()) {
    const element = scope.querySelector<HTMLElement>(selector);
    if (
      element &&
      element.getBoundingClientRect().width >= 1 &&
      element.getBoundingClientRect().height >= 1 &&
      getComputedStyle(element).visibility !== 'hidden'
    ) {
      return element;
    }
    if (performance.now() >= deadline) {
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  }
  return null;
}
