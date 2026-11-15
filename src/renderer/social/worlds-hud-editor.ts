import type { WorldsOverlayPreferences } from '../../shared/social/worlds-overlay-preferences';
import { isMinimalWorldsOverlay } from '../../shared/social/worlds-overlay-preferences';

/** A bounded, keyboard-accessible preview; positions are relative to the game viewport. */
export function mountWorldsHudEditor(
  host: HTMLElement,
  change: (value: WorldsOverlayPreferences) => void,
  save: () => void,
) {
  host.innerHTML = /* HTML */ `<h3>Editor del HUD</h3>
    <p>Arrastra el HUD para moverlo. Usa la esquina para cambiar su tamaño. Se guarda al soltar.</p>
    <div class="hud-editor-stage">
      <div class="hud-editor-tile">
        <button
          type="button"
          class="hud-editor-move"
          aria-label="Mover HUD. Usa las flechas del teclado"
        >
          Battly <b>Worlds</b><small>Tu HUD</small></button
        ><button
          type="button"
          class="hud-editor-resize"
          aria-label="Redimensionar HUD. Usa las flechas del teclado"
        >
          ↘
        </button>
      </div>
    </div>
    <div class="hud-editor-fields">
      <label
        >Ancho<input
          name="hudWidth"
          type="number"
          min="220"
          max="520"
          step="10" /></label
      ><label
        >Alto<input
          name="hudHeight"
          type="number"
          min="80"
          max="600"
          step="10"
      /></label>
    </div>
    <label class="hud-switch"
      ><span>Vista mínima<small>Nombre, jugadores y conexión</small></span
      ><input
        name="hudMinimal"
        type="checkbox"
    /></label>
    <button
      type="button"
      class="bw-secondary"
      data-auto-size
    >
      Tamaño automático
    </button>`;
  host.addEventListener('input', (event) => event.stopPropagation());
  const tile = host.querySelector<HTMLElement>('.hud-editor-tile')!;
  const stage = host.querySelector<HTMLElement>('.hud-editor-stage')!;
  const width = host.querySelector<HTMLInputElement>('[name=hudWidth]')!;
  const height = host.querySelector<HTMLInputElement>('[name=hudHeight]')!;
  const minimal = host.querySelector<HTMLInputElement>('[name=hudMinimal]')!;
  let preferences: WorldsOverlayPreferences;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const x = () => preferences.offsetX ?? (preferences.position.endsWith('right') ? 1 : 0);
  const y = () => preferences.offsetY ?? (preferences.position.startsWith('bottom') ? 1 : 0);
  function draw() {
    if (!preferences) {
      return;
    }
    const w = Math.min(stage.clientWidth, preferences.width * 0.32);
    const h = Math.min(stage.clientHeight, (preferences.height || 200) * 0.32);
    Object.assign(tile.style, {
      width: `${w}px`,
      height: `${h}px`,
      left: `${x() * (stage.clientWidth - w)}px`,
      top: `${y() * (stage.clientHeight - h)}px`,
    });
    tile.dataset.minimal = String(isMinimalWorldsOverlay(preferences));
    width.value = String(preferences.width);
    height.value = String(preferences.height || 200);
    minimal.checked = preferences.minimal;
  }
  const update = (patch: Partial<WorldsOverlayPreferences>) => {
    preferences = { ...preferences, ...patch };
    draw();
    change(preferences);
  };
  for (const resize of [false, true]) {
    const button = host.querySelector<HTMLButtonElement>(
      resize ? '.hud-editor-resize' : '.hud-editor-move',
    )!;
    button.onpointerdown = (event) => {
      if (event.button !== 0 || !preferences) {
        return;
      }
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      const start = {
        x: event.clientX,
        y: event.clientY,
        left: tile.offsetLeft,
        top: tile.offsetTop,
        width: preferences.width,
        height: preferences.height || 200,
      };
      button.onpointermove = (e) => {
        if (!button.hasPointerCapture(e.pointerId)) {
          return;
        }
        const dx = e.clientX - start.x,
          dy = e.clientY - start.y;
        if (resize) {
          update({
            width: Math.round(clamp(start.width + dx / 0.32, 220, 520)),
            height: Math.round(clamp(start.height + dy / 0.32, 80, 600)),
          });
        } else {
          update({
            offsetX: clamp(
              (start.left + dx) / Math.max(1, stage.clientWidth - tile.offsetWidth),
              0,
              1,
            ),
            offsetY: clamp(
              (start.top + dy) / Math.max(1, stage.clientHeight - tile.offsetHeight),
              0,
              1,
            ),
          });
        }
      };
      button.onpointerup = button.onpointercancel = () => {
        button.onpointermove = null;
        if (button.hasPointerCapture(event.pointerId)) {
          button.releasePointerCapture(event.pointerId);
        }
        save();
      };
    };
    button.onkeydown = (event) => {
      if (
        !preferences ||
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (resize) {
        update({
          width: clamp(preferences.width + dx * 10, 220, 520),
          height: clamp((preferences.height || 200) + dy * 10, 80, 600),
        });
      } else {
        update({ offsetX: clamp(x() + dx * 0.025, 0, 1), offsetY: clamp(y() + dy * 0.025, 0, 1) });
      }
      save();
    };
  }
  for (const input of [width, height]) {
    input.onchange = (event) => {
      event.stopPropagation();
      if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
        return;
      }
      update(input === width ? { width: input.valueAsNumber } : { height: input.valueAsNumber });
      save();
    };
  }
  minimal.onchange = (event) => {
    event.stopPropagation();
    update({ minimal: minimal.checked });
    save();
  };
  host.querySelector<HTMLButtonElement>('[data-auto-size]')!.onclick = () => {
    update({ width: 300, height: 0, minimal: false });
    save();
  };
  const observer = new ResizeObserver(draw);
  observer.observe(stage);
  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  return {
    update(value: WorldsOverlayPreferences) {
      preferences = value;
      draw();
    },
  };
}
