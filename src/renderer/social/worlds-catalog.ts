import { setUserText } from '../i18n/ui-translator';
import { setUiText } from '../i18n/dialog-text';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import type { BattlyDesktopApi } from '../../shared/desktop-api';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
export function mountWorldsCatalog(
  catalog: HTMLElement,
  api: Pick<BattlyDesktopApi, 'getWorldsPublicRooms' | 'worldsAction'> & {
    faceImageUrl?: (username: string) => string | Promise<string>;
  },
  joinRoom?: (code: string) => Promise<void>,
) {
  let snapshot: WorldsSnapshot | undefined,
    page = 1,
    loading = false,
    catalogVersion = 0;
  const active = () => !!snapshot && !['idle', 'error'].includes(snapshot.state);
  const error = (value: unknown) =>
    value instanceof Error
      ? value.message
          .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
          .slice(0, 240)
      : 'No se pudieron cargar las salas';
  catalog.innerHTML = /* HTML */ `<div class="bw-section-title">
      <h2>Salas públicas</h2>
      <button
        class="bw-secondary"
        data-refresh
      >
        Actualizar
      </button>
    </div>
    <p class="bw-hint">
      Descubre mundos de la comunidad. Usa la misma versión y mods que el anfitrión.
    </p>
    <div class="bw-public-list"></div>
    <div class="bw-pagination">
      <button
        class="bw-secondary"
        data-prev
      >
        Anterior</button
      ><span data-page>Página 1</span
      ><button
        class="bw-secondary"
        data-next
      >
        Siguiente
      </button>
    </div>
    <p
      role="status"
      data-public-message
    ></p>`;
  async function loadRooms(background = false): Promise<void> {
    if (loading) {
      return;
    }
    loading = true;
    const request = ++catalogVersion;
    const status = catalog.querySelector('[data-public-message]')!;
    if (!background) {
      status.textContent = 'Buscando salas…';
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const rooms = await Promise.race([
        api.getWorldsPublicRooms(page),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('No se pudieron cargar las salas')), 20000);
        }),
      ]);
      if (request !== catalogVersion) {
        return;
      }
      const list = catalog.querySelector('.bw-public-list')!;
      list.replaceChildren();
      for (const room of rooms) {
        const card = document.createElement('article');
        card.className = 'bw-public-room';
        const title = document.createElement('strong');
        const face = document.createElement('img');
        face.className = 'bw-host-face';
        face.alt = '';
        face.loading = 'lazy';
        face.decoding = 'async';
        const fallback = document.createElement('span');
        fallback.className = 'bw-host-face-fallback';
        fallback.textContent = room.hostUsername.slice(0, 2).toUpperCase();
        face.onerror = () => {
          face.remove();
          title.prepend(fallback);
        };
        try {
          if (!api.faceImageUrl) {
            throw new Error('Avatar unavailable');
          }
          void Promise.resolve(api.faceImageUrl(room.hostUsername))
            .then((url) => {
              face.src = url;
            })
            .catch(() => {
              face.onerror?.(new Event('error'));
            });
        } catch {
          face.hidden = true;
          title.append(fallback);
        }
        title.append(face);
        const name = document.createElement('span');
        setUserText(name, room.title, `Mundo de ${room.hostUsername}`);
        title.append(name);
        const detail = document.createElement('small');
        detail.textContent = room.hostUsername;
        const version = document.createElement('span');
        version.className = 'bw-room-version';
        version.textContent =
          parseWorldsVersion(room.version)?.label || room.version || 'Minecraft';
        version.title = version.textContent;
        const players = document.createElement('span');
        players.className = 'bw-room-players';
        setUiText(players, `${room.playerCount} en la sala`);
        const join = document.createElement('button');
        join.className = 'bw-primary';
        join.textContent = 'Unirme';
        join.disabled = active();
        join.onclick = () => {
          join.disabled = true;
          if (joinRoom) {
            status.textContent = '';
            void joinRoom(room.code)
              .catch((e) => {
                status.textContent = error(e);
              })
              .finally(() => {
                join.disabled = active();
              });
            return;
          }
          void api
            .worldsAction({ type: 'join', code: room.code })
            .then((next) => {
              update(next);
              status.textContent = next.message || 'Conectando con el mundo…';
            })
            .catch((e) => {
              status.textContent = error(e);
            })
            .finally(() => {
              join.disabled = active();
            });
        };
        const identity = document.createElement('div');
        identity.className = 'bw-room-identity';
        identity.append(title, detail);
        card.append(identity, version, players, join);
        list.append(card);
      }
      status.textContent = rooms.length ? '' : 'No hay salas públicas disponibles en esta página.';
      catalog.querySelector<HTMLButtonElement>('[data-next]')!.disabled = rooms.length < 24;
      catalog.querySelector<HTMLButtonElement>('[data-prev]')!.disabled = page <= 1;
      catalog.querySelector('[data-page]')!.textContent = `Página ${page}`;
    } catch (e) {
      if (request === catalogVersion) {
        status.textContent = error(e);
      }
    } finally {
      clearTimeout(timeout);
      if (request === catalogVersion) {
        loading = false;
      }
    }
  }
  catalog.querySelector<HTMLButtonElement>('[data-refresh]')!.onclick = () => {
    void loadRooms();
  };
  catalog.querySelector<HTMLButtonElement>('[data-prev]')!.onclick = () => {
    if (!loading) {
      page = Math.max(1, page - 1);
      void loadRooms();
    }
  };
  catalog.querySelector<HTMLButtonElement>('[data-next]')!.onclick = () => {
    if (!loading) {
      page++;
      void loadRooms();
    }
  };
  function update(next: WorldsSnapshot): void {
    if (snapshot && snapshot.username !== next.username) {
      const retry = loading;
      catalogVersion++;
      loading = false;
      page = 1;
      catalog.querySelector('.bw-public-list')!.replaceChildren();
      if (retry) {
        queueMicrotask(() => {
          void loadRooms();
        });
      }
    }
    snapshot = next;
    catalog.querySelectorAll<HTMLButtonElement>('.bw-public-room button').forEach((button) => {
      button.disabled = active();
    });
  }
  if (typeof window !== 'undefined') {
    const refresh = window.setInterval(() => {
      if (!catalog.isConnected) {
        window.clearInterval(refresh);
        return;
      }
      const dialog = catalog.closest?.('dialog');
      if (!document.hidden && (dialog?.open || catalog.getClientRects().length > 0)) {
        void loadRooms(true);
      }
    }, 15_000);
  }
  return { update, loadRooms };
}
