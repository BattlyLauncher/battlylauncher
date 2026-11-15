import {
  normalizeDisplay,
  normalizeDisplayOverrides,
  type DisplayPreferences,
  type DisplayOverrides,
} from '../../shared/settings/game-preferences';
import type { RuntimeSettings } from '../../shared/settings/settings-contract';

let root: HTMLElement;
let globalDisplay = normalizeDisplay(null);
let overrides: DisplayOverrides = {};
let scope = '';
const instanceVersions = new Map<string, string>();
function inherited(): DisplayPreferences {
  const version = instanceVersions.get(scope);
  return (version ? overrides[`version:${version}`] : undefined) ?? globalDisplay;
}
const input = <T extends HTMLInputElement | HTMLSelectElement>(selector: string) =>
  root.querySelector<T>(selector)!;
function flush(): void {
  const value = normalizeDisplay({
    width: input('[data-setting="windowWidth"]').value,
    height: input('[data-setting="windowHeight"]').value,
    fullscreen: input<HTMLInputElement>('[data-window-fullscreen]').checked,
  });
  if (!scope) {
    globalDisplay = value;
  } else if (input<HTMLInputElement>('[data-window-override]').checked) {
    overrides[scope] = value;
  } else {
    delete overrides[scope];
  }
}
function render(): void {
  const value = overrides[scope] ?? inherited();
  input('[data-setting="windowWidth"]').value = String(value.width);
  input('[data-setting="windowHeight"]').value = String(value.height);
  input<HTMLInputElement>('[data-window-fullscreen]').checked = value.fullscreen;
  input<HTMLInputElement>('[data-window-override]').checked = !!overrides[scope];
  input<HTMLInputElement>('[data-window-override]').disabled = !scope;
  root
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      '[data-display-control]',
    )
    .forEach((el) => {
      el.disabled = !!scope && !overrides[scope];
    });
  input('[data-window-ratio]').value = 'custom';
}
export function setDisplaySettings(value: RuntimeSettings): void {
  globalDisplay = normalizeDisplay({
    width: value.windowWidth,
    height: value.windowHeight,
    fullscreen: value.windowFullscreen,
  });
  overrides = normalizeDisplayOverrides(value.displayOverrides);
  if (root) {
    const select = input<HTMLSelectElement>('[data-window-scope]');
    for (const key of Object.keys(overrides)) {
      if (![...select.options].some((option) => option.value === key)) {
        select.add(new Option(key, key));
      }
    }
    render();
  }
}
export function readDisplaySettings(): Pick<
  RuntimeSettings,
  'windowWidth' | 'windowHeight' | 'windowFullscreen' | 'displayOverrides'
> {
  flush();
  return {
    windowWidth: globalDisplay.width,
    windowHeight: globalDisplay.height,
    windowFullscreen: globalDisplay.fullscreen,
    displayOverrides: overrides,
  };
}
export function mountDisplaySettings(section: HTMLElement): void {
  root = section;
  section.classList.add('minecraft-window-settings');
  section.innerHTML = /* HTML */ `<h3>Pantalla de Minecraft</h3>
    <p>
      Los ajustes de una instancia tienen prioridad sobre los de su versión. Sin personalización se
      usan los generales.
    </p>
    <label
      >Configurar<select data-window-scope>
        <option value="">Todas las versiones e instancias</option>
      </select></label
    >
    <div class="minecraft-window-fields">
      <label
        >Otra versión<input
          data-window-version
          placeholder="Ej. 1.21.1" /></label
      ><button
        type="button"
        data-window-version-add
      >
        Configurar versión
      </button>
    </div>
    <label
      ><input
        type="checkbox"
        data-window-override
      />
      Usar una configuración propia para esta selección</label
    >
    <div class="minecraft-window-fields">
      <label
        >Relación de aspecto<select
          data-window-ratio
          data-display-control
        >
          <option value="custom">Actual / personalizada</option>
          <option>16:9</option>
          <option>16:10</option>
          <option>4:3</option>
          <option>21:9</option>
          <option>1:1</option>
        </select></label
      >
      <label
        >Ancho (px)<input
          type="number"
          min="320"
          max="7680"
          step="1"
          data-setting="windowWidth"
          data-display-control
      /></label>
      <label
        >Alto (px)<input
          type="number"
          min="240"
          max="4320"
          step="1"
          data-setting="windowHeight"
          data-display-control
      /></label>
    </div>
    <label
      ><input
        type="checkbox"
        data-window-fullscreen
        data-display-control
      />
      Iniciar Minecraft en pantalla completa</label
    >
    <p>
      El tamaño se aplica al modo ventana. En pantalla completa, Minecraft usa el modo de vídeo del
      monitor. El overlay de Worlds se oculta en pantalla completa exclusiva.
    </p>
    <div class="minecraft-window-actions">
      <button
        type="button"
        data-window-preview
        data-display-control
      >
        Ajustar con una ventana</button
      ><button
        type="button"
        data-window-default
        data-display-control
      >
        Restablecer 1280 × 720
      </button>
    </div>
    <p
      data-window-size-status
      role="status"
    >
      Pulsa Guardar para aplicar los cambios.
    </p>`;
  const select = input<HTMLSelectElement>('[data-window-scope]');
  const add = (key: string, label: string) => {
    if (![...select.options].some((o) => o.value === key)) {
      select.add(new Option(label, key));
    }
  };
  const status = section.querySelector<HTMLElement>('[data-window-size-status]')!;
  void Promise.all([window.battly.getInstances(), window.battly.getPlayVersions()])
    .then(([instances, versions]) => {
      for (const instance of instances) {
        add(`instance:${instance.id}`, `Instancia · ${instance.name}`);
        instanceVersions.set(`instance:${instance.id}`, instance.version);
      }
      for (const version of versions.installed) {
        add(`version:${version.version}`, `Versión · ${version.version}`);
      }
      for (const key of Object.keys(overrides)) {
        add(key, key.replace('instance:', 'Instancia · ').replace('version:', 'Versión · '));
      }
    })
    .catch(() => {
      status.textContent = 'No se pudo cargar la lista. Puedes escribir una versión manualmente.';
    });
  select.onchange = () => {
    flush();
    scope = select.value;
    render();
  };
  input<HTMLInputElement>('[data-window-override]').onchange = (event) => {
    if ((event.target as HTMLInputElement).checked) {
      overrides[scope] = { ...inherited() };
    } else {
      delete overrides[scope];
    }
    render();
  };
  section.querySelector<HTMLButtonElement>('[data-window-version-add]')!.onclick = () => {
    const version = input('[data-window-version]').value.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(version)) {
      status.textContent = 'Escribe un identificador de versión válido.';
      return;
    }
    flush();
    scope = `version:${version}`;
    add(scope, `Versión · ${version}`);
    select.value = scope;
    render();
  };
  const ratio = (axis: 'width' | 'height') => {
    const width = input<HTMLInputElement>('[data-setting="windowWidth"]'),
      height = input<HTMLInputElement>('[data-setting="windowHeight"]');
    const [x = 0, y = 0] = input('[data-window-ratio]').value.split(':').map(Number);
    if (x > 0 && y > 0) {
      const r = x / y;
      const w = Math.min(
        7680,
        4320 * r,
        Math.max(320, 240 * r, axis === 'height' ? Number(height.value) * r : Number(width.value)),
      );
      width.value = String(Math.round(w));
      height.value = String(Math.round(w / r));
    }
    flush();
    const current: DisplayPreferences = scope ? (overrides[scope] ?? globalDisplay) : globalDisplay;
    width.value = String(current.width);
    height.value = String(current.height);
  };
  input('[data-setting="windowWidth"]').onchange = () => ratio('width');
  input('[data-setting="windowHeight"]').onchange = () => ratio('height');
  input('[data-window-ratio]').onchange = () => ratio('width');
  section.querySelector<HTMLButtonElement>('[data-window-default]')!.onclick = () => {
    if (scope) {
      overrides[scope] = normalizeDisplay(null);
    } else {
      globalDisplay = normalizeDisplay(null);
    }
    render();
  };
  section.querySelector<HTMLButtonElement>('[data-window-preview]')!.onclick = (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    flush();
    const selected = scope,
      current = overrides[scope] ?? globalDisplay;
    void window.battly
      .previewMinecraftWindow({
        windowWidth: current.width,
        windowHeight: current.height,
        persist: false,
      })
      .then(async (size) => {
        if (!size) {
          return;
        }
        const value = { ...current, ...size };
        if (selected) {
          overrides[selected] = value;
        } else {
          globalDisplay = value;
        }
        render();
        const settings = await window.battly.getSettings();
        await window.battly.saveSettings({
          ...settings,
          runtime: { ...settings.runtime, ...readDisplaySettings() },
        });
        status.textContent = `Tamaño guardado: ${size.width} × ${size.height} px`;
      })
      .catch(() => {
        status.textContent = 'No se pudo guardar el tamaño. Vuelve a intentarlo.';
      })
      .finally(() => {
        button.disabled = false;
      });
  };
  render();
}
