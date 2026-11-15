import { setUserText } from '../i18n/ui-translator';
import type { MusicSong } from '../../shared/music/music-contract';

interface SongAction {
  label: string;
  userLabel?: boolean;
  icon: string;
  run?: () => void | Promise<void>;
  children?: SongAction[];
}
let selecting = false;
export function toggleMusicSelection(): boolean {
  selecting = !selecting;
  document.body.classList.toggle('music-selecting', selecting);
  document.dispatchEvent(new Event('music-selection-mode'));
  return selecting;
}
export function createSongMenu(
  actions: (songs: MusicSong[]) => SongAction[],
  report: (message: string) => void,
) {
  const selected = new Map<string, MusicSong>();
  let menu: HTMLElement | undefined;
  const close = () => {
    menu?.remove();
    menu = undefined;
  };
  document.addEventListener('music-context-menu-open', close);
  const refresh = () =>
    document.querySelectorAll<HTMLElement>('[data-selectable-song]').forEach((row) => {
      const active = selected.has(row.dataset.selectableSong!);
      row.classList.toggle('song-selected', active);
      const checkbox = row.querySelector<HTMLInputElement>('.song-select');
      if (checkbox) {
        checkbox.checked = active;
      }
    });
  document.addEventListener('music-selection-mode', () => {
    if (!selecting) {
      selected.clear();
    }
    refresh();
    close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu?.contains(event.target as Node)) {
      close();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });
  window.addEventListener('resize', close);
  document.addEventListener(
    'scroll',
    (event) => {
      if (!menu?.contains(event.target as Node)) {
        close();
      }
    },
    true,
  );
  return (row: HTMLElement, song: MusicSong): void => {
    row.dataset.selectableSong = song.id;
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'song-select';
    check.setAttribute('aria-label', `Seleccionar ${song.title}`);
    check.checked = selected.has(song.id);
    row.classList.toggle('song-selected', check.checked);
    check.addEventListener('click', (event) => event.stopPropagation());
    check.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.stopPropagation();
      }
    });
    check.addEventListener('change', () => {
      if (check.checked) {
        selected.set(song.id, song);
      } else {
        selected.delete(song.id);
      }
      refresh();
    });
    row.prepend(check);
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.dispatchEvent(new Event('music-context-menu-open'));
      if (!selecting || !selected.has(song.id)) {
        selected.clear();
        selected.set(song.id, song);
        if (selecting) {
          refresh();
        }
      }
      const songs = [...selected.values()];
      menu = document.createElement('div');
      menu.className = 'music-song-menu';
      menu.setAttribute('role', 'menu');
      const heading = document.createElement('strong');
      if (songs.length > 1) {
        heading.textContent = `${songs.length} canciones seleccionadas`;
      } else {
        setUserText(heading, song.title);
      }
      menu.append(heading);
      const appendAction = (container: HTMLElement, action: SongAction): void => {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        const icon = document.createElement('i');
        icon.className = `fa-solid ${action.icon}`;
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        if (action.userLabel) {
          setUserText(label, action.label);
        } else {
          label.textContent = action.label;
        }
        label.title = action.label;
        button.append(icon, label);
        if (action.children) {
          const wrapper = document.createElement('div');
          wrapper.className = 'music-submenu-trigger';
          button.setAttribute('aria-haspopup', 'menu');
          button.setAttribute('aria-expanded', 'false');
          const arrow = document.createElement('i');
          arrow.className = 'fa-solid fa-chevron-right';
          button.append(arrow);
          wrapper.append(button);
          container.append(wrapper);
          let submenu: HTMLElement | undefined;
          const open = () => {
            if (submenu) {
              return;
            }
            submenu = document.createElement('div');
            submenu.className = 'music-song-submenu';
            submenu.setAttribute('role', 'menu');
            for (const child of action.children!) {
              appendAction(submenu, child);
            }
            if (!action.children!.length) {
              submenu.textContent = 'No hay playlists editables';
            }
            wrapper.append(submenu);
            button.setAttribute('aria-expanded', 'true');
            if (submenu.getBoundingClientRect().right > innerWidth - 8) {
              submenu.classList.add('opens-left');
            }
            const bottom = submenu.getBoundingClientRect().bottom;
            if (bottom > innerHeight - 8) {
              submenu.style.top = `${innerHeight - 8 - bottom}px`;
            }
          };
          wrapper.addEventListener('mouseenter', open);
          button.addEventListener('click', open);
          button.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              open();
              submenu?.querySelector('button')?.focus();
            }
          });
          wrapper.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' && submenu) {
              event.preventDefault();
              submenu.remove();
              submenu = undefined;
              button.setAttribute('aria-expanded', 'false');
              button.focus();
            }
          });
          wrapper.addEventListener('mouseleave', () => {
            submenu?.remove();
            submenu = undefined;
            button.setAttribute('aria-expanded', 'false');
          });
        } else {
          button.addEventListener('click', () => {
            close();
            void Promise.resolve()
              .then(action.run)
              .catch(() => report('No se pudo completar la acción. Inténtalo de nuevo.'));
          });
          container.append(button);
        }
      };
      for (const action of [
        ...actions(songs),
        ...(selecting
          ? [
              {
                label: 'Quitar selección',
                icon: 'fa-xmark',
                run: () => {
                  selected.clear();
                  refresh();
                },
              },
            ]
          : []),
      ]) {
        appendAction(menu, action);
      }
      document.body.append(menu);
      menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector('button')?.focus();
      menu.addEventListener('keydown', (key) => {
        if (!['ArrowDown', 'ArrowUp'].includes(key.key)) {
          return;
        }
        key.preventDefault();
        const buttons = [...menu!.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[
          (index + (key.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      });
    });
  };
}
