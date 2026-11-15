import type { InstanceSummary } from '../../shared/minecraft/instance';
import { modpackInstallPercent } from '../../shared/mods/modpack-install-contract';
import './bypack-panel.css';
import { openBypackImportFlow } from './bypack-import';

let active: HTMLDialogElement | undefined;
const size = (bytes: number): string => {
  const unit = bytes < 1024 ? 0 : bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toLocaleString(document.documentElement.lang || 'es', { maximumFractionDigits: 2 })} ${['B', 'KB', 'MB', 'GB'][unit]}`;
};

export async function openBypackFlow(
  instance?: InstanceSummary,
  onImported?: (instance: InstanceSummary) => void,
  exporter = (id: string) => window.battly.exportBypack(id),
): Promise<void> {
  if (!instance) {
    return openBypackImportFlow(undefined, onImported);
  }
  if (active?.open) {
    active.focus();
    return;
  }
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  active = dialog;
  dialog.className = 'bypack-dialog';
  dialog.setAttribute('aria-labelledby', 'bypack-title');
  dialog.innerHTML = /* HTML */ `<header>
      <span>BATTLY PACK</span>
      <h2 id="bypack-title"></h2>
    </header>
    <p data-description></p>
    <p
      data-status
      role="status"
      aria-live="polite"
    ></p>
    <progress aria-label="Progreso del paquete"></progress>
    <p data-item></p>
    <dl data-summary></dl>
    <p data-destination></p>
    <ul data-warnings></ul>
    <footer>
      <button
        type="button"
        data-close
        disabled
      >
        Cerrar
      </button>
    </footer>`;
  const heading = dialog.querySelector('h2')!;
  heading.textContent = instance ? `Exportar ${instance.name}` : 'Importar instancia .bypack';
  dialog.querySelector('[data-description]')!.textContent = instance
    ? 'Incluye mods, configs, resourcepacks y shaders. Excluye loader, assets, mundos, carpetas que empiezan por punto, copias, capturas y logs. El contenido identificado se descargará de sus proveedores al importar.'
    : 'Se creará una instancia nueva con sus configs y archivos. Los mods referenciados se descargarán en su versión exacta y se comprobará su integridad.';
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const item = dialog.querySelector<HTMLElement>('[data-item]')!;
  const progress = dialog.querySelector('progress')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  let busy = true;
  status.textContent = 'Selecciona el archivo en la ventana del sistema…';
  const unsubscribe = window.battly.onBypackProgress((value) => {
    status.textContent = value.message;
    item.textContent = value.item;
    item.title = value.item;
    status.title = value.message;
    if ((value.phase === 'reading' || value.phase === 'writing') && value.current === 0) {
      progress.removeAttribute('value');
    } else {
      progress.max = 100;
      progress.value = modpackInstallPercent(value);
    }
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', (event) => {
    if (busy) {
      event.preventDefault();
    }
  });
  dialog.addEventListener('close', () => {
    unsubscribe();
    dialog.remove();
    if (active === dialog) {
      active = undefined;
    }
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  try {
    if (instance) {
      const result = await exporter(instance.id);
      if (!result) {
        busy = false;
        dialog.close();
        return;
      }
      heading.textContent = 'Paquete .bypack exportado';
      status.textContent = 'Listo para compartir e importar en Battly.';
      const summary = dialog.querySelector('[data-summary]')!;
      for (const [label, value] of [
        ['Tamaño del .bypack', size(result.archiveBytes)],
        ['Contenido original incluido', size(result.sourceBytes)],
        ['Descargas fuera del ZIP', size(result.referencedBytes)],
        [
          'Archivos de Modrinth / CurseForge',
          `${result.modrinthFiles} / ${result.curseforgeFiles}`,
        ],
        ['Archivos comprimidos', String(result.embeddedFiles)],
      ]) {
        const term = document.createElement('dt');
        term.textContent = label;
        const detail = document.createElement('dd');
        detail.textContent = value;
        summary.append(term, detail);
      }
      dialog.querySelector('[data-destination]')!.textContent = result.path;
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.innerHTML = '<i class="fas fa-folder-open" aria-hidden="true"></i> Mostrar en carpeta';
      reveal.addEventListener('click', () => {
        void window.battly.revealBypack(result.path).catch(() => {
          status.textContent =
            'No se pudo abrir la carpeta. Puedes copiar la ruta indicada arriba.';
        });
      });
      close.before(reveal);
      for (const warning of result.warnings) {
        const entry = document.createElement('li');
        entry.textContent = warning;
        dialog.querySelector('[data-warnings]')!.append(entry);
      }
    }
    item.textContent = '';
    progress.max = 1;
    progress.value = 1;
  } catch (error) {
    heading.textContent = instance ? 'No se pudo exportar' : 'No se pudo importar';
    status.textContent =
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
        : 'La operación no pudo completarse.';
    progress.hidden = true;
  } finally {
    busy = false;
    close.disabled = false;
    unsubscribe();
    if (dialog.open) {
      close.focus();
    }
  }
}
