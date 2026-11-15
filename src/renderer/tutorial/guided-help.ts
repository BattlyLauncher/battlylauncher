import nivixUrl from '../assets/nivix.png';
import { setUiText } from '../i18n/dialog-text';
import type { GuidedHelpTopic } from './guided-help-topics';
import './guided-help.css';

export function mountGuidedHelp(options: {
  readonly id: string;
  readonly topics: readonly GuidedHelpTopic[];
  readonly choose: (topic?: GuidedHelpTopic) => void;
}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'nivix-help';
  dialog.dataset.guidedHelp = options.id;
  dialog.setAttribute('aria-labelledby', options.id + '-help-title');
  dialog.innerHTML = /* HTML */ `<header>
      <img
        alt="Nivix"
        width="72"
        height="72"
      />
      <div>
        <span>Nivix</span>
        <h2></h2>
        <p></p>
      </div>
      <button
        type="button"
        data-help-close
        aria-label="Cerrar"
      >
        ×
      </button>
    </header>
    <div class="nivix-help-questions"></div>
    <footer>
      <button
        type="button"
        data-help-full
      ></button>
    </footer>`;
  dialog.querySelector('img')!.src = nivixUrl;
  const heading = dialog.querySelector('h2')!;
  heading.id = options.id + '-help-title';
  setUiText(heading, '¿En qué te ayudo?');
  setUiText(dialog.querySelector('p')!, 'Elige una pregunta y te enseño los pasos en Battly.');
  const questions = dialog.querySelector('.nivix-help-questions')!;
  for (const topic of options.topics) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.helpTopic = topic.id;
    const label = document.createElement('span');
    setUiText(label, topic.question);
    const arrow = document.createElement('span');
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    button.append(label, arrow);
    button.addEventListener('click', () => {
      dialog.close();
      options.choose(topic);
    });
    questions.append(button);
  }
  const full = dialog.querySelector<HTMLButtonElement>('[data-help-full]')!;
  setUiText(full, 'Ver el tutorial completo');
  full.addEventListener('click', () => {
    dialog.close();
    options.choose();
  });
  dialog.querySelector('[data-help-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) {
      return;
    }
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      dialog.close();
    }
  });
  document.body.append(dialog);
  return {
    open: (): void => {
      if (dialog.open) {
        return;
      }
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[data-help-topic]')?.focus();
    },
  };
}
