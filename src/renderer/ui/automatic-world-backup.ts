import type { DriveTransferProgress } from '../../shared/settings/drive-progress';
import { driveProgressPercent, driveProgressLabel } from '../../shared/settings/drive-progress';
import { setUiText } from '../i18n/dialog-text';
import './automatic-world-backup.css';

export function mountAutomaticWorldBackup() {
  const card = document.createElement('aside');
  card.className = 'automatic-world-backup';
  card.hidden = true;
  card.innerHTML = /* HTML */ `<div class="backup-heading">
      <span
        class="backup-icon"
        aria-hidden="true"
        ><i class="fas fa-cloud-upload-alt"></i></span
      ><strong></strong
      ><button
        class="backup-close"
        type="button"
      >
        ×
      </button>
    </div>
    <p class="backup-status"></p>
    <div class="backup-meter"><progress max="100"></progress><output></output></div>`;
  const title = card.querySelector('strong')!;
  const status = card.querySelector('p')!;
  const bar = card.querySelector('progress')!;
  const count = card.querySelector('output')!;
  const close = card.querySelector('button')!;
  close.setAttribute('aria-label', 'Cerrar');
  status.setAttribute('role', 'status');
  let active = false;
  let lastDetail: DriveTransferProgress | undefined;
  close.onclick = () => {
    card.hidden = true;
  };
  document.body.append(card);
  return (
    message: string,
    state: 'progress' | 'complete' | 'error',
    detail?: DriveTransferProgress,
  ) => {
    if (state === 'progress' && !active) {
      active = true;
      lastDetail = undefined;
      card.hidden = false;
      count.textContent = '';
      bar.removeAttribute('value');
    }
    card.dataset.state = state;
    card.querySelector('.backup-icon i')!.className =
      state === 'complete'
        ? 'fas fa-check'
        : state === 'error'
          ? 'fas fa-exclamation-triangle'
          : 'fas fa-cloud-upload-alt';
    setUiText(
      title,
      state === 'complete'
        ? 'Copia completada'
        : state === 'error'
          ? 'No se pudo completar la copia'
          : 'Guardando tus mundos',
    );
    setUiText(
      status,
      message ||
        (state === 'complete'
          ? 'Tus mundos están listos.'
          : 'Comprueba tu conexión y vuelve a intentarlo. Tus mundos locales no se han modificado.'),
    );
    status.title = status.textContent || '';
    if (detail) {
      lastDetail = detail;
      const percent = driveProgressPercent(detail);
      count.textContent = driveProgressLabel(detail);
      if (percent !== null) {
        bar.value = percent;
      } else {
        bar.removeAttribute('value');
      }
      if (state === 'progress' && detail.phase === 'publishing') {
        setUiText(status, 'Sincronizando el historial de Google Drive…');
      }
    }
    if (state !== 'progress') {
      active = false;
      if (state === 'complete') {
        bar.value = 100;
        count.textContent = lastDetail ? driveProgressLabel(lastDetail, true) : '100%';
      } else {
        bar.removeAttribute('value');
      }
    }
  };
}
