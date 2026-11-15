import type { MusicPlaylist } from '../../shared/music/music-contract';

interface PlaylistMenuActions {
  /** Localize generated names while preserving names supplied by users. */
  renderName?(element: HTMLElement, playlist: MusicPlaylist): void;
  open(playlist: MusicPlaylist): void;
  play(playlist: MusicPlaylist): void;
  next(playlist: MusicPlaylist): void;
  enqueue(playlist: MusicPlaylist): void;
  edit(playlist: MusicPlaylist): void;
  share(playlist: MusicPlaylist): Promise<void>;
  collaborate(playlist: MusicPlaylist): void;
  remove(playlist: MusicPlaylist): Promise<void>;
  report(message: string): void;
}

/** One transient menu across home, generated and personal playlist cards. */
export function createPlaylistMenu(
  actions: PlaylistMenuActions,
): (card: HTMLElement, playlist: MusicPlaylist) => void {
  let menu: HTMLElement | undefined;
  let owner: HTMLElement | undefined;
  const close = (restoreFocus = false): void => {
    menu?.remove();
    menu = undefined;
    owner?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && owner?.isConnected) {
      owner.focus();
    }
    owner = undefined;
  };
  document.addEventListener('music-context-menu-open', () => close());
  document.addEventListener('pointerdown', (event) => {
    if (!menu?.contains(event.target as Node)) {
      close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!menu) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(true);
    }
  });
  document.addEventListener(
    'scroll',
    (event) => {
      if (!menu?.contains(event.target as Node)) {
        close();
      }
    },
    true,
  );
  window.addEventListener('resize', () => close());
  window.addEventListener('blur', () => close());

  return (card, playlist) => {
    card.setAttribute('aria-haspopup', 'menu');
    card.setAttribute('aria-expanded', 'false');
    const open = (x: number, y: number): void => {
      document.dispatchEvent(new Event('music-context-menu-open'));
      owner = card;
      card.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div');
      menu.className = 'music-song-menu music-playlist-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-labelledby', 'music-playlist-menu-title');
      const title = document.createElement('strong');
      title.id = 'music-playlist-menu-title';
      title.title = playlist.name;
      if (actions.renderName) {
        actions.renderName(title, playlist);
      } else {
        title.textContent = playlist.name;
        title.setAttribute('translate', 'no');
      }
      menu.append(title);
      const add = (
        label: string,
        icon: string,
        run: () => void | Promise<void>,
        disabled = false,
      ): void => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.disabled = disabled;
        const glyph = document.createElement('i');
        glyph.className = `fa-solid ${icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = label;
        button.append(glyph, text);
        button.addEventListener('click', () => {
          close(true);
          void Promise.resolve()
            .then(run)
            .catch(() =>
              actions.report('No se pudo completar la acción de la playlist. Inténtalo de nuevo.'),
            );
        });
        menu?.append(button);
      };
      const empty = playlist.songs.length === 0;
      add('Abrir playlist', 'fa-folder-open', () => actions.open(playlist));
      add('Reproducir ahora', 'fa-play', () => actions.play(playlist), empty);
      add('Reproducir a continuación', 'fa-forward-step', () => actions.next(playlist), empty);
      add('Añadir a la cola', 'fa-list', () => actions.enqueue(playlist), empty);
      if (playlist.canEditMetadata) {
        add('Editar playlist', 'fa-pen', () => actions.edit(playlist));
      }
      if (playlist.canShare) {
        add('Compartir playlist', 'fa-share-nodes', () => actions.share(playlist));
      }
      if (playlist.collaborative || playlist.canManageCollaboration) {
        add('Colaboración', 'fa-users', () => actions.collaborate(playlist));
      }
      if (playlist.canDelete) {
        add('Eliminar playlist', 'fa-trash', () => actions.remove(playlist));
      }
      document.body.append(menu);
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      menu.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const buttons = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      });
    };
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = card.getBoundingClientRect();
      open(event.clientX || bounds.left, event.clientY || bounds.top);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const bounds = card.getBoundingClientRect();
      open(bounds.left, bounds.top);
    });
  };
}
