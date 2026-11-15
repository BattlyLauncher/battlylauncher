import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import type { InstalledPlayVersion } from '../../shared/minecraft/play-version-contract';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import { worldsIcon } from './worlds-icons';
import logo from '../assets/icon.png?url';

export function mountWorldsConnectionDialog(launch: (version: string) => void, leave: () => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'bw-connection-dialog';
  dialog.setAttribute('aria-labelledby', 'bw-connection-title');
  dialog.innerHTML = /* HTML */ `<header>
      <span><img alt="" />Battly <b>Worlds</b></span
      ><button
        data-close
        aria-label="Cerrar conexión"
      >
        ${worldsIcon('close')}
      </button>
    </header>
    <div class="bw-connection-content">
      <small data-caption>Tu próxima aventura</small>
      <h2
        id="bw-connection-title"
        data-title
      >
        Conectando con el mundo…
      </h2>
      <p
        data-detail
        role="status"
      >
        Estamos preparando una conexión segura con el anfitrión.
      </p>
      <ol
        class="bw-connection-route"
        aria-label="Conexión con el mundo"
      >
        <li
          data-route="device"
          data-state="done"
        >
          ${worldsIcon('computer')}
          <strong>Tu equipo</strong>
          <small data-route-status>Preparado</small>
        </li>
        <li
          class="bw-route-link"
          aria-hidden="true"
        >
          <i></i><i></i><i></i>
        </li>
        <li
          data-route="relay"
          data-state="active"
          aria-current="step"
        >
          ${worldsIcon('globe')}
          <strong>Battly Worlds</strong>
          <small data-route-status>Conectando</small>
        </li>
        <li
          class="bw-route-link"
          aria-hidden="true"
        >
          <i></i><i></i><i></i>
        </li>
        <li
          data-route="host"
          data-state="pending"
        >
          ${worldsIcon('room')}
          <strong>Mundo del anfitrión</strong>
          <small data-route-status>Esperando conexión</small>
        </li>
        <li
          class="bw-route-link"
          aria-hidden="true"
        >
          <i></i><i></i><i></i>
        </li>
        <li
          data-route="minecraft"
          data-state="pending"
        >
          ${worldsIcon('play')}
          <strong>Minecraft</strong>
          <small data-route-status>Esperando conexión</small>
        </li>
      </ol>
      <div class="bw-connection-version">
        ${worldsIcon('play')}<span data-version>Identificando la versión de Minecraft…</span>
      </div>
      <section
        class="bw-game-progress"
        data-game-progress
        hidden
        aria-label="Progreso de Minecraft"
      >
        <div>
          <strong data-game-status>Preparando Minecraft…</strong><span data-game-percent></span>
        </div>
        <progress
          data-game-progress-bar
          max="100"
          aria-label="Progreso de Minecraft"
        ></progress>
      </section>
      <p
        data-error
        role="alert"
        hidden
      ></p>
      <button
        class="bw-secondary"
        data-copy
        hidden
      >
        Copiar dirección para Minecraft abierto
      </button>
    </div>
    <footer>
      <small>Usa la misma versión y mods que el anfitrión.</small
      ><button data-leave>Cancelar conexión</button>
    </footer>`;
  dialog.querySelector('img')!.src = logo;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
    dialog.querySelector<T>(selector)!;
  let snapshot: WorldsSnapshot | undefined;
  let code = '',
    launched = false,
    failedLocally = false,
    opener: HTMLElement | null = null;
  let receivingProgress = false;
  let gameStarted = false;
  let serviceReady = false;
  let hostReady = false;
  let networkFailed = false;
  let minecraftReady = false;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  const updateRoute = () => {
    const states = {
      relay: serviceReady ? 'done' : networkFailed ? 'error' : 'active',
      host: hostReady ? 'done' : serviceReady ? (networkFailed ? 'error' : 'active') : 'pending',
      minecraft: minecraftReady
        ? 'done'
        : failedLocally && hostReady
          ? 'error'
          : receivingProgress
            ? 'active'
            : 'pending',
    };
    for (const [name, state] of Object.entries(states)) {
      const node = el(`[data-route="${name}"]`);
      node.dataset.state = state;
      if (state === 'active') {
        node.setAttribute('aria-current', 'step');
      } else {
        node.removeAttribute('aria-current');
      }
      node.querySelector<HTMLElement>('[data-route-status]')!.textContent =
        state === 'done'
          ? name === 'minecraft'
            ? 'Minecraft iniciado'
            : name === 'relay'
              ? 'Conectado'
              : 'Conexión disponible'
          : state === 'error'
            ? name === 'minecraft'
              ? 'No se pudo iniciar Minecraft'
              : 'No se pudo conectar'
            : state === 'active'
              ? name === 'minecraft'
                ? 'Preparando Minecraft…'
                : 'Conectando'
              : 'Esperando conexión';
      const link = node.previousElementSibling as HTMLElement | null;
      if (link?.classList.contains('bw-route-link')) {
        link.dataset.state = state;
      }
    }
  };
  const close = () => {
    clearTimeout(completionTimer);
    dialog.close();
  };
  el('[data-close]').onclick = close;
  dialog.addEventListener('cancel', () => clearTimeout(completionTimer));
  dialog.addEventListener('close', () => {
    if (opener?.isConnected) {
      opener.focus();
    }
  });
  el('[data-leave]').onclick = () => {
    if (minecraftReady || failedLocally || snapshot?.state === 'error') {
      close();
    } else {
      leave();
    }
  };
  el('[data-copy]').onclick = () => {
    if (snapshot?.address) {
      void navigator.clipboard
        .writeText(snapshot.address)
        .then(() => {
          el('[data-detail]').textContent =
            'Dirección copiada. En Minecraft: Multijugador → Conexión directa.';
        })
        .catch(() => {
          el('[data-error]').hidden = false;
          el('[data-error]').textContent = 'No se pudo copiar: ' + snapshot?.address;
        });
    }
  };
  function open(room: string) {
    if (code !== room || !dialog.open) {
      code = room;
      launched = false;
      failedLocally = false;
      receivingProgress = false;
      gameStarted = false;
      serviceReady = false;
      hostReady = false;
      networkFailed = false;
      minecraftReady = false;
      clearTimeout(completionTimer);
      el('[data-game-progress]').hidden = true;
      el('[data-error]').hidden = true;
      el('[data-copy]').hidden = true;
      dialog.dataset.state = 'connecting';
      updateRoute();
    }
    if (!dialog.open) {
      opener = document.activeElement as HTMLElement;
      dialog.showModal();
    }
  }
  return {
    open,
    close,
    fail(message: string) {
      clearTimeout(completionTimer);
      launched = false;
      failedLocally = true;
      receivingProgress = false;
      updateRoute();
      el<HTMLButtonElement>('[data-leave]').disabled = false;
      el('[data-leave]').textContent = 'Cerrar';
      dialog.dataset.state = 'error';
      el('[data-title]').textContent = 'No se pudo completar la conexión';
      el('[data-error]').textContent = message;
      el('[data-error]').hidden = false;
      el('[data-copy]').hidden = !snapshot?.address;
    },
    preparing(message = 'Preparando Minecraft…') {
      receivingProgress = true;
      updateRoute();
      el('[data-game-progress]').hidden = false;
      el('[data-title]').textContent = 'Preparando Minecraft…';
      el('[data-detail]').textContent = 'Minecraft se abrirá y entrará al mundo automáticamente.';
      el('[data-game-status]').textContent = message;
      el<HTMLProgressElement>('[data-game-progress-bar]').removeAttribute('value');
      el('[data-game-percent]').textContent = '';
    },
    progress(event: MinecraftLaunchEvent) {
      if (!receivingProgress || failedLocally) {
        return;
      }
      const bar = el<HTMLProgressElement>('[data-game-progress-bar]');
      if ((event.type === 'progress' || event.type === 'check') && !gameStarted) {
        if (Number.isFinite(event.total) && event.total > 0 && Number.isFinite(event.current)) {
          bar.value = Math.max(0, Math.min(100, (event.current / event.total) * 100));
          el('[data-game-percent]').textContent = `${Math.round(bar.value)}%`;
        } else {
          bar.removeAttribute('value');
          el('[data-game-percent]').textContent = '';
        }
        el('[data-game-status]').textContent =
          event.type === 'check' ? 'Comprobando archivos…' : 'Descargando archivos…';
      }
      if (event.type === 'phase' && !gameStarted) {
        bar.removeAttribute('value');
        el('[data-game-percent]').textContent = '';
        el('[data-game-status]').textContent = 'Preparando Minecraft…';
      }
      if (event.type === 'state' && event.state === 'running') {
        gameStarted = true;
        bar.removeAttribute('value');
        el('[data-game-percent]').textContent = '';
        el('[data-game-status]').textContent = 'Esperando a Minecraft…';
        el('[data-title]').textContent = 'Minecraft está iniciando…';
      }
      if (event.type === 'client-ready') {
        bar.value = 100;
        el('[data-game-percent]').textContent = '100%';
        receivingProgress = false;
        minecraftReady = true;
        updateRoute();
        el('[data-title]').textContent = 'Minecraft iniciado';
        el('[data-game-status]').textContent = 'Minecraft iniciado';
        el('[data-leave]').textContent = 'Cerrar';
        completionTimer = setTimeout(close, 1200);
      }
      if (event.type === 'exit' || (event.type === 'state' && event.state === 'exited')) {
        receivingProgress = false;
        close();
      }
      if (event.type === 'state' && event.state === 'failed') {
        this.fail('No se pudo iniciar Minecraft');
      }
    },
    update(next: WorldsSnapshot, _installed: readonly InstalledPlayVersion[], busy: boolean) {
      snapshot = next;
      if (!dialog.open || failedLocally) {
        return;
      }
      const ready = next.state === 'joined' && !!next.address;
      const failed = next.state === 'error';
      if (failed) {
        receivingProgress = false;
        clearTimeout(completionTimer);
      }
      dialog.dataset.state = failed ? 'error' : ready ? 'ready' : 'connecting';
      serviceReady =
        next.serviceReady === true || ['connecting', 'joined', 'hosting'].includes(next.state);
      hostReady = ready;
      networkFailed = failed;
      updateRoute();
      el('[data-version]').textContent =
        parseWorldsVersion(next.version)?.label ||
        next.version ||
        'Identificando la versión de Minecraft…';
      el('[data-copy]').hidden = true;
      el<HTMLButtonElement>('[data-leave]').disabled = busy && !receivingProgress;
      el('[data-leave]').textContent = failed ? 'Cerrar' : 'Cancelar conexión';
      if (next.state === 'idle' && !busy) {
        close();
        return;
      }
      if ((receivingProgress || minecraftReady) && !failed) {
        return;
      }
      el('[data-title]').textContent = failed
        ? 'No se pudo conectar al mundo'
        : 'Conectando con el mundo…';
      el('[data-detail]').textContent = failed
        ? next.message
        : 'Estableciendo la conexión con el anfitrión.';
      if (ready && !busy && !launched) {
        launched = true;
        this.preparing();
        launch(next.version);
      }
    },
  };
}
