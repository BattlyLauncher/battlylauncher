import { setUiText } from '../i18n/dialog-text';

export interface BattlyAskOptions {
  readonly hideCancel?: boolean;
  readonly cancelText?: string;
  readonly confirmText?: string;
  readonly danger?: boolean;
  readonly text: string;
  readonly note?: string;
  readonly title?: string;
  readonly signal?: AbortSignal;
  readonly focusCancel?: boolean;
}

export function askBattly(options: BattlyAskOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve(false);
      return;
    }
    const overlay = document.createElement('dialog');
    overlay.className = 'modal is-active battly-ask-modal';
    overlay.dataset.askModal = '';
    const background = document.createElement('div');
    background.className = 'modal-background';
    const card = document.createElement('div');
    card.className = 'modal-card modal-animated';
    const body = document.createElement('section');
    body.className = 'modal-card-body';
    const title = document.createElement('h2');
    title.className = 'title';
    setUiText(title, options.title ?? 'Confirmar acción');
    const text = document.createElement('p');
    text.className = 'subtitle';
    const message = document.createElement('span');
    setUiText(message, options.text);
    text.append(message);
    if (options.note) {
      const note = document.createElement('span');
      setUiText(note, options.note);
      text.append(document.createElement('br'), document.createElement('br'), note);
    }
    const footer = document.createElement('footer');
    footer.className = 'modal-card-foot';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = `button ${options.danger === true ? 'is-danger is-outlined' : 'is-info'}`;
    setUiText(confirm, options.confirmText ?? 'Confirmar');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.hidden = options.hideCancel === true;
    cancel.className = 'button is-danger is-outlined';
    setUiText(cancel, options.cancelText ?? 'Cancelar');
    body.append(title, text);
    if (!options.hideCancel) {
      footer.append(cancel);
    }
    footer.append(confirm);
    card.append(body, footer);
    overlay.append(background, card);
    document.body.append(overlay);
    overlay.showModal();

    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener('abort', aborted);
      overlay.close();
      overlay.remove();
      resolve(accepted);
    };
    const aborted = (): void => finish(false);
    options.signal?.addEventListener('abort', aborted, { once: true });
    confirm.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    background.addEventListener('click', () => finish(false));
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        finish(false);
      }
    });
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    (options.focusCancel ? cancel : confirm).focus();
  });
}
