import type { MenuItemConstructorOptions } from 'electron';

import type { MusicControlAction, MusicPlaybackState } from '../../shared/music/music-contract';

export interface MusicTrayActions {
  readonly send: (action: MusicControlAction) => void;
  readonly showBattly: () => void;
  readonly quitBattly: () => void;
}

export function musicTrayTooltip(state: MusicPlaybackState): string {
  return state.title ? `${state.title} · ${state.artist}` : 'Battly Music';
}

export function musicTrayTemplate(
  state: MusicPlaybackState,
  actions: MusicTrayActions,
  translate: (source: string) => string = (source) => source,
): readonly MenuItemConstructorOptions[] {
  return [
    { label: state.title || 'Battly Music', enabled: false },
    { label: state.artist || translate('Nada reproduciéndose'), enabled: false },
    { type: 'separator' },
    { label: translate('Anterior'), click: () => actions.send('previous') },
    {
      label: translate(state.playing ? 'Pausar' : 'Reproducir'),
      click: () => actions.send('play-pause'),
    },
    { label: translate('Siguiente'), click: () => actions.send('next') },
    { type: 'separator' },
    { label: translate('Mostrar Battly'), click: actions.showBattly },
    { type: 'separator' },
    { label: translate('Cerrar Battly'), click: actions.quitBattly },
  ];
}
