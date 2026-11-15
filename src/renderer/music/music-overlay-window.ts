import type { MusicPlaybackState } from '../../shared/music/music-contract';
import {
  musicWidgetBounds,
  type MusicOverlaySnapshot,
  type MusicWidget,
} from '../../shared/music/music-overlay';
import battlyIconUrl from '../assets/icon.png?url';
import { startWindowLanguage } from '../i18n/window-language';
import { setUiText, translateUiText } from '../i18n/dialog-text';
import './music-overlay.css';

export function bindMusicOverlayWindow(): void {
  document.body.dataset.window = 'music-overlay';
  document.body.replaceChildren();
  document.body.innerHTML = /* HTML */ ` <div
      class="music-overlay-shade"
      data-overlay-backdrop
      hidden
    ></div>
    <div
      class="music-widget-layer"
      data-overlay-widgets
    ></div>
    <section
      class="music-overlay-manager"
      role="dialog"
      aria-label="Battly Music"
      hidden
    >
      <header>
        <div class="overlay-brand">
          <img
            alt="Battly"
            data-overlay-logo
          /><strong>Battly <span>Music</span></strong
          ><kbd>Ctrl + M</kbd>
        </div>
        <div class="overlay-actions">
          <button
            data-overlay-action="edit"
            title="Editar widgets"
          >
            <i class="fa-solid fa-table-cells-large"></i></button
          ><button
            data-overlay-action="maximize"
            title="Maximizar"
          >
            <i class="fa-regular fa-window-maximize"></i></button
          ><button
            data-overlay-action="close"
            title="Cerrar"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </header>
      <div class="music-overlay-body">
        <section class="overlay-player">
          <img
            class="overlay-cover"
            data-overlay-cover
            alt=""
          />
          <h2
            data-overlay-title
            data-i18n-dynamic
          ></h2>
          <p
            data-overlay-artist
            data-i18n-dynamic
          ></p>
          <input
            type="range"
            min="0"
            max="1"
            step="1"
            value="0"
            data-overlay-seek
            aria-label="Progreso de reproducción"
          />
          <div class="overlay-times">
            <span data-overlay-time>0:00</span><span data-overlay-duration>0:00</span>
          </div>
          <div class="overlay-transport">
            <button
              data-music-control="previous"
              title="Anterior"
            >
              <i class="fa-solid fa-backward-step"></i></button
            ><button
              data-music-control="play-pause"
              class="overlay-primary"
              title="Reproducir"
            >
              <i class="fa-solid fa-play"></i></button
            ><button
              data-music-control="next"
              title="Siguiente"
            >
              <i class="fa-solid fa-forward-step"></i>
            </button>
          </div>
          <label class="overlay-volume"
            ><i
              class="fa-solid fa-volume-high"
              aria-hidden="true"
            ></i
            ><span>Volumen</span
            ><input
              type="range"
              min="0"
              max="100"
              value="50"
              data-overlay-volume
          /></label>
        </section>
        <section class="overlay-queue">
          <h3>Cola de reproducción</h3>
          <div data-overlay-queue></div>
        </section>
        <section
          class="overlay-widget-editor"
          hidden
        >
          <h2>Widgets de música</h2>
          <p>Mueve los widgets o arrastra su esquina para cambiar el tamaño.</p>
          <div
            class="overlay-widget-list"
            data-widget-list
          ></div>
          <button
            class="overlay-add-widget"
            data-widget-add
          >
            <i
              class="fa-solid fa-plus"
              aria-hidden="true"
            ></i>
            Añadir widget
          </button>
          <form
            data-widget-form
            hidden
          >
            <label>Pantalla<select name="displayId"></select></label>
            <div class="overlay-widget-fields">
              <label
                >X<input
                  name="x"
                  type="number"
                  min="0"
                  step="1" /></label
              ><label
                >Y<input
                  name="y"
                  type="number"
                  min="0"
                  step="1" /></label
              ><label
                >Ancho<input
                  name="width"
                  type="number"
                  min="180"
                  max="720"
                  step="1" /></label
              ><label
                >Alto<input
                  name="height"
                  type="number"
                  min="72"
                  max="240"
                  step="1"
              /></label>
            </div>
            <button
              class="overlay-delete-widget"
              type="button"
              data-widget-delete
            >
              Eliminar widget
            </button>
          </form>
        </section>
      </div>
      <footer>
        <span data-overlay-hint>Escape para cerrar</span
        ><span
          class="overlay-error"
          data-overlay-error
          role="status"
        ></span>
      </footer>
    </section>`;
  document.querySelector<HTMLImageElement>('[data-overlay-logo]')!.src = battlyIconUrl;
  const manager = document.querySelector<HTMLElement>('.music-overlay-manager')!;
  const layer = document.querySelector<HTMLElement>('[data-overlay-widgets]')!;
  const form = document.querySelector<HTMLFormElement>('[data-widget-form]')!;
  let snapshot: MusicOverlaySnapshot | undefined;
  let widgetKey = '',
    queueKey = '',
    selectedWidget = '';
  let dragging = false;
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const error = (): void =>
    setUiText(
      document.querySelector<HTMLElement>('[data-overlay-error]')!,
      'No se pudieron guardar los cambios. Inténtalo de nuevo.',
    );
  const command = (type: 'open' | 'close' | 'edit' | 'maximize'): void => {
    void window.battly.musicOverlayCommand({ type }).catch(error);
  };
  const save = (widgets: readonly MusicWidget[]): void => {
    void window.battly.configureMusicOverlay({ widgets }).catch(error);
  };
  const time = (value = 0): string =>
    `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  const image = (target: HTMLImageElement, source?: string | null): void => {
    const value = source || battlyIconUrl;
    if (target.getAttribute('src') !== value) {
      target.src = value;
    }
    target.onerror = () => {
      target.onerror = null;
      target.src = battlyIconUrl;
    };
  };
  const renderPlayback = (state: MusicPlaybackState): void => {
    document.body.style.setProperty('--music-overlay-accent', state.overlay?.accent ?? '#7652ca');
    document.body.style.setProperty('--theme-color', state.overlay?.accent ?? '#7652ca');
    document.querySelectorAll<HTMLElement>('[data-overlay-title]').forEach((target) => {
      target.toggleAttribute('data-i18n-dynamic', !!state.title);
      if (state.title) {
        target.textContent = state.title;
      } else {
        setUiText(target, 'Nada reproduciéndose');
      }
    });
    document.querySelectorAll<HTMLElement>('[data-overlay-artist]').forEach((target) => {
      target.textContent = state.artist || 'Battly Music';
    });
    document
      .querySelectorAll<HTMLImageElement>('[data-overlay-cover]')
      .forEach((target) => image(target, state.thumbnailUrl));
    document.querySelectorAll<HTMLElement>('[data-widget-progress]').forEach((target) => {
      target.style.width = `${state.duration ? Math.min(100, ((state.currentTime || 0) / state.duration) * 100) : 0}%`;
    });
    const seek = document.querySelector<HTMLInputElement>('[data-overlay-seek]')!;
    seek.max = String(state.duration || 1);
    seek.disabled = !state.duration;
    if (document.activeElement !== seek) {
      seek.value = String(state.currentTime || 0);
    }
    document.querySelector('[data-overlay-time]')!.textContent = time(state.currentTime);
    document.querySelector('[data-overlay-duration]')!.textContent = time(state.duration);
    const play = document.querySelector<HTMLButtonElement>('[data-music-control="play-pause"]')!;
    play.disabled = !state.title;
    play.querySelector('i')!.className = `fa-solid ${state.playing ? 'fa-pause' : 'fa-play'}`;
    play.title = translateUiText(state.playing ? 'Pausar' : 'Reproducir');
    const volume = document.querySelector<HTMLInputElement>('[data-overlay-volume]')!;
    if (document.activeElement !== volume) {
      volume.value = String(state.overlay?.volume ?? 50);
    }
    const queue = state.overlay?.queue ?? [];
    const key = JSON.stringify([queue, state.overlay?.queueIndex]);
    if (queueKey !== key) {
      queueKey = key;
      const list = document.querySelector<HTMLElement>('[data-overlay-queue]')!;
      list.replaceChildren(
        ...queue.map((song) => {
          const button = document.createElement('button');
          button.className = 'overlay-queue-song';
          button.classList.toggle('is-current', song.index === state.overlay?.queueIndex);
          const title = document.createElement('strong'),
            artist = document.createElement('small');
          title.dataset.i18nDynamic = artist.dataset.i18nDynamic = '';
          title.textContent = song.title;
          artist.textContent = song.artist;
          button.append(title, artist);
          button.addEventListener(
            'click',
            () =>
              void window.battly
                .musicOverlayCommand({ type: 'queue', index: song.index })
                .catch(error),
          );
          return button;
        }),
      );
      if (!queue.length) {
        setUiText(list, 'No hay canciones en la cola');
      }
    }
  };
  const editForm = (): void => {
    const widget = snapshot?.preferences.widgets.find((widget) => widget.id === selectedWidget);
    form.hidden = !widget;
    if (!widget || !snapshot) {
      return;
    }
    const display =
      snapshot.displays.find((display) => display.id === widget.displayId) ?? snapshot.displays[0];
    if (!display) {
      return;
    }
    const select = field('displayId') as HTMLSelectElement;
    select.replaceChildren(
      ...snapshot.displays.map(
        (display) => new Option(display.name, display.id, false, display.id === widget.displayId),
      ),
    );
    const bounds = musicWidgetBounds(widget, display.width, display.height);
    for (const name of ['x', 'y', 'width', 'height'] as const) {
      field(name).value = String(bounds[name]);
    }
  };
  const renderWidgets = (): void => {
    if (!snapshot || dragging) {
      return;
    }
    const value = snapshot;
    const key = JSON.stringify([
      value.preferences,
      value.displays,
      value.displayId,
      value.editing,
      selectedWidget,
    ]);
    if (key === widgetKey) {
      return;
    }
    widgetKey = key;
    layer.replaceChildren();
    for (const widget of value.preferences.widgets.filter(
      (widget) => widget.displayId === value.displayId,
    )) {
      const bounds = musicWidgetBounds(widget, innerWidth, innerHeight);
      const card = document.createElement('article');
      card.className = 'music-song-widget';
      card.classList.toggle('is-editable', value.editing);
      card.classList.toggle('is-selected', widget.id === selectedWidget);
      Object.assign(card.style, {
        left: `${bounds.x}px`,
        top: `${bounds.y}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      });
      card.innerHTML = `<img data-overlay-cover alt=""/><div class="widget-song-copy"><strong data-overlay-title data-i18n-dynamic></strong><small data-overlay-artist data-i18n-dynamic></small><div class="widget-track"><span data-widget-progress></span></div></div><button class="widget-resize" aria-label="Cambiar tamaño" ${value.editing ? '' : 'hidden'}><i class="fa-solid fa-up-right-and-down-left-from-center"></i></button>`;
      card.addEventListener('pointerdown', (event) => {
        if (!snapshot?.editing || event.button !== 0) {
          return;
        }
        selectedWidget = widget.id;
        editForm();
        const resize = (event.target as Element).closest('.widget-resize');
        const startX = event.clientX,
          startY = event.clientY;
        const rect = { ...bounds };
        dragging = true;
        card.setPointerCapture(event.pointerId);
        const move = (event: PointerEvent): void => {
          if (resize) {
            rect.width = Math.max(
              180,
              Math.min(720, innerWidth - rect.x, bounds.width + event.clientX - startX),
            );
            rect.height = Math.max(
              72,
              Math.min(240, innerHeight - rect.y, bounds.height + event.clientY - startY),
            );
          } else {
            rect.x = Math.max(
              0,
              Math.min(innerWidth - rect.width, bounds.x + event.clientX - startX),
            );
            rect.y = Math.max(
              0,
              Math.min(innerHeight - rect.height, bounds.y + event.clientY - startY),
            );
          }
          Object.assign(card.style, {
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
        };
        const end = (): void => {
          dragging = false;
          card.removeEventListener('pointermove', move);
          card.removeEventListener('pointerup', end);
          card.removeEventListener('pointercancel', end);
          window.removeEventListener('blur', end);
          save(
            snapshot!.preferences.widgets.map((item) =>
              item.id === widget.id
                ? {
                    ...item,
                    width: rect.width,
                    height: rect.height,
                    x: rect.x / Math.max(1, innerWidth - rect.width),
                    y: rect.y / Math.max(1, innerHeight - rect.height),
                  }
                : item,
            ),
          );
        };
        card.addEventListener('pointermove', move);
        card.addEventListener('pointerup', end);
        card.addEventListener('pointercancel', end);
        window.addEventListener('blur', end, { once: true });
      });
      layer.append(card);
    }
    const list = document.querySelector<HTMLElement>('[data-widget-list]')!;
    list.replaceChildren(
      ...value.preferences.widgets.map((widget, index) => {
        const button = document.createElement('button');
        button.textContent = `Widget ${index + 1}`;
        button.classList.toggle('is-current', widget.id === selectedWidget);
        button.addEventListener('click', () => {
          selectedWidget = widget.id;
          widgetKey = '';
          renderWidgets();
          renderPlayback(value.playback);
        });
        return button;
      }),
    );
    document.querySelector<HTMLButtonElement>('[data-widget-add]')!.disabled =
      value.preferences.widgets.length >= 8;
    editForm();
  };
  const render = (value: MusicOverlaySnapshot): void => {
    snapshot = value;
    manager.hidden = !value.open;
    document.querySelector<HTMLElement>('[data-overlay-backdrop]')!.hidden =
      !value.open || value.editing;
    manager.classList.toggle('is-maximized', value.maximized);
    manager.classList.toggle('is-editing', value.editing);
    manager.querySelector<HTMLElement>('.overlay-widget-editor')!.hidden = !value.editing;
    layer.hidden = !value.playback.title && !value.editing;
    if (!selectedWidget && value.preferences.widgets.length) {
      selectedWidget = value.preferences.widgets[0].id;
    }
    renderWidgets();
    renderPlayback(value.playback);
    setUiText(
      document.querySelector<HTMLElement>('[data-overlay-hint]')!,
      value.shortcutAvailable ? 'Escape para cerrar' : 'Atajo no disponible',
    );
  };
  manager
    .querySelectorAll<HTMLElement>('[data-overlay-action]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        command(button.dataset.overlayAction as 'close' | 'edit' | 'maximize'),
      ),
    );
  document
    .querySelector('[data-overlay-backdrop]')
    ?.addEventListener('click', () => command('close'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      command('close');
    }
  });
  manager
    .querySelectorAll<HTMLElement>('[data-music-control]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () =>
          void window.battly
            .sendMusicControl(button.dataset.musicControl as 'next' | 'previous' | 'play-pause')
            .catch(error),
      ),
    );
  document.querySelector<HTMLInputElement>('[data-overlay-seek]')!.addEventListener(
    'change',
    (event) =>
      void window.battly
        .musicOverlayCommand({
          type: 'seek',
          value: Number((event.currentTarget as HTMLInputElement).value),
        })
        .catch(error),
  );
  document.querySelector<HTMLInputElement>('[data-overlay-volume]')!.addEventListener(
    'change',
    (event) =>
      void window.battly
        .musicOverlayCommand({
          type: 'volume',
          value: Number((event.currentTarget as HTMLInputElement).value),
        })
        .catch(error),
  );
  document.querySelector('[data-widget-add]')!.addEventListener('click', () => {
    if (!snapshot || snapshot.preferences.widgets.length >= 8) {
      return;
    }
    selectedWidget = crypto.randomUUID();
    save([
      ...snapshot.preferences.widgets,
      {
        id: selectedWidget,
        displayId: snapshot.displayId || snapshot.displays[0].id,
        x: 1,
        y: 1,
        width: 340,
        height: 100,
      },
    ]);
    if (!snapshot.editing) {
      command('edit');
    }
  });
  document.querySelector('[data-widget-delete]')!.addEventListener('click', () => {
    if (snapshot) {
      save(snapshot.preferences.widgets.filter((widget) => widget.id !== selectedWidget));
    }
    selectedWidget = '';
  });
  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', () => {
    if (!snapshot || !form.checkValidity()) {
      return;
    }
    const current = snapshot.preferences.widgets.find((widget) => widget.id === selectedWidget);
    const display = snapshot.displays.find((display) => display.id === field('displayId').value);
    if (!current || !display) {
      return;
    }
    const width = Math.min(display.width, Number(field('width').value)),
      height = Math.min(display.height, Number(field('height').value));
    const x = Math.min(1, Number(field('x').value) / Math.max(1, display.width - width)),
      y = Math.min(1, Number(field('y').value) / Math.max(1, display.height - height));
    save(
      snapshot.preferences.widgets.map((widget) =>
        widget.id === current.id
          ? { ...widget, displayId: display.id, width, height, x, y }
          : widget,
      ),
    );
  });
  const dispose = window.battly.onMusicOverlayChanged(render);
  window.addEventListener('beforeunload', dispose, { once: true });
  void window.battly.getMusicOverlay().then(render).catch(error);
  startWindowLanguage(async () => (await window.battly.getSettings()).visual.language);
}
