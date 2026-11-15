import type { LaunchLogFile } from '../../shared/desktop-api';
import { setUiText } from '../i18n/dialog-text';

export function mountSettingsLogReader(options: {
  format: (value: string) => string;
  render: (target: HTMLElement, value: string) => void;
  locale: () => string;
}): void {
  const select = document.querySelector<HTMLSelectElement>('[data-settings-log-select]');
  const content = document.querySelector<HTMLElement>('[data-settings-log-content]');
  const status = document.querySelector<HTMLElement>('[data-settings-log-status]');
  if (!select || !content || !status || select.dataset.readerBound) {
    return;
  }
  select.dataset.readerBound = 'true';
  const group = select.closest<HTMLElement>('[data-settings-group]');
  const filters = document.createElement('div');
  filters.className = 'settings-log-filters';
  filters.innerHTML = /* HTML */ `
    <label
      >Buscar<input
        type="search"
        data-log-query
    /></label>
    <label>Versión<select data-log-version></select></label>
    <label
      >Desde<input
        type="date"
        data-log-from
    /></label>
    <label
      >Hasta<input
        type="date"
        data-log-to
    /></label>
    <label
      >Ordenar<select data-log-sort>
        <option value="newest">Más recientes</option>
        <option value="oldest">Más antiguos</option>
      </select></label
    >
    <label class="settings-log-follow"
      ><input
        type="checkbox"
        checked
        data-log-follow
      />Seguir el último registro</label
    >
  `;
  select.closest('.battly-log-reader-toolbar')?.before(filters);
  const query = filters.querySelector<HTMLInputElement>('[data-log-query]')!;
  const version = filters.querySelector<HTMLSelectElement>('[data-log-version]')!;
  const from = filters.querySelector<HTMLInputElement>('[data-log-from]')!;
  const to = filters.querySelector<HTMLInputElement>('[data-log-to]')!;
  const sort = filters.querySelector<HTMLSelectElement>('[data-log-sort]')!;
  const follow = filters.querySelector<HTMLInputElement>('[data-log-follow]')!;
  let logs: readonly LaunchLogFile[] = [];
  let listed = false;
  let busy = false;
  let readRevision = 0;
  let lastRead = '';
  const active = (): boolean =>
    !document.hidden && document.body.dataset.panel === 'settings' && !group?.hidden;
  const day = (file: LaunchLogFile): string => {
    const date = new Date(file.startedAt ?? file.modifiedAt);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const readSelected = async (force = false): Promise<void> => {
    const revision = ++readRevision;
    const file = logs.find((file) => file.id === select.value);
    if (!file) {
      content.textContent = '';
      setUiText(status, 'No hay registros de Minecraft guardados.');
      lastRead = '';
      return;
    }
    const key = `${file.id}:${file.modifiedAt}:${file.size}`;
    if (!force && lastRead === key) {
      return;
    }
    const scroll = content.scrollTop;
    const atBottom = content.scrollHeight - content.clientHeight - scroll < 40;
    if (force) {
      setUiText(status, 'Leyendo registro…');
    }
    try {
      const log = await window.battly.readLaunchLog(file.id);
      if (revision !== readRevision || select.value !== file.id) {
        return;
      }
      const formatted = options.format(log.content);
      const visible = formatted
        .split('\n')
        .slice(-2000)
        .join('\n')
        .slice(-256 * 1024);
      options.render(content, visible);
      status.textContent = `${log.version ?? file.version ?? 'Minecraft'} · ${new Date(log.modifiedAt).toLocaleString(options.locale())} · ${(log.size / 1024).toFixed(1)} KB${log.truncated || visible.length < formatted.length ? ' · mostrando el tramo más reciente' : ''}`;
      content.scrollTop = follow.checked || atBottom ? content.scrollHeight : scroll;
      lastRead = key;
    } catch {
      if (revision !== readRevision) {
        return;
      }
      setUiText(status, 'No se pudo leer este registro.');
    }
  };
  const redraw = async (force = false): Promise<void> => {
    const previous = select.value;
    const term = query.value.trim().toLowerCase();
    const matching = logs
      .filter(
        (file) =>
          (!term ||
            `${file.version ?? ''} ${file.instanceId ?? ''} ${file.name}`
              .toLowerCase()
              .includes(term)) &&
          (!version.value || file.version === version.value) &&
          (!from.value || day(file) >= from.value) &&
          (!to.value || day(file) <= to.value),
      )
      .sort(
        (a, b) =>
          (sort.value === 'oldest' ? 1 : -1) *
          ((a.startedAt ?? a.modifiedAt) - (b.startedAt ?? b.modifiedAt)),
      );
    select.replaceChildren(
      ...matching.map((file) => {
        const option = document.createElement('option');
        option.value = file.id;
        option.textContent = `${file.version ?? file.instanceId ?? 'Minecraft'} · ${new Date(file.startedAt ?? file.modifiedAt).toLocaleString(options.locale())}`;
        option.title = file.name;
        return option;
      }),
    );
    if (follow.checked && matching.length) {
      select.value = matching.reduce((newest, file) =>
        file.modifiedAt > newest.modifiedAt ? file : newest,
      ).id;
    } else if (matching.some((file) => file.id === previous)) {
      select.value = previous;
    }
    await readSelected(force);
  };
  const refresh = async (force = false): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    if (!listed) {
      setUiText(status, 'Buscando registros…');
    }
    try {
      logs = await window.battly.listLaunchLogs();
      listed = true;
      const selected = version.value;
      const all = document.createElement('option');
      all.value = '';
      setUiText(all, 'Todas las versiones');
      const versions = [
        ...new Set(logs.flatMap((file) => (file.version ? [file.version] : []))),
      ].sort();
      version.replaceChildren(all, ...versions.map((name) => new Option(name, name)));
      if (versions.includes(selected)) {
        version.value = selected;
      }
      await redraw(force);
    } catch {
      setUiText(status, 'No se pudieron cargar los registros.');
    } finally {
      busy = false;
    }
  };
  select.addEventListener('change', () => {
    follow.checked = false;
    void readSelected(true);
  });
  filters.addEventListener('input', () => {
    void redraw();
  });
  document.querySelector('[data-settings-log-refresh]')?.addEventListener('click', () => {
    void refresh(true);
  });
  document.querySelector('[data-settings-log-folder]')?.addEventListener('click', () => {
    void window.battly.openLaunchLogs();
  });
  group?.addEventListener('battly:settings-subsection-enter', () => {
    void refresh();
  });
  window.addEventListener('focus', () => {
    if (active()) {
      void refresh();
    }
  });
  const timer = window.setInterval(() => {
    if (active()) {
      void refresh();
    }
  }, 4000);
  window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });
  if (active()) {
    void refresh();
  }
}
