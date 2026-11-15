import { mountWorldsFriendPicker } from './worlds-friend-picker';
import { decorateWorldsButtons } from './worlds-icons';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import type { WorldsOverlayApi } from '../../shared/social/worlds-overlay-api';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import { mountWorldsControls } from './worlds-controls';
import { mountWorldsHud } from './worlds-overlay-hud';
import logo from '../assets/icon.png?url';
import './battly-worlds.css';
import './worlds-overlay.css';
import '../styles/emoji.css';
import { startWindowLanguage } from '../i18n/window-language';
declare global {
  interface Window {
    worldsOverlay: WorldsOverlayApi;
  }
}
const api = window.worldsOverlay;
startWindowLanguage(
  () => api.language(),
  (text) =>
    /Macintosh|Mac OS X/.test(navigator.userAgent)
      ? text.replace(/\bCtrl(?=\s*(?:\+\s*)?[BH]\b)/g, '⌘')
      : text,
);
const el = <T extends HTMLElement = HTMLElement>(selector: string): T =>
  document.querySelector<T>(selector)!;
el<HTMLImageElement>('[data-logo]').src = logo;
let snapshot: WorldsSnapshot | undefined,
  version = '',
  busy = false,
  expanded = false,
  inviteKey = '';
const extras = mountWorldsControls(
  el('[data-visibility]'),
  el('[data-view=voice]'),
  document.createElement('section'),
  api,
  true,
);
const note = (message: string): void => {
  el('.hud-toast').textContent = message;
  el('.hud-toast').hidden = !message;
};
const hud = mountWorldsHud(api, note);
let lanPrompt = false;
let summaryRoom = '';
let summaryUntil = 0;
let summaryTimer: ReturnType<typeof setTimeout> | undefined;
function updateRoomSummary(value: WorldsSnapshot): void {
  const room = ['hosting', 'joined'].includes(value.state) ? value.code : '';
  if (room === summaryRoom) {
    return;
  }
  clearTimeout(summaryTimer);
  summaryTimer = undefined;
  summaryRoom = room;
  summaryUntil = room ? Date.now() + 10000 : 0;
  if (room) {
    summaryTimer = setTimeout(showCompactRoom, 10000);
  }
}
window.addEventListener('beforeunload', () => clearTimeout(summaryTimer));
function showCompactRoom(): void {
  el('[data-room-summary]').hidden =
    lanPrompt ||
    !snapshot ||
    ['idle', 'error'].includes(snapshot.state) ||
    (!!summaryRoom && Date.now() >= summaryUntil);
  el('[data-compact-state]').textContent = el('[data-status]').textContent;
  el('[data-compact-code]').textContent = snapshot?.code || '';
}
api.onLanPrompt((visible) => {
  lanPrompt = visible;
  document.body.dataset.lanState = String(visible);
  el('[data-lan-prompt]').hidden = !visible;
  showCompactRoom();
});
const respondLan = (accept: boolean): void => {
  void api
    .respondLan(accept)
    .catch(() => note('No se pudo responder al aviso. Vuelve a intentarlo.'));
};
el('[data-lan-accept]').onclick = () => respondLan(true);
el('[data-lan-ignore]').onclick = () => respondLan(false);
document.addEventListener('keydown', (event) => {
  if (!lanPrompt || event.repeat || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== 'y' && key !== 'n') {
    return;
  }
  event.preventDefault();
  respondLan(key === 'y');
});
function render(value: WorldsSnapshot): void {
  snapshot = value;
  updateRoomSummary(value);
  extras.update(value);
  const active = !['idle', 'error'].includes(value.state);
  el('[data-status]').textContent = {
    idle: 'Tu mundo con amigos',
    starting: 'Preparando la sala…',
    scanning: 'Esperando el mundo LAN',
    connecting: 'Conectando…',
    hosting: 'Tu sala está abierta',
    joined: 'Conectado al mundo',
    error: 'No se pudo conectar',
  }[value.state];
  showCompactRoom();
  el('[data-version]').textContent =
    parseWorldsVersion(value.version || version)?.label || value.version || version;
  el('[data-public-help]').hidden = value.state === 'hosting';
  el('[data-help]').textContent =
    value.state === 'joined'
      ? 'En Minecraft, entra en Multijugador → Conexión directa e introduce esta dirección.'
      : value.state === 'hosting'
        ? 'Comparte el código o invita a tus amigos. Mantén el mundo abierto.'
        : 'En Minecraft: Esc → Abrir en LAN → Iniciar mundo LAN. Battly detectará el mundo automáticamente.';
  el('[data-host]').hidden = active;
  el('[data-join]').hidden = active;
  el<HTMLButtonElement>('[data-leave]').disabled = !active || busy;
  el<HTMLButtonElement>('[data-copy]').disabled = !value.code;
  el<HTMLButtonElement>('[data-open-invite]').disabled =
    !['hosting', 'joined'].includes(value.state) || busy;
  el('[data-address]').hidden = !value.address;
  el('[data-address]').textContent = value.address ? `Conexión directa: ${value.address}` : '';
  hud.snapshot(value);
  el('.hud-members').textContent = value.members.length
    ? `En la sala: ${value.members.join(', ')}`
    : '';
  if (value.message) {
    note(value.message);
  }
  const key = JSON.stringify([value.invites, active, busy]);
  if (key === inviteKey) {
    return;
  }
  inviteKey = key;
  const list = el('.hud-invites');
  list.replaceChildren();
  for (const invite of value.invites) {
    const card = document.createElement('article');
    card.className = 'bw-invite';
    const text = document.createElement('p');
    text.textContent = `${invite.fromUsername} te invita · ${invite.version}`;
    const accept = document.createElement('button');
    accept.className = 'bw-primary';
    accept.textContent = 'Aceptar';
    accept.disabled = active || busy;
    accept.onclick = () => {
      void act({ type: 'join', code: invite.code });
    };
    const decline = document.createElement('button');
    decline.className = 'bw-secondary';
    decline.textContent = 'Descartar';
    decline.disabled = busy;
    decline.onclick = () => {
      void act({ type: 'dismiss', inviteId: invite.inviteId });
    };
    card.append(text, accept, decline);
    list.append(card);
  }
}
async function act(action: Parameters<WorldsOverlayApi['worldsAction']>[0]): Promise<void> {
  if (busy) {
    return;
  }
  busy = true;
  note('Un momento…');
  try {
    const result = await api.worldsAction(action);
    note(result.message || (action.type === 'invite' ? 'Invitación enviada.' : ''));
    render(result);
  } catch (error) {
    note(
      error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
        : 'No se pudo completar la operación',
    );
  } finally {
    busy = false;
    if (snapshot) {
      render(snapshot);
    }
  }
}
el('[data-toggle]').onclick = () => {
  if (lanPrompt) {
    return;
  }
  expanded = !expanded;
  void api.expand(expanded);
  document.body.dataset.expanded = String(expanded);
  el('[data-toggle]').setAttribute('aria-expanded', String(expanded));
};
api.onExpanded((value) => {
  if (expanded !== value) {
    animateOverlay();
  }
  expanded = value;
  document.body.dataset.expanded = String(value);
  el('[data-toggle]').setAttribute('aria-expanded', String(value));
});
api.onGameVersion((value) => {
  version = value;
  el('[data-version]').textContent = value;
});
api.onWorldsEvent((event) => {
  if (event.type === 'snapshot') {
    render(event.snapshot);
  }
  if (event.type === 'invite') {
    note(`${event.invite.fromUsername} te invita a jugar. La invitación está en Sala.`);
  }
  if (event.type === 'notice') {
    note(event.message);
  }
  if (event.type === 'closed') {
    note(event.message);
  }
  if (event.type === 'presence') {
    hud.presence(event.username, event.joined);
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-page]')) {
  button.onclick = () => {
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((view) => {
      view.hidden = view.dataset.view !== button.dataset.page;
    });
    document
      .querySelectorAll<HTMLElement>('[data-page]')
      .forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
  };
}
el('[data-host]').onclick = () => {
  if (!version) {
    note('Espera a que Battly identifique la versión de Minecraft.');
    return;
  }
  void act({ type: 'host', version });
};
el('[data-leave]').onclick = () => {
  void act({ type: 'leave' });
};
el<HTMLFormElement>('[data-join]').onsubmit = (event) => {
  event.preventDefault();
  void act({
    type: 'join',
    code: el<HTMLInputElement>('[data-join] input').value.trim().toUpperCase(),
  });
};
el('[data-copy]').onclick = async () => {
  const code = snapshot?.code;
  if (!code) {
    return;
  }
  const button = el<HTMLButtonElement>('[data-copy]');
  button.disabled = true;
  try {
    if ((await api.writeClipboardText(code)) !== true) {
      throw new Error('Clipboard write failed');
    }
    note('Copiado.');
  } catch {
    note('Selecciona el código y cópialo manualmente.');
  } finally {
    button.disabled = !snapshot?.code;
  }
};
void api
  .getWorldsSnapshot()
  .then(render)
  .catch(() => note('Selecciona una cuenta de Battly en el launcher.'));
const picker = mountWorldsFriendPicker(api, () => snapshot, note);
el('[data-open-invite]').onclick = () => {
  void picker.open();
};
api.onExpanded((value) => {
  if (!value) {
    picker.close();
  }
});

decorateWorldsButtons(document.body);

function animateOverlay(): void {
  if (
    document.body.dataset.animations === 'false' ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }
  const shell = el('.hud-shell');
  for (const animation of shell.getAnimations()) {
    animation.cancel();
  }
  shell.animate(
    [
      { opacity: 0.4, transform: 'translateY(5px) scale(.97)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' },
  );
}
api.onReveal(animateOverlay);
import '../styles/scrollbars.css';
