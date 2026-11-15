import { setOverlayAvatar } from './worlds-avatar';
import type { SocialFriend } from '../../shared/social/social-contract';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import type { WorldsOverlayApi } from '../../shared/social/worlds-overlay-api';
import { worldsIcon } from './worlds-icons';
import logo from '../assets/icon.png?url';

export function mountWorldsFriendPicker(
  api: WorldsOverlayApi,
  snapshot: () => WorldsSnapshot | undefined,
  notice: (text: string) => void,
) {
  const dialog = document.createElement('dialog');
  dialog.className = 'hud-friend-dialog';
  dialog.setAttribute('aria-labelledby', 'hud-friend-title');
  dialog.innerHTML = /* HTML */ `<header>
      <div>
        <h2 id="hud-friend-title">Invitar a la aventura</h2>
        <p>Elige con quién compartir tu mundo.</p>
      </div>
      <button
        type="button"
        data-close
        aria-label="Cerrar lista de amigos"
      >
        ✕
      </button>
    </header>
    <form>
      <label
        >Buscar nombre de usuario<input
          type="search"
          maxlength="64"
          placeholder="Escribe un nombre…"
          autocomplete="off" /></label
      ><button
        class="bw-secondary"
        type="submit"
      >
        ${worldsIcon('globe')} Buscar en Battly
      </button>
    </form>
    <p
      role="status"
      data-message
    ></p>
    <div class="hud-friend-list"></div>
    <button
      class="bw-secondary"
      data-refresh
    >
      ${worldsIcon('refresh')} Actualizar amigos
    </button>`;
  document.body.append(dialog);
  const search = dialog.querySelector('input')!;
  const list = dialog.querySelector<HTMLElement>('.hud-friend-list')!;
  const message = dialog.querySelector<HTMLElement>('[data-message]')!;
  const refresh = dialog.querySelector<HTMLButtonElement>('[data-refresh]')!;
  const searchButton = dialog.querySelector<HTMLButtonElement>('form button')!;
  let friends: readonly SocialFriend[] = [],
    results: readonly string[] | null = null,
    revision = 0,
    friendRevision = 0,
    busy = false,
    room = '',
    owner = '';
  const validRoom = () => {
    const current = snapshot();
    return (
      current?.username === owner &&
      current.code === room &&
      ['hosting', 'joined'].includes(current.state)
    );
  };
  const error = (value: unknown) =>
    value instanceof Error
      ? value.message
          .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
          .slice(0, 240)
      : 'No se pudo completar la operación.';
  function render(): void {
    list.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const names = results || friends.map((friend) => friend.username);
    const entries = names
      .filter(
        (name) => name.toLowerCase() !== owner.toLowerCase() && name.toLowerCase().includes(query),
      )
      .map((username) => ({
        username,
        friend: friends.find((friend) => friend.username.toLowerCase() === username.toLowerCase()),
      }));
    entries.sort(
      (a, b) =>
        Number(b.friend?.status === 'online') - Number(a.friend?.status === 'online') ||
        a.username.toLowerCase().localeCompare(b.username.toLowerCase()),
    );
    for (const { username, friend } of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'hud-friend-row';
      row.disabled = busy || !validRoom();
      row.setAttribute('aria-label', `Invitar a ${username}`);
      const face = document.createElement('img');
      face.alt = '';
      face.loading = 'lazy';
      setOverlayAvatar(face, username, api);
      face.onerror = () => {
        face.onerror = null;
        face.src = logo;
      };
      const info = document.createElement('span');
      const name = document.createElement('strong');
      name.setAttribute('translate', 'no');
      name.textContent = username;
      const state = document.createElement('small');
      state.textContent = friend
        ? friend.status === 'online'
          ? 'Conectado'
          : 'Desconectado'
        : 'Usuario de Battly';
      state.className = friend?.status === 'online' ? 'is-online' : '';
      info.append(name, state);
      row.append(face, info);
      row.insertAdjacentHTML('beforeend', worldsIcon('invite'));
      row.onclick = () => {
        void invite(username);
      };
      list.append(row);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = query
        ? 'No hay coincidencias. Puedes buscar este nombre en Battly.'
        : 'Todavía no hay amigos. Busca un usuario para invitarlo.';
      list.append(empty);
    }
    refresh.disabled = busy;
    searchButton.disabled = busy;
  }
  async function invite(username: string): Promise<void> {
    if (busy) {
      return;
    }
    if (!validRoom()) {
      message.textContent = 'La sala ha cambiado. Cierra esta lista y vuelve a abrirla.';
      return;
    }
    busy = true;
    message.textContent = `Invitando a ${username}…`;
    render();
    try {
      await api.worldsAction({ type: 'invite', username });
      dialog.close();
      notice(`Invitación enviada a ${username}.`);
    } catch (e) {
      message.textContent = error(e);
    } finally {
      busy = false;
      render();
    }
  }
  async function load(): Promise<void> {
    const current = ++friendRevision;
    results = null;
    message.textContent = 'Cargando amigos…';
    refresh.disabled = true;
    try {
      const loaded = await api.friends();
      if (current !== friendRevision || !dialog.open) {
        return;
      }
      friends = loaded;
      message.textContent = '';
      render();
    } catch (e) {
      if (current === friendRevision) {
        message.textContent = error(e);
      }
    } finally {
      if (current === friendRevision) {
        refresh.disabled = false;
      }
    }
  }
  search.oninput = () => {
    revision++;
    results = null;
    message.textContent = '';
    refresh.disabled = busy;
    render();
  };
  dialog.querySelector('form')!.onsubmit = (event) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    const query = search.value.trim();
    if (query.length < 2) {
      message.textContent = 'Escribe al menos dos caracteres.';
      return;
    }
    const current = ++revision;
    searchButton.disabled = true;
    message.textContent = 'Buscando usuarios…';
    void api
      .searchUsers(query)
      .then((users) => {
        if (current !== revision || !dialog.open) {
          return;
        }
        results = users;
        message.textContent = 'Resultados de Battly';
        render();
      })
      .catch((e) => {
        if (current === revision) {
          message.textContent = error(e);
        }
      })
      .finally(() => {
        if (current === revision) {
          searchButton.disabled = false;
        }
      });
  };
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => dialog.close();
  refresh.onclick = () => {
    void load();
  };
  dialog.addEventListener('close', () => {
    revision++;
    friendRevision++;
  });
  api.onWorldsEvent((event) => {
    if (event.type === 'snapshot' && dialog.open) {
      if (!validRoom()) {
        dialog.close();
      }
    }
  });
  return {
    close: () => dialog.close(),
    open: async () => {
      const current = snapshot();
      if (!current?.code || !['hosting', 'joined'].includes(current.state)) {
        notice('Conecta tu sala para invitar a tus amigos.');
        return;
      }
      if (dialog.open || busy) {
        return;
      }
      room = current.code;
      owner = current.username;
      friends = [];
      results = null;
      search.value = '';
      list.replaceChildren();
      dialog.showModal();
      search.focus();
      await load();
    },
  };
}
