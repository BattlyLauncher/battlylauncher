import './error-reporter.css';
import { userErrorMessage } from './user-error';

export function bindErrorReporter(): void {
  let opening = false;
  let modal: HTMLDialogElement | undefined;
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.ctrlKey || event.altKey || event.key.toLowerCase() !== 'e') {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (opening || modal || event.repeat) {
        return;
      }
      void open();
    },
    true,
  );

  async function open(): Promise<void> {
    opening = true;
    const previousFocus = document.activeElement;
    let screenshot = '';
    let captureError = '';
    try {
      screenshot = await window.battly.prepareErrorReport();
    } catch (error) {
      captureError = userErrorMessage(
        error,
        'No se pudo capturar la ventana. Vuelve a pulsar Ctrl + E.',
      );
    }
    const dialog = document.createElement('dialog');
    modal = dialog;
    dialog.id = 'error-report-modal';
    dialog.className = 'battly-error-report';
    dialog.setAttribute('aria-labelledby', 'error-report-title');
    dialog.innerHTML = /* HTML */ `<header>
        <div>
          <h2 id="error-report-title">
            <i
              class="fas fa-bug"
              aria-hidden="true"
            ></i>
            Reportar problema
          </h2>
          <p>Describe qué ocurrió y cómo podemos reproducirlo.</p>
        </div>
        <button
          type="button"
          data-close
          aria-label="Cerrar"
        >
          ×
        </button>
      </header>
      <form>
        <section class="error-report-body">
          <figure>
            <img alt="Captura de Battly antes de abrir el reporte" />
            <figcaption>Esta captura se adjuntará al reporte.</figcaption>
          </figure>
          <label for="error-report-comment">Describe el problema</label
          ><textarea
            id="error-report-comment"
            maxlength="1000"
            minlength="10"
            required
            placeholder="Explica qué estabas haciendo cuando ocurrió el problema..."
          ></textarea>
          <div class="error-report-count">
            <span data-count>0 / 1000 caracteres</span><span>Mínimo 10 caracteres</span>
          </div>
          <details>
            <summary>Información incluida</summary>
            <p>
              La captura, las últimas 500 líneas de los registros del launcher y la información del
              sistema: sistema operativo, CPU, memoria y versiones de Battly y Electron.
            </p>
          </details>
          <p
            data-status
            role="status"
            aria-live="polite"
          ></p>
        </section>
        <footer>
          <button
            type="button"
            data-close
          >
            Cancelar</button
          ><button type="submit">
            <i
              class="fas fa-paper-plane"
              aria-hidden="true"
            ></i>
            Enviar reporte
          </button>
        </footer>
      </form>`;
    const comment = dialog.querySelector('textarea')!;
    const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const status = dialog.querySelector<HTMLElement>('[data-status]')!;
    const picture = dialog.querySelector('img')!;
    if (screenshot) {
      picture.src = screenshot;
    } else {
      dialog.querySelector('figure')!.hidden = true;
      status.textContent = captureError;
    }
    let sending = false;
    let sent = false;
    const close = (): void => {
      if (sending) {
        return;
      }
      dialog.close();
      dialog.remove();
      modal = undefined;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
    dialog
      .querySelectorAll('[data-close]')
      .forEach((button) => button.addEventListener('click', close));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    const update = (): void => {
      dialog.querySelector('[data-count]')!.textContent =
        `${comment.value.length} / 1000 caracteres`;
      submit.disabled = sending || sent || !screenshot || comment.value.trim().length < 10;
    };
    comment.addEventListener('input', update);
    dialog.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submit.disabled) {
        return;
      }
      sending = true;
      update();
      comment.readOnly = true;
      dialog.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => {
        button.disabled = true;
      });
      submit.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Enviando…';
      status.textContent = '';
      void window.battly
        .submitErrorReport(comment.value)
        .then(() => {
          sent = true;
          status.textContent = 'Reporte enviado correctamente. ¡Gracias por tu ayuda!';
          dialog.querySelector<HTMLButtonElement>('footer [data-close]')!.textContent = 'Cerrar';
          submit.hidden = true;
        })
        .catch((error: unknown) => {
          status.textContent = userErrorMessage(
            error,
            'No se pudo enviar el reporte. Vuelve a intentarlo.',
          );
        })
        .finally(() => {
          sending = false;
          comment.readOnly = sent;
          update();
          submit.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> Enviar reporte';
          dialog.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((button) => {
            button.disabled = false;
          });
        });
    });
    document.body.append(dialog);
    dialog.showModal();
    update();
    comment.focus();
    opening = false;
  }
}
