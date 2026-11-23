import { formatPlayVersion } from '../../shared/minecraft/play-version-presentation';
import { worldsPreferences } from './worlds-preferences';
import { prepareWorldsPlayRequest } from './worlds-launch';
import { mountWorldsConnectionDialog } from './worlds-connection-dialog';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import { mountWorldsCatalog } from './worlds-catalog';
import type {
  InstalledPlayVersion,
  PlayVersionLaunchRequest,
} from '../../shared/minecraft/play-version-contract';
import type { WorldsAction, WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import logo from '../assets/icon.png?url';
import worldsScene from '../assets/instance-banners/vanilla.png?url';
import { setUserText } from '../i18n/ui-translator';
import './battly-worlds.css';
import './battly-worlds-panel.css';
import { worldsIcon } from './worlds-icons';
import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';

export function bindBattlyWorlds(
  launch: (
    request: PlayVersionLaunchRequest,
    label: string,
    progress: (event: MinecraftLaunchEvent) => void,
  ) => void,
): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'bw-dialog';
  dialog.dataset.view = 'public';
  dialog.setAttribute('aria-labelledby', 'bw-title');
  dialog.innerHTML = /* HTML */ ` <header class="bw-header">
      <div class="bw-brand">
        <img alt="" /><span>Battly <strong>Worlds</strong></span>
      </div>
      <div class="bw-header-actions">
        <span
          class="bw-account"
          data-account
          >Tu cuenta de Battly</span
        ><button
          class="bw-icon"
          data-close
          aria-label="Cerrar Battly Worlds"
        >
          ✕
        </button>
      </div>
    </header>
    <div class="bw-body">
      <section class="bw-hero">
        <h1 id="bw-title">La aventura es mejor con tus amigos.</h1>
        <p>Comparte tu mundo de Minecraft entre Battly para Windows, Linux y Android.</p>
      </section>
      <div
        class="bw-notice"
        data-notice
        role="status"
        hidden
      ></div>
      <div class="bw-layout">
        <section
          class="bw-main"
          aria-label="Jugar en compañía"
        >
          <div
            class="bw-tabs"
            role="tablist"
            aria-label="Modo de conexión"
          >
            <button
              role="tab"
              aria-selected="true"
              aria-controls="bw-public"
              id="bw-public-tab"
              data-tab="public"
            >
              ${worldsIcon('globe')}<span>Salas públicas</span>
            </button>
            <button
              role="tab"
              aria-selected="false"
              aria-controls="bw-join"
              id="bw-join-tab"
              data-tab="join"
              tabindex="-1"
            >
              ${worldsIcon('play')}<span>Unirse a sala</span>
            </button>
            <button
              role="tab"
              aria-selected="false"
              aria-controls="bw-host"
              id="bw-host-tab"
              data-tab="host"
              tabindex="-1"
            >
              ${worldsIcon('room')}<span>Cómo compartir</span>
            </button>
            <button
              role="tab"
              aria-selected="false"
              aria-controls="bw-invites-panel"
              id="bw-invites-tab"
              data-tab="invites"
              tabindex="-1"
            >
              ${worldsIcon('invite')}<span>Invitaciones <span data-invite-count>0</span></span>
            </button>
          </div>
          <div class="bw-stage">
            <section
              id="bw-host"
              role="tabpanel"
              aria-labelledby="bw-host-tab"
              data-host
            >
              <div class="bw-stage-heading">
                <span class="bw-stage-icon">${worldsIcon('room')}</span>
                <div>
                  <h2>Tu aventura empieza en Minecraft.</h2>
                  <p>Crea la sala desde tu mundo y comparte el código con tus amigos.</p>
                </div>
              </div>
              <ol class="bw-host-steps">
                <li>
                  <div
                    class="bw-step-scene"
                    aria-hidden="true"
                  >
                    <img
                      src="${worldsScene}"
                      alt=""
                    />${worldsIcon('play')}
                  </div>
                  <strong>Entra en tu mundo</strong><span>Abre Minecraft desde Jugar.</span>
                </li>
                <li>
                  <div
                    class="bw-step-scene"
                    aria-hidden="true"
                  >
                    <img
                      src="${worldsScene}"
                      alt=""
                    />${worldsIcon('globe')}
                  </div>
                  <strong>Ábrelo en LAN</strong><span>Esc → Abrir en LAN → Iniciar mundo LAN.</span>
                </li>
                <li>
                  <div
                    class="bw-step-scene"
                    aria-hidden="true"
                  >
                    <img
                      src="${worldsScene}"
                      alt=""
                    />${worldsIcon('invite')}
                  </div>
                  <strong>Comparte desde el overlay</strong
                  ><span>Abre Battly Worlds en Minecraft, crea la sala e invita a tus amigos.</span>
                </li>
              </ol>
              <button
                class="bw-primary"
                data-open-game-panel
                hidden
              >
                Abrir panel de Minecraft
              </button>
            </section>
            <form
              id="bw-join"
              role="tabpanel"
              aria-labelledby="bw-join-tab"
              data-join
              hidden
            >
              <div
                class="bw-join-art"
                aria-hidden="true"
              >
                <img
                  src="${worldsScene}"
                  alt=""
                /><span>${worldsIcon('globe')}</span>
              </div>
              <div class="bw-join-fields">
                <div class="bw-stage-heading">
                  <div>
                    <h2>¿Tienes un código?</h2>
                    <p>Escríbelo y únete al mundo de tus amigos.</p>
                  </div>
                </div>
                <label
                  >Código de la sala<input
                    name="code"
                    class="bw-code-input"
                    maxlength="6"
                    minlength="6"
                    pattern="[a-zA-Z0-9]{6}"
                    placeholder="ABC123"
                    autocomplete="off"
                    spellcheck="false"
                    required
                /></label>
                <button
                  class="bw-primary"
                  type="submit"
                >
                  ${worldsIcon('play')} Unirme a la aventura <span aria-hidden="true">→</span>
                </button>
                <p class="bw-hint">
                  Pídeselo al anfitrión o acepta una invitación en la pestaña Invitaciones.
                </p>
              </div>
            </form>
            <section
              id="bw-public"
              role="tabpanel"
              aria-labelledby="bw-public-tab"
              hidden
            ></section>
            <section
              class="bw-session"
              data-session
              hidden
            >
              <div class="bw-status"><span class="bw-dot"></span><strong data-status></strong></div>
              <p data-instructions></p>
              <div
                class="bw-room-code"
                data-code-box
                hidden
              >
                <div><small data-code-label>CÓDIGO DE SALA</small><strong data-code></strong></div>
                <button
                  class="bw-secondary"
                  data-copy
                >
                  ${worldsIcon('copy')} Copiar
                </button>
              </div>
              <p
                class="bw-hint"
                data-room-version
              ></p>
              <div
                class="bw-members"
                data-members
              ></div>
              <button
                class="bw-secondary bw-leave"
                data-leave
              >
                ${worldsIcon('leave')} Salir de la sala
              </button>
            </section>
            <button
              class="bw-primary"
              data-connection-open
              hidden
            >
              Abrir conexión e iniciar Minecraft
            </button>
            <section
              id="bw-invites-panel"
              role="tabpanel"
              aria-labelledby="bw-invites-tab"
              hidden
            >
              <div data-invites></div>
            </section>
          </div>
        </section>
      </div>
    </div>`;
  dialog.querySelector('img')!.src = logo;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(selector: string): T =>
    dialog.querySelector<T>(selector)!;
  void window.battly
    .getAppInfo()
    .then((info) => {
      el('[data-open-game-panel]').hidden = info.platform !== 'linux';
    })
    .catch(() => undefined);
  el('[data-open-game-panel]').onclick = () => {
    void window.battly.openWorldsGamePanel().catch((error: unknown) => {
      const notice = el('[data-notice]');
      notice.textContent = error instanceof Error ? error.message : 'No se pudo abrir el panel.';
      notice.hidden = false;
    });
  };
  const host = el('[data-host]');
  const join = el<HTMLFormElement>('[data-join]');
  const code = join.elements.namedItem('code') as HTMLInputElement;
  join.before(el('#bw-public'));
  host.hidden = true;
  el('#bw-public').hidden = false;
  const extras = mountWorldsCatalog(el('#bw-public'), window.battly, (code) =>
    act({ type: 'join', code }),
  );
  let snapshot: WorldsSnapshot | undefined;
  let instances: readonly InstalledPlayVersion[] = [];
  let busy = false;
  let launchPending = false;
  let launchAttempt = 0;
  let refreshing = false;
  let generation = 0;
  let renderedLists = '';
  let catalogAccount = '';
  let lastRefresh = 0;
  const seenInvites = new Set<string>();
  let invitationTimer: ReturnType<typeof setTimeout> | undefined;
  const hideInvitation = (): void => {
    clearTimeout(invitationTimer);
    invitation.hidden = true;
  };
  const connection = mountWorldsConnectionDialog(
    (raw) => {
      void launchVersion(raw);
    },
    () => {
      void cancelConnection();
    },
  );
  async function cancelConnection(): Promise<void> {
    launchAttempt++;
    if (launchPending) {
      try {
        await window.battly.cancelLaunch();
      } catch (error) {
        connection.fail(readable(error));
        return;
      }
    }
    launchPending = false;
    busy = false;
    await act({ type: 'leave' });
  }
  const invitation = document.createElement('button');
  invitation.className = 'bw-invitation-toast';
  invitation.type = 'button';
  invitation.dataset.worldsOpen = '';
  invitation.hidden = true;
  document.body.append(invitation);

  const notice = (text: string): void => {
    el('[data-notice]').textContent = text;
    el('[data-notice]').hidden = !text;
  };
  const readable = (error: unknown): string =>
    error instanceof Error
      ? error.message
          .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
          .slice(0, 300)
      : 'No se pudo completar la operación. Vuelve a intentarlo.';
  const selectTab = (tab: string): void => {
    dialog.dataset.view = tab;
    host.hidden = tab !== 'host' || (!!snapshot && !['idle', 'error'].includes(snapshot.state));
    join.hidden = tab !== 'join';
    el('#bw-public').hidden = tab !== 'public';
    el('#bw-invites-panel').hidden = tab !== 'invites';
    if (tab === 'public' && el('#bw-public').dataset.loaded !== 'true') {
      el('#bw-public').dataset.loaded = 'true';
      void extras.loadRooms();
    }
    dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };

  function render(): void {
    if (!snapshot) {
      return;
    }
    if (catalogAccount !== snapshot.username) {
      catalogAccount = snapshot.username;
      el('#bw-public').dataset.loaded = '';
    }
    extras.update(snapshot);
    const target = parseWorldsVersion(snapshot.version);
    connection.update(snapshot, instances, busy);
    el('[data-connection-open]').hidden = snapshot.state !== 'joined';
    const active = !['idle', 'error'].includes(snapshot.state);
    el('[data-account]').textContent = snapshot.username;
    el('[data-session]').hidden =
      !active || ['starting', 'connecting', 'joined'].includes(snapshot.state);
    selectTab(
      dialog.querySelector<HTMLElement>('[data-tab][aria-selected="true"]')?.dataset.tab ||
        'public',
    );
    const labels: Record<string, [string, string]> = {
      starting: ['Preparando BattlyWorlds', 'Estamos preparando la conexión.'],
      scanning: [
        'Esperando tu mundo en LAN',
        'Entra en tu mundo de Minecraft y selecciona Esc → Abrir en LAN → Iniciar mundo LAN. El código aparecerá automáticamente.',
      ],
      connecting: [
        'Conectando la sala',
        'Mantén Battly abierto mientras establecemos la conexión.',
      ],
      hosting: [
        'Tu mundo está listo',
        'Comparte el código o invita a un amigo. Mantén el mundo abierto en LAN y Battly en ejecución.',
      ],
      joined: [
        'Ya estás conectado',
        'Abre Multijugador → Conexión directa en Minecraft e introduce esta dirección, o inicia Minecraft desde aquí.',
      ],
    };
    const status = labels[snapshot.state];
    el('[data-status]').textContent = status?.[0] || '';
    el('[data-instructions]').textContent = status?.[1] || '';
    el('[data-code-box]').hidden = !snapshot.code;
    el('[data-code-label]').textContent =
      snapshot.state === 'joined' ? 'DIRECCIÓN EN MINECRAFT' : 'CÓDIGO DE SALA';
    el('[data-code]').textContent = snapshot.address || snapshot.code;
    el('[data-room-version]').textContent = snapshot.version
      ? `Versión del mundo: ${target?.label || snapshot.version}`
      : '';
    el('[data-members]').textContent = snapshot.members.length
      ? `En la sala: ${snapshot.members.join(', ')}`
      : '';
    el<HTMLButtonElement>('[data-leave]').disabled = busy;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>(
      '#bw-host button, #bw-join button, [data-invite], [data-accept], [data-dismiss]',
    )) {
      button.disabled = busy || active;
    }
    el('[data-invite-count]').textContent = String(snapshot.invites.length);
    for (const badge of document.querySelectorAll<HTMLElement>('[data-worlds-count]')) {
      badge.textContent = String(snapshot.invites.length);
      badge.hidden = !snapshot.invites.length;
    }
    const lists = JSON.stringify([snapshot.invites, snapshot.inviteError, snapshot.state, busy]);
    if (lists === renderedLists) {
      return;
    }
    renderedLists = lists;
    const invites = el('[data-invites]');
    invites.replaceChildren();
    const text = (parent: HTMLElement, tag: string, content: string): HTMLElement => {
      const item = document.createElement(tag);
      item.textContent = content;
      parent.append(item);
      return item;
    };
    if (snapshot.inviteError) {
      text(invites, 'p', snapshot.inviteError).className = 'bw-hint';
    }
    if (!snapshot.invites.length && !snapshot.inviteError) {
      const empty = document.createElement('div');
      empty.className = 'bw-invite-empty';
      empty.innerHTML = `${worldsIcon('invite')}<strong>La próxima aventura te espera</strong><p>Cuando te inviten a un mundo, podrás entrar desde aquí.</p>`;
      invites.append(empty);
    }
    for (const invite of snapshot.invites) {
      const card = document.createElement('article');
      card.className = 'bw-invite';
      const identity = document.createElement('div');
      identity.className = 'bw-invite-identity';
      const avatar = document.createElement('img');
      avatar.className = 'bw-invite-avatar';
      avatar.alt = '';
      avatar.src = window.battly.faceImageUrl(invite.fromUsername);
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = logo;
      };
      const sender = document.createElement('strong');
      setUserText(sender, invite.fromUsername);
      identity.append(avatar, sender);
      card.append(identity);
      text(
        card,
        'small',
        formatPlayVersion(parseWorldsVersion(invite.version)?.label || invite.version) ||
          'Te invita a su mundo',
      );
      const actions = document.createElement('div');
      actions.className = 'bw-invite-actions';
      const accept = document.createElement('button');
      accept.textContent = 'Unirme';
      accept.className = 'bw-primary';
      accept.disabled = busy || active;
      accept.onclick = () => {
        void act({ type: 'join', code: invite.code });
      };
      const dismiss = document.createElement('button');
      dismiss.textContent = 'Descartar';
      dismiss.className = 'bw-secondary';
      dismiss.disabled = busy;
      dismiss.onclick = () => {
        void act({ type: 'dismiss', inviteId: invite.inviteId });
      };
      actions.append(accept, dismiss);
      card.append(actions);
      invites.append(card);
    }
  }

  async function act(action: WorldsAction): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    generation++;
    if (action.type === 'join' || action.type === 'discord-join') {
      connection.open(action.type === 'join' ? action.code : 'Discord');
    }
    notice('');
    render();
    try {
      snapshot = await window.battly.worldsAction(action);
      notice(snapshot.message || (action.type === 'invite' ? 'Invitación enviada.' : ''));
    } catch (error) {
      notice(readable(error));
      if (action.type === 'join' || action.type === 'discord-join') {
        connection.fail(readable(error));
      }
    } finally {
      busy = false;
      renderedLists = '';
      render();
    }
  }

  async function refresh(): Promise<void> {
    if (busy || refreshing || (!dialog.open && Date.now() - lastRefresh < 15000)) {
      return;
    }
    refreshing = true;
    lastRefresh = Date.now();
    const current = generation;
    try {
      const next = await window.battly.getWorldsSnapshot();
      if (current !== generation) {
        return;
      }
      if (JSON.stringify(next) === JSON.stringify(snapshot)) {
        return;
      }
      if (next.username !== snapshot?.username) {
        seenInvites.clear();
        renderedLists = '';
      }
      if (!next.invites.length) {
        hideInvitation();
      }
      if (dialog.open && next.message !== snapshot?.message) {
        notice(next.message);
      }
      snapshot = next;
      render();
    } catch (error) {
      if (current !== generation) {
        return;
      }
      snapshot = undefined;
      hideInvitation();
      for (const badge of document.querySelectorAll<HTMLElement>('[data-worlds-count]')) {
        badge.hidden = true;
      }
      el('[data-account]').textContent = 'Inicia sesión con una cuenta de Battly';
      el('[data-session]').hidden = true;
      if (dialog.open) {
        notice(readable(error));
      }
    } finally {
      refreshing = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-worlds-open]')) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    hideInvitation();
    void refresh();
    void extras.loadRooms();
    void window.battly
      .getPlayVersions()
      .then(({ installed: items }) => {
        instances = items;
        render();
      })
      .catch(() =>
        notice('No se pudieron cargar tus versiones. Puedes abrir Minecraft desde Jugar.'),
      );
  });
  el('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    generation++;
  });
  join.onsubmit = (event) => {
    event.preventDefault();
    void act({ type: 'join', code: code.value.trim().toUpperCase() });
  };
  el('[data-leave]').onclick = () => {
    void act({ type: 'leave' });
  };
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    button.onclick = () => selectTab(button.dataset.tab!);
    button.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const tabs = ['host', 'join', 'public', 'invites'];
      const index = tabs.indexOf(button.dataset.tab!);
      const tab =
        event.key === 'Home'
          ? tabs[0]
          : event.key === 'End'
            ? tabs[tabs.length - 1]
            : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(tab);
      el(`[data-tab="${tab}"]`).focus();
    };
  }
  const launchVersion = async (raw: string): Promise<void> => {
    if (busy) {
      return;
    }
    if (['preparing', 'running'].includes(document.body.dataset.launchState || '')) {
      notice('Minecraft ya está abierto. Usa Conexión directa con la dirección de la sala.');
      connection.fail(
        'Minecraft ya está abierto. Copia la dirección y úsala en Multijugador → Conexión directa.',
      );
      return;
    }
    const room = snapshot?.code,
      address = snapshot?.address || '';
    const attempt = ++launchAttempt;
    busy = true;
    render();
    try {
      const request = await prepareWorldsPlayRequest(
        window.battly,
        raw,
        address,
        () =>
          attempt === launchAttempt &&
          snapshot?.code === room &&
          snapshot?.address === address &&
          snapshot?.state === 'joined',
        (message) => connection.preparing(message),
      );
      if (attempt !== launchAttempt) {
        return;
      }
      if (snapshot?.code !== room) {
        throw new Error('La sala cambió. Vuelve a entrar antes de iniciar Minecraft.');
      }
      dialog.close();
      launchPending = true;
      launch(request, parseWorldsVersion(raw)?.label || raw, (event) => {
        if (attempt !== launchAttempt) {
          return;
        }
        if (
          event.type === 'client-ready' ||
          event.type === 'exit' ||
          (event.type === 'state' && ['failed', 'exited'].includes(event.state))
        ) {
          launchPending = false;
        }
        connection.progress(event);
      });
    } catch (error) {
      if (attempt !== launchAttempt) {
        return;
      }
      notice(readable(error));
      connection.fail(readable(error));
    } finally {
      if (attempt === launchAttempt) {
        busy = false;
        render();
      }
    }
  };
  el('[data-connection-open]').onclick = () => {
    if (snapshot?.state === 'joined') {
      connection.open(snapshot.code);
      render();
    }
  };
  el('[data-copy]').onclick = () => {
    const value = snapshot?.code;
    if (value) {
      void window.battly
        .writeClipboardText(value)
        .then(() => notice('Copiado al portapapeles.'))
        .catch(() =>
          notice('No se pudo copiar. Puedes seleccionar el código y copiarlo manualmente.'),
        );
    }
  };
  window.battly.onWorldsEvent((event) => {
    if (event.type === 'snapshot') {
      if (worldsPreferences().connectionAlerts && event.snapshot.message !== snapshot?.message) {
        notice(event.snapshot.message);
      }
      snapshot = event.snapshot;
      render();
    }
    if (event.type === 'invite') {
      if (!worldsPreferences().invitations) {
        return;
      }
      if (seenInvites.has(event.invite.inviteId)) {
        return;
      }
      seenInvites.add(event.invite.inviteId);
      if (dialog.open || document.body.dataset.panel === 'login') {
        return;
      }
      hideInvitation();
      invitationTimer = setTimeout(hideInvitation, 15000);
      invitation.textContent = `${event.invite.fromUsername} te invita a jugar · Abrir BattlyWorlds`;
      invitation.hidden = dialog.open;
    }
    if (event.type === 'notice' && worldsPreferences().connectionAlerts) {
      notice(event.message);
    }
    if (event.type === 'closed') {
      notice(event.message);
      if (!dialog.open) {
        hideInvitation();
        invitation.textContent = event.message;
        invitation.hidden = false;
        invitationTimer = setTimeout(hideInvitation, 15000);
      }
    }
    if (event.type === 'presence' && worldsPreferences().connectionAlerts) {
      notice(`${event.username} ${event.joined ? 'ha entrado en' : 'ha salido de'} la sala.`);
    }
    if (event.type === 'open') {
      document.querySelector<HTMLButtonElement>('[data-worlds-open]')?.click();
    }
  });
  const timer = setInterval(() => {
    void refresh();
  }, 1500);
  window.battly.onProtocolAction((action) => {
    if (action.type !== 'worlds-discord') {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    selectTab('join');
    void act({ type: 'discord-join', secret: action.secret });
  });
  window.addEventListener(
    'beforeunload',
    () => {
      clearInterval(timer);
      hideInvitation();
    },
    { once: true },
  );
}
