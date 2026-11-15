import type { DataRootProgress } from '../../shared/settings/data-root-contract';
import { setUiText } from '../i18n/dialog-text';
import './data-root-migration.css';

export function showDataRootMigration() {
  const modal = document.createElement('dialog');
  modal.className = 'data-root-migration';
  modal.setAttribute('aria-labelledby', 'data-root-migration-title');
  modal.innerHTML = /* HTML */ `<header>
      <i
        class="fa-solid fa-folder-open"
        aria-hidden="true"
      ></i>
      <h2 id="data-root-migration-title"></h2>
    </header>
    <p data-intro></p>
    <dl>
      <div>
        <dt data-from></dt>
        <dd data-source>—</dd>
      </div>
      <div>
        <dt data-to></dt>
        <dd data-target>—</dd>
      </div>
    </dl>
    <p
      id="data-root-migration-phase"
      data-phase
      role="status"
      aria-live="polite"
    ></p>
    <progress
      max="100"
      aria-labelledby="data-root-migration-phase"
    ></progress>
    <p data-file></p>
    <p data-detail></p>
    <footer>
      <span data-backup></span
      ><button
        type="button"
        hidden
      ></button>
    </footer>`;
  const element = <T extends HTMLElement>(selector: string): T => modal.querySelector<T>(selector)!;
  const label = (selector: string, text: string): void => setUiText(element(selector), text);
  label('h2', 'Mover los datos de Battly');
  label('[data-intro]', 'Copia verificada de tus versiones, instancias y mundos.');
  label('[data-from]', 'Ubicación actual');
  label('[data-to]', 'Nueva ubicación');
  label('[data-backup]', 'La carpeta original se conserva.');
  label('[data-phase]', 'Selecciona una carpeta vacía…');
  label('button', 'Cerrar');
  const bar = element<HTMLProgressElement>('progress');
  const close = element<HTMLButtonElement>('button');
  let busy = true;
  modal.addEventListener('cancel', (event) => {
    if (busy) {
      event.preventDefault();
    }
  });
  const remove = (): void => {
    modal.close();
    modal.remove();
  };
  close.addEventListener('click', remove);
  document.body.append(modal);
  modal.showModal();
  return {
    remove,
    update(progress: DataRootProgress): void {
      element('[data-source]').textContent = progress.source;
      element('[data-target]').textContent = progress.target;
      const labels = {
        checking: 'Comprobando archivos y espacio disponible…',
        copying: 'Copiando archivos…',
        verifying: 'Verificando la integridad de la copia…',
        committing: 'Guardando la nueva ubicación…',
        complete: 'Traslado completado. Reiniciando Battly…',
      };
      label('[data-phase]', labels[progress.phase]);
      if (progress.phase === 'checking') {
        bar.removeAttribute('value');
      } else {
        bar.value =
          progress.phase === 'complete'
            ? 100
            : progress.phase === 'committing'
              ? 98
              : (progress.phase === 'copying' ? 0 : 60) +
                (progress.total ? progress.bytes / progress.total : 1) *
                  (progress.phase === 'copying' ? 60 : 38);
      }
      element('[data-file]').textContent = progress.file;
      element('[data-detail]').textContent = progress.total
        ? `${(progress.bytes / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MiB`
        : '';
    },
    error(error: unknown): void {
      busy = false;
      close.hidden = false;
      bar.hidden = true;
      const message = error instanceof Error ? error.message : '';
      label(
        '[data-phase]',
        message.includes('Close Minecraft')
          ? 'Cierra Minecraft, los servidores y las operaciones en curso antes de continuar.'
          : message.includes('Insufficient')
            ? 'No hay espacio suficiente en el destino.'
            : message.includes('Destination must be empty')
              ? 'Selecciona una carpeta vacía.'
              : 'No se pudo completar el traslado. La carpeta original se conserva.',
      );
      element('[data-file]').textContent = '';
      element('[data-detail]').textContent = '';
      modal.classList.add('has-error');
    },
  };
}
