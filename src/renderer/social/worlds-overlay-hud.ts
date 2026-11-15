import { setUiText } from '../i18n/dialog-text';
import { setOverlayAvatar } from './worlds-avatar';
import { mountWorldsHudEditor } from './worlds-hud-editor';
import { isMinimalWorldsOverlay } from '../../shared/social/worlds-overlay-preferences';
import { worldsRoomMemberCount } from '../../shared/social/battly-worlds-contract';
import { worldsIcon } from './worlds-icons';
import type { WorldsOverlayApi } from '../../shared/social/worlds-overlay-api';
import type { WorldsSnapshot, WorldsVoiceStatus } from '../../shared/social/battly-worlds-contract';
import {
  defaultWorldsOverlayPreferences,
  type WorldsOverlayPreferences,
} from '../../shared/social/worlds-overlay-preferences';

/** Display only locally measured audio and events from the authenticated room channel. */
export function mountWorldsHud(api: WorldsOverlayApi, note: (message: string) => void) {
  const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector)!;
  const form = el<HTMLFormElement>('[data-appearance]');
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const speakers = el('.hud-speakers'),
    presence = el('.hud-presence');
  let preferences = { ...defaultWorldsOverlayPreferences };
  let snapshot: WorldsSnapshot | undefined;
  let status: WorldsVoiceStatus = { connected: false, muted: false, deafened: false, error: '' };
  let activity: readonly { userId: string; level: number }[] = [];
  let lastHeight = 0;
  const measure = () => {
    if (document.body.dataset.expanded !== 'false') {
      return;
    }
    const height = Math.ceil(
      el('.hud-shell').getBoundingClientRect().height + el('.hud-live').scrollHeight + 8,
    );
    if (height !== lastHeight) {
      lastHeight = height;
      void api.compactHeight(height).catch(() => undefined);
    }
  };
  const resize = new ResizeObserver(measure);
  resize.observe(el('.hud-shell'));
  resize.observe(el('.hud-live'));
  api.onExpanded(() => requestAnimationFrame(measure));
  const apply = (value: WorldsOverlayPreferences) => {
    preferences = value;
    document.body.style.setProperty('--hud-opacity', String(value.opacity / 100));
    document.body.dataset.animations = String(value.animations);
    document.body.dataset.minimal = String(isMinimalWorldsOverlay(value));
    editor.update(value);
    field('opacity').value = String(value.opacity);
    field('position').value = value.position;
    form.querySelectorAll<HTMLButtonElement>('[data-overlay-position]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.overlayPosition === value.position),
      );
    });
    for (const name of ['showVoice', 'showPresence', 'animations'] as const) {
      field(name).checked = value[name];
    }
    el('[data-opacity-label]').textContent = `${value.opacity}% de opacidad`;
    speakers.hidden = !value.showVoice;
    presence.hidden = !value.showPresence;
    renderSpeakers();
  };
  const save = () => {
    void api.configure(preferences).catch(() => note('No se pudo guardar el aspecto del overlay.'));
  };
  const editor = mountWorldsHudEditor(el('[data-hud-editor]'), apply, save);
  form.querySelectorAll<HTMLButtonElement>('[data-overlay-position]').forEach((button) => {
    button.onclick = () => {
      apply({
        ...preferences,
        position: button.dataset.overlayPosition as WorldsOverlayPreferences['position'],
        offsetX: null,
        offsetY: null,
      });
      save();
    };
  });
  form.oninput = () =>
    apply({
      ...preferences,
      opacity: Number(field('opacity').value),
      position: field('position').value as WorldsOverlayPreferences['position'],
      showVoice: field('showVoice').checked,
      showPresence: field('showPresence').checked,
      animations: field('animations').checked,
    });
  form.onchange = (event) => {
    if (event.target === field('position')) {
      apply({ ...preferences, offsetX: null, offsetY: null });
    }
    save();
  };
  form.onsubmit = (e) => e.preventDefault();
  el('[data-reset-appearance]').onclick = () => {
    apply({ ...defaultWorldsOverlayPreferences });
    save();
  };
  api.onPreferences(apply);
  void api
    .preferences()
    .then(apply)
    .catch(() => apply(preferences));
  function renderStatus(): void {
    el('.hud-mini-controls').hidden = !status.connected;
    const mute = el<HTMLButtonElement>('[data-mini-mute]'),
      deafen = el<HTMLButtonElement>('[data-mini-deafen]');
    mute.innerHTML = worldsIcon(status.muted ? 'micOff' : 'mic');
    deafen.innerHTML = worldsIcon(status.deafened ? 'deafened' : 'headphones');
    mute.setAttribute('aria-pressed', String(status.muted));
    deafen.setAttribute('aria-pressed', String(status.deafened));
    mute.setAttribute('aria-label', status.muted ? 'Activar micrófono' : 'Silenciar micrófono');
    deafen.setAttribute('aria-label', status.deafened ? 'Escuchar' : 'Silenciar audio');
    el('[data-mini-voice]').textContent = status.deafened
      ? 'Ensordecido'
      : status.muted
        ? 'Silenciado'
        : 'Voz activa';
    renderIndicator();
    const connected = !!snapshot && ['hosting', 'joined'].includes(snapshot.state);
    const connection =
      connected && status.connected
        ? 'Sala y voz conectadas'
        : connected
          ? 'Sala conectada'
          : status.connected
            ? 'Voz conectada'
            : snapshot?.state === 'connecting'
              ? 'Conectando a la sala…'
              : 'Tu mundo con amigos';
    const miniStatus = el('[data-mini-status]');
    miniStatus.replaceChildren();
    if (connected) {
      const count = document.createElement('span');
      setUiText(count, `${worldsRoomMemberCount(snapshot!)} en sala`);
      miniStatus.append(count, document.createTextNode(' · '));
    }
    const connectionText = document.createElement('span');
    setUiText(connectionText, connection);
    miniStatus.append(connectionText);
    const face = el<HTMLImageElement>('[data-self-face]');
    if (snapshot?.username && face.dataset.username !== snapshot.username) {
      face.dataset.username = snapshot.username;
      face.hidden = false;
      face.onerror = () => {
        face.hidden = true;
      };
      setOverlayAvatar(face, snapshot.username, api);
      face.alt = snapshot.username;
    }
  }
  function renderIndicator(): void {
    const self = snapshot?.participants.find(
      (m) => m.username.toLowerCase() === snapshot?.username.toLowerCase(),
    );
    const speaking =
      status.connected &&
      !status.muted &&
      !status.deafened &&
      activity.some((a) => a.userId === self?.userId);
    const indicator = el('[data-mini-indicator]');
    indicator.hidden = !status.deafened && !status.muted && !speaking;
    indicator.classList.toggle('is-negative', status.deafened || status.muted);
    indicator.innerHTML = worldsIcon(
      status.deafened ? 'deafened' : status.muted ? 'micOff' : 'mic',
    );
    indicator.setAttribute(
      'aria-label',
      status.deafened ? 'Ensordecido' : status.muted ? 'Micrófono silenciado' : 'Hablando',
    );
    indicator.title = indicator.getAttribute('aria-label')!;
  }
  function renderSpeakers(): void {
    const live = new Set<string>();
    if (status.connected && preferences.showVoice) {
      for (const item of activity) {
        const member = snapshot?.participants.find((m) => m.userId === item.userId);
        if (
          !member ||
          (member.username.toLowerCase() === snapshot?.username.toLowerCase() &&
            (status.muted || status.deafened))
        ) {
          continue;
        }
        live.add(item.userId);
        let row = Array.from(speakers.children).find(
          (e) => (e as HTMLElement).dataset.id === item.userId,
        ) as HTMLElement | undefined;
        if (!row) {
          row = document.createElement('div');
          row.className = 'hud-speaker';
          row.dataset.id = item.userId;
          const avatar = document.createElement('span');
          avatar.className = 'hud-avatar';
          avatar.textContent = member.username.slice(0, 2).toUpperCase();
          const face = document.createElement('img');
          face.alt = '';
          setOverlayAvatar(face, member.username, api);
          face.onerror = () => face.remove();
          avatar.append(face);
          const name = document.createElement('strong');
          name.setAttribute('translate', 'no');
          name.textContent = member.username;
          const signal = document.createElement('span');
          signal.className = 'hud-signal';
          signal.setAttribute('aria-label', 'Hablando');
          for (let i = 0; i < 4; i++) {
            signal.append(document.createElement('i'));
          }
          row.append(avatar, name, signal);
          speakers.append(row);
        }
        row.style.setProperty('--voice-level', String(Math.max(0.08, item.level)));
      }
    }
    for (const row of Array.from(speakers.children)) {
      if (!live.has((row as HTMLElement).dataset.id!)) {
        row.remove();
      }
    }
  }
  const command = (type: 'mute' | 'deafen', value: boolean) => {
    void api
      .worldsVoiceCommand({ type, value })
      .catch(() => note('No se pudo cambiar el estado de voz.'));
  };
  el('[data-mini-mute]').onclick = () => command('mute', !status.muted);
  el('[data-mini-deafen]').onclick = () => command('deafen', !status.deafened);
  api.onWorldsEvent((event) => {
    if (event.type !== 'voice') {
      return;
    }
    if (event.event.type === 'activity') {
      activity = event.event.speakers;
      renderSpeakers();
      renderIndicator();
    }
    if (event.event.type === 'status') {
      status = event.event.status;
      renderStatus();
      renderSpeakers();
    }
  });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  window.addEventListener('beforeunload', () => {
    resize.disconnect();
    for (const timer of timers) {
      clearTimeout(timer);
    }
  });
  return {
    snapshot(value: WorldsSnapshot): void {
      if (snapshot?.code !== value.code || ['idle', 'error'].includes(value.state)) {
        presence.replaceChildren();
        activity = [];
      }
      snapshot = value;
      renderStatus();
      renderSpeakers();
    },
    presence(username: string, joined: boolean): void {
      if (!preferences.showPresence || !snapshot?.code) {
        return;
      }
      const row = document.createElement('div');
      row.className = 'hud-presence-item';
      row.dataset.joined = String(joined);
      const icon = document.createElement('span');
      icon.className = 'hud-presence-icon';
      icon.textContent = joined ? '+' : '−';
      const text = document.createElement('span'),
        name = document.createElement('strong'),
        caption = document.createElement('small');
      name.setAttribute('translate', 'no');
      name.textContent = username;
      caption.textContent = joined ? 'Se ha unido a la sala' : 'Ha salido de la sala';
      text.append(name, caption);
      const face = document.createElement('img');
      face.className = 'hud-presence-face';
      face.alt = '';
      setOverlayAvatar(face, username, api);
      face.onerror = () => face.remove();
      row.append(face, icon, text);
      presence.prepend(row);
      while (presence.children.length > 3) {
        presence.lastElementChild?.remove();
      }
      const timer = setTimeout(() => {
        row.remove();
        timers.delete(timer);
      }, 4500);
      timers.add(timer);
    },
  };
}
