import type { DownloadCatalogSnapshot } from '../../shared/minecraft/download-catalog-contract';
import './mod-version-filter.css';

export function mountModVersionFilter(
  panel: HTMLElement,
  load: () => Promise<DownloadCatalogSnapshot['minecraft']>,
  changed: () => void,
): void {
  const host = panel.querySelector<HTMLElement>('.b-mods-versions-container');
  if (!host) {
    return;
  }
  host.querySelectorAll('label').forEach((label) => label.remove());
  const picker = document.createElement('details');
  picker.className = 'mod-version-picker';
  picker.innerHTML = /* HTML */ `<summary>Todas las versiones</summary>
    <div class="mod-version-popover">
      <input
        type="search"
        placeholder="Buscar versión…"
        aria-label="Buscar versión del juego"
      />
      <p role="status">Cargando versiones…</p>
      <div
        class="mod-version-options"
        role="group"
        aria-label="Versiones del juego"
      ></div>
      <button
        type="button"
        data-retry
        hidden
      >
        Reintentar
      </button>
    </div>`;
  host.insertBefore(picker, host.querySelector('button'));
  const summary = picker.querySelector('summary')!;
  const query = picker.querySelector('input')!;
  const status = picker.querySelector('p')!;
  const options = picker.querySelector<HTMLElement>('.mod-version-options')!;
  const retry = picker.querySelector<HTMLButtonElement>('[data-retry]')!;
  let loading = false;
  let loaded = false;
  const update = (): void => {
    const selected = [...options.querySelectorAll<HTMLInputElement>('input:checked')].map(
      (input) => input.value,
    );
    summary.textContent = selected.length ? selected.join(', ') : 'Todas las versiones';
    summary.title = summary.textContent;
    let visible = 0;
    options.querySelectorAll('label').forEach((label) => {
      label.hidden = !label.textContent?.toLowerCase().includes(query.value.trim().toLowerCase());
      if (!label.hidden) {
        visible++;
      }
    });
    if (loaded) {
      status.textContent = `${visible} versiones · ${selected.length} seleccionadas`;
    }
  };
  const refresh = async (): Promise<void> => {
    if (loading || loaded) {
      return;
    }
    loading = true;
    retry.hidden = true;
    status.textContent = 'Cargando versiones…';
    try {
      const catalog = await load();
      const seen = new Set<string>();
      const fragment = document.createDocumentFragment();
      for (const version of catalog) {
        if (seen.has(version.id)) {
          continue;
        }
        seen.add(version.id);
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = version.id;
        checkbox.dataset.modGameVersion = '';
        checkbox.className = 'b-mods-version-checkbox';
        label.append(checkbox, document.createTextNode(version.id));
        label.title = `${version.id} · ${version.type}`;
        fragment.append(label);
      }
      if (!seen.size) {
        throw new Error('Catálogo vacío');
      }
      options.replaceChildren(fragment);
      loaded = true;
      update();
    } catch {
      status.textContent = 'No se pudieron cargar las versiones.';
      retry.hidden = false;
    } finally {
      loading = false;
    }
  };
  picker.addEventListener('toggle', () => {
    if (picker.open) {
      void refresh();
    }
  });
  // Warm just the Minecraft manifest; do not wait for launcher/hot-version services.
  void refresh();
  retry.addEventListener('click', () => void refresh());
  query.addEventListener('input', update);
  options.addEventListener('change', () => {
    update();
    changed();
  });
  panel.addEventListener('battly:mod-filters-reset', () => {
    query.value = '';
    update();
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      picker.open = false;
      summary.focus();
    }
  });
  panel.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !picker.contains(event.target)) {
      picker.open = false;
    }
  });
}
