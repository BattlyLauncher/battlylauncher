import type { ServerInstallProgress } from '../../shared/servers/server-contract';
import './server-installation-progress.css';

export function mountServerInstallationProgress() {
  const dialog = document.createElement('dialog');
  dialog.className = 'server-original-progress';
  dialog.setAttribute('aria-labelledby', 'server-original-progress-title');
  dialog.innerHTML = /* HTML */ `<div class="server-install-heading">
      <span class="server-install-symbol"
        ><i
          class="fa-solid fa-server"
          aria-hidden="true"
        ></i></span
      ><span class="server-install-brand">Battly Servers</span>
    </div>
    <h2 id="server-original-progress-title">Creando servidor</h2>
    <p class="server-install-name"></p>
    <div
      class="server-install-live"
      role="status"
    >
      <span class="server-install-phase"></span><strong class="server-install-percent"></strong>
    </div>
    <progress
      max="100"
      aria-label="Progreso de instalación"
    ></progress>
    <div
      class="panel-container-creating-progresses"
      aria-live="polite"
    ></div>
    <p class="server-install-file"></p>
    <p
      class="server-install-error"
      role="alert"
      hidden
    ></p>
    <button
      type="button"
      hidden
    >
      Volver al servidor
    </button>`;
  document.body.append(dialog);
  let id = '';
  let failed = false;
  const list = dialog.querySelector<HTMLElement>('.panel-container-creating-progresses')!;
  const bar = dialog.querySelector('progress')!;
  const close = dialog.querySelector('button')!;
  const error = dialog.querySelector<HTMLElement>('.server-install-error')!;
  const file = dialog.querySelector<HTMLElement>('.server-install-file')!;
  const activeLabel = dialog.querySelector<HTMLElement>('.server-install-phase')!;
  const percentage = dialog.querySelector<HTMLElement>('.server-install-percent')!;
  const rows = new Map<string, HTMLElement>();
  const phases = ['resolving', 'server', 'java', 'loader'] as const;
  const labels = [
    'Configurando servidor',
    'Descargando servidor',
    'Descargando Java Runtime',
    'Instalando loader',
  ];
  close.onclick = () => dialog.close();
  dialog.addEventListener('close', () =>
    document.querySelector('[data-server-mount]')?.classList.remove('is-installing-server'),
  );
  dialog.addEventListener('cancel', (event) => {
    if (!failed) {
      event.preventDefault();
    }
  });
  return {
    open(serverId: string, name: string, installed: boolean): void {
      document.querySelector('[data-server-mount]')?.classList.add('is-installing-server');
      id = serverId;
      failed = false;
      list.hidden = false;
      dialog.dataset.state = 'working';
      error.hidden = close.hidden = true;
      file.textContent = '';
      bar.removeAttribute('value');
      dialog.querySelector('h2')!.textContent = installed
        ? 'Instalando servidor'
        : 'Creando servidor';
      dialog.querySelector('.server-install-name')!.textContent = name;
      list.replaceChildren();
      rows.clear();
      for (const [index, phase] of phases.entries()) {
        const row = document.createElement('div');
        row.className = 'download-status-server';
        row.innerHTML = `<p class="whatisdownloading"></p><p class="percentajewhatisloading"><span></span><i aria-hidden="true"></i></p>`;
        row.querySelector('.whatisdownloading')!.textContent = labels[index];
        row.dataset.step = String(index + 1);
        rows.set(phase, row);
        list.append(row);
      }
      this.update({ id, phase: 'resolving', current: '', completedBytes: 0, totalBytes: 0 });
      if (!dialog.open) {
        dialog.showModal();
      }
    },
    remove(serverId: string, name: string): void {
      this.open(serverId, name, false);
      list.hidden = true;
      dialog.querySelector('h2')!.textContent = 'Eliminando servidor';
      activeLabel.textContent = 'Deteniendo y eliminando el servidor…';
    },
    update(progress: ServerInstallProgress): void {
      if (progress.id !== id || failed) {
        return;
      }
      const index = progress.phase === 'complete' ? phases.length : phases.indexOf(progress.phase);
      const percent =
        Number.isFinite(progress.totalBytes) &&
        Number.isFinite(progress.completedBytes) &&
        progress.totalBytes > 0
          ? Math.max(
              0,
              Math.min(100, Math.round((progress.completedBytes / progress.totalBytes) * 100)),
            )
          : null;
      for (const [position, phase] of phases.entries()) {
        const row = rows.get(phase);
        if (!row) {
          continue;
        }
        row.dataset.state = position < index ? 'done' : position === index ? 'active' : 'pending';
        row.setAttribute('aria-current', position === index ? 'step' : 'false');
        row.querySelector('span')!.textContent =
          position < index
            ? '100%'
            : position > index
              ? ''
              : percent === null
                ? '…'
                : `${percent}%`;
        row.querySelector('i')!.className =
          position < index
            ? 'fa-solid fa-check'
            : position === index
              ? 'fa-solid fa-circle-notch fa-spin'
              : '';
      }
      activeLabel.textContent =
        progress.phase === 'complete' ? 'Terminando la instalación…' : labels[index];
      percentage.textContent =
        progress.phase === 'complete' ? '100%' : percent === null ? '…' : `${percent}%`;
      if (progress.phase === 'complete') {
        bar.value = 100;
        dialog.dataset.state = 'complete';
      } else if (percent !== null) {
        bar.value = percent;
      } else {
        bar.removeAttribute('value');
      }
      file.textContent =
        progress.phase === 'complete' ? 'Terminando la instalación…' : progress.current;
      file.title = file.textContent;
    },
    finish(serverId: string): void {
      if (id === serverId) {
        dialog.close();
      }
    },
    fail(serverId: string, message: string): void {
      if (id !== serverId) {
        return;
      }
      failed = true;
      dialog.dataset.state = 'error';
      percentage.textContent = '';
      bar.value = 0;
      for (const row of rows.values()) {
        row.querySelector('i')!.classList.remove('fa-spin');
      }
      error.textContent = message;
      error.hidden = close.hidden = false;
    },
  };
}
