import { emptyState } from '../ui/empty-state';
import type { InstanceSummary } from '../../shared/minecraft/instance';
import {
  instanceContentKinds,
  type InstanceContentEntry,
  type InstanceContentKind,
} from '../../shared/minecraft/instance-content';
import './instance-content.css';
import { openBypackFlow } from './bypack-panel';
import { toggleModWithDependents } from '../ui/toggle-mod';
import { setUiText } from '../i18n/dialog-text';
import { setUserText } from '../i18n/ui-translator';

const labels: Record<InstanceContentKind, string> = {
  mods: 'Mods',
  resourcepacks: 'Resourcepacks',
  shaderpacks: 'Shaders',
  saves: 'Mundos',
};
const emptyLabels: Record<InstanceContentKind, string> = {
  mods: 'Esta instancia todavía no tiene mods.',
  resourcepacks: 'Esta instancia todavía no tiene paquetes de recursos.',
  shaderpacks: 'Esta instancia todavía no tiene shaders.',
  saves: 'Esta instancia todavía no tiene mundos.',
};
const icons = { mods: 'puzzle-piece', resourcepacks: 'image', shaderpacks: 'sun', saves: 'globe' };
function icon(name: string): string {
  return `<i class="fas fa-${name}" aria-hidden="true"></i>`;
}

export function openInstanceContent(instance: InstanceSummary): void {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'instance-content-dialog';
  dialog.setAttribute('aria-labelledby', 'instance-content-title');
  dialog.innerHTML = /* HTML */ ` <header>
      <div>
        <h2 id="instance-content-title"></h2>
        <small data-instance-version></small>
      </div>
      <button
        type="button"
        data-close
        aria-label="Cerrar contenido"
      >
        ✕
      </button>
    </header>
    <nav aria-label="Tipo de contenido"></nav>
    <div class="instance-content-toolbar">
      <button
        type="button"
        data-import
      >
        ${icon('plus')} Añadir archivos
      </button>
      <button
        type="button"
        data-folder
      >
        ${icon('folder-open')} Abrir carpeta
      </button>
      <button
        type="button"
        data-refresh
      >
        ${icon('sync-alt')} Actualizar
      </button>
      <button
        type="button"
        data-export-bypack
      >
        ${icon('file-export')} Exportar .bypack
      </button>
      <button
        type="button"
        data-backups
        hidden
      >
        ${icon('history')} Ver copias
      </button>
      <input
        type="search"
        data-search
        placeholder="Buscar por nombre…"
        aria-label="Buscar contenido"
      />
      <div
        class="instance-content-views"
        role="group"
        aria-label="Vista"
      >
        <button
          type="button"
          data-view="grid"
          aria-label="Cuadrícula"
          title="Cuadrícula"
        >
          ${icon('th-large')}
        </button>
        <button
          type="button"
          data-view="list"
          aria-label="Lista"
          title="Lista"
        >
          ${icon('list')}
        </button>
      </div>
    </div>
    <p class="instance-content-help"></p>
    <p
      data-status
      role="status"
      aria-live="polite"
    ></p>
    <ul
      class="instance-content-list"
      aria-label="Contenido instalado"
    ></ul>
    <footer>
      <span>Archivar mueve el contenido a una carpeta recuperable de esta instancia.</span>
      <button
        type="button"
        data-archive-folder
      >
        ${icon('archive')} Ver archivados
      </button>
    </footer>`;
  const heading = dialog.querySelector<HTMLElement>('h2')!;
  setUserText(heading, instance.name);
  setUserText(
    dialog.querySelector<HTMLElement>('[data-instance-version]')!,
    `Minecraft ${instance.version} · ${instance.loader ?? 'Vanilla'} ${instance.loaderVersion ?? ''}`,
  );
  const nav = dialog.querySelector('nav')!;
  const status = dialog.querySelector<HTMLElement>('[data-status]')!;
  const help = dialog.querySelector<HTMLElement>('.instance-content-help')!;
  const list = dialog.querySelector('ul')!;
  const search = dialog.querySelector<HTMLInputElement>('[data-search]')!;
  const add = dialog.querySelector<HTMLButtonElement>('[data-import]')!;
  let view = localStorage.getItem('instance-content-view') === 'list' ? 'list' : 'grid';
  const applyView = (): void => {
    list.dataset.view = view;
    dialog
      .querySelectorAll<HTMLButtonElement>('[data-view]')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.view === view)),
      );
  };
  dialog.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) =>
    button.addEventListener('click', () => {
      view = button.dataset.view!;
      localStorage.setItem('instance-content-view', view);
      applyView();
    }),
  );
  applyView();
  let kind: InstanceContentKind = 'mods';
  let entries: readonly InstanceContentEntry[] = [];
  let busy = false;
  const positions = new Map<InstanceContentKind, { scroll: number; query: string }>();

  function setBusy(value: boolean): void {
    busy = value;
    list.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll<HTMLButtonElement>('button:not([data-close])').forEach((button) => {
      button.disabled = value;
    });
    search.disabled = value;
  }

  function render(): void {
    list.replaceChildren();
    const visible = entries.filter((entry) =>
      `${entry.title ?? ''} ${entry.name} ${entry.version ?? ''}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
    );
    setUiText(status, `${visible.length} de ${entries.length} elementos`);
    if (!visible.length) {
      const empty = document.createElement('li');
      empty.className = 'instance-content-empty';
      empty.append(emptyState(entries.length ? 'No hay coincidencias.' : emptyLabels[kind]));
      list.append(empty);
    }
    for (const entry of visible) {
      const row = document.createElement('li');
      row.classList.toggle('is-disabled', !entry.enabled);
      const thumbnail = document.createElement('div');
      thumbnail.className = 'instance-content-thumbnail';
      thumbnail.innerHTML = icon(icons[kind]);
      if (entry.iconDataUrl) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.src = entry.iconDataUrl;
        image.addEventListener('error', () => image.remove(), { once: true });
        thumbnail.append(image);
      }
      const description = document.createElement('div');
      description.className = 'instance-content-description';
      const name = document.createElement('strong');
      setUserText(name, entry.title ?? entry.name);
      const detail = document.createElement('small');
      setUiText(
        detail,
        entry.directory ? 'Carpeta' : `${(entry.size / 1024 / 1024).toFixed(2)} MB`,
      );
      if (kind === 'mods') {
        setUiText(
          detail,
          entry.enabled
            ? `${(entry.size / 1024 / 1024).toFixed(2)} MB · Activo`
            : `${(entry.size / 1024 / 1024).toFixed(2)} MB · Desactivado`,
        );
      }
      const filename = document.createElement('small');
      filename.className = 'instance-content-filename';
      setUserText(filename, entry.name);
      filename.title = entry.name;
      filename.hidden = !entry.title || entry.title === entry.name;
      const versions = document.createElement('div');
      versions.className = 'instance-content-badges';
      if (kind === 'mods') {
        const version = document.createElement('span');
        if (entry.version) {
          const label = document.createElement('bdi');
          setUiText(label, 'Versión');
          const value = document.createElement('bdi');
          setUserText(value, entry.version);
          version.append(label, document.createTextNode(' '), value);
        } else {
          setUiText(version, 'Versión no declarada');
        }
        versions.append(version);
        const game = document.createElement('span');
        if (entry.gameVersion) {
          setUserText(game, `MC ${entry.gameVersion}`);
        } else {
          setUiText(game, 'Versión de Minecraft no declarada');
        }
        versions.append(game);
        if (entry.loader && entry.loader !== 'unknown') {
          const loader = document.createElement('span');
          setUserText(loader, entry.loader);
          versions.append(loader);
        }
      } else if (kind === 'saves') {
        const backups = document.createElement('span');
        setUiText(backups, `Copias: ${entry.backups ?? 0}`);
        versions.append(backups);
      }
      const fileLine = document.createElement('div');
      fileLine.className = 'instance-content-file-line';
      fileLine.append(filename, detail);
      description.append(name, fileLine, versions);
      const actions = document.createElement('div');
      actions.className = 'instance-content-actions';
      if (kind === 'mods') {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.innerHTML = icon(entry.enabled ? 'toggle-on' : 'toggle-off');
        const toggleLabel = document.createElement('span');
        setUiText(toggleLabel, entry.enabled ? 'Desactivar' : 'Activar');
        toggle.append(document.createTextNode(' '), toggleLabel);
        toggle.setAttribute(
          'aria-label',
          `${entry.enabled ? 'Desactivar' : 'Activar'} ${entry.name}`,
        );
        toggle.addEventListener(
          'click',
          () =>
            void perform(async () => {
              await toggleModWithDependents(entry.name, entry.enabled, instance.id);
              return window.battly.getInstanceContent(instance.id, kind);
            }),
        );
        actions.append(toggle);
      }
      if (kind === 'saves') {
        const backup = document.createElement('button');
        backup.type = 'button';
        backup.innerHTML = `${icon('save')} Crear copia`;
        backup.setAttribute('aria-label', `Crear copia de ${entry.name}`);
        backup.addEventListener(
          'click',
          () =>
            void perform(
              () => window.battly.actInstanceContent(instance.id, kind, entry.name, 'backup'),
              'Comprimiendo el mundo…',
              'Copia creada. Puedes encontrar el ZIP en Ver copias.',
            ),
        );
        actions.append(backup);
      }
      const archive = document.createElement('button');
      archive.type = 'button';
      archive.innerHTML = `${icon('archive')} Archivar`;
      archive.setAttribute('aria-label', `Archivar ${entry.name}`);
      archive.addEventListener(
        'click',
        () =>
          void perform(() =>
            window.battly.actInstanceContent(instance.id, kind, entry.name, 'archive'),
          ),
      );
      actions.append(archive);
      row.append(thumbnail, description, actions);
      list.append(row);
    }
  }

  async function perform(
    operation: () => Promise<readonly InstanceContentEntry[] | void>,
    loading = 'Cargando contenido…',
    success?: string,
  ): Promise<void> {
    if (busy) {
      return;
    }
    const focused = document.activeElement;
    setBusy(true);
    status.dataset.state = 'loading';
    setUiText(status, loading);
    try {
      const result = await operation();
      if (!dialog.open) {
        return;
      }
      if (result) {
        entries = result;
      }
      render();
      status.dataset.state = 'ready';
      if (success) {
        setUiText(status, success);
      }
    } catch (error) {
      if (!dialog.open) {
        return;
      }
      status.dataset.state = 'error';
      setUiText(
        status,
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
          : 'No se pudo gestionar el contenido. Pulsa Actualizar para volver a intentarlo.',
      );
    } finally {
      setBusy(false);
      if (dialog.open && document.activeElement === document.body) {
        if (focused instanceof HTMLElement && focused.isConnected) {
          focused.focus();
        } else {
          search.focus();
        }
      }
    }
  }

  function select(next: InstanceContentKind): void {
    if (busy) {
      return;
    }
    positions.set(kind, { scroll: list.scrollTop, query: search.value });
    kind = next;
    entries = [];
    search.value = positions.get(kind)?.query ?? '';
    list.replaceChildren();
    nav
      .querySelectorAll('button')
      .forEach((button) =>
        button.setAttribute('aria-pressed', String(button.dataset.kind === kind)),
      );
    add.hidden = kind === 'saves';
    (dialog.querySelector('[data-backups]') as HTMLElement).hidden = kind !== 'saves';
    setUiText(
      help,
      kind === 'saves'
        ? 'Guarda una copia ZIP antes de experimentar. Para recuperarla, descomprímela en una carpeta nueva dentro de Mundos. Cierra el juego antes de crear copias.'
        : kind === 'mods'
          ? 'Activa o desactiva mods antes de iniciar Minecraft.'
          : 'Añade packs ZIP o abre la carpeta para copiar packs descomprimidos. Selecciónalos desde las opciones de Minecraft.',
    );
    void perform(() => window.battly.getInstanceContent(instance.id, kind)).then(() => {
      list.scrollTop = positions.get(kind)?.scroll ?? 0;
    });
  }
  for (const tabKind of instanceContentKinds) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.kind = tabKind;
    button.innerHTML = icon(icons[tabKind]);
    const label = document.createElement('span');
    setUiText(label, labels[tabKind]);
    button.append(document.createTextNode(' '), label);
    button.addEventListener('click', () => select(tabKind));
    nav.append(button);
  }
  add.addEventListener(
    'click',
    () => void perform(() => window.battly.importInstanceContent(instance.id, kind)),
  );
  dialog
    .querySelector('[data-refresh]')!
    .addEventListener(
      'click',
      () => void perform(() => window.battly.getInstanceContent(instance.id, kind)),
    );
  dialog
    .querySelector('[data-folder]')!
    .addEventListener(
      'click',
      () => void perform(() => window.battly.openInstanceContentFolder(instance.id, kind)),
    );
  dialog
    .querySelector('[data-archive-folder]')!
    .addEventListener(
      'click',
      () => void perform(() => window.battly.openInstanceContentFolder(instance.id, kind, true)),
    );
  search.addEventListener('input', render);
  dialog
    .querySelector('[data-backups]')!
    .addEventListener(
      'click',
      () =>
        void perform(() =>
          window.battly.openInstanceContentFolder(instance.id, 'saves', 'backups'),
        ),
    );
  dialog
    .querySelector('[data-export-bypack]')!
    .addEventListener('click', () => void openBypackFlow(instance));
  dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
  });
  document.body.append(dialog);
  dialog.showModal();
  select('mods');
}
