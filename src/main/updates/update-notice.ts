import { Notification } from 'electron';
import type { UpdateSnapshot } from '../../shared/updates';

export function createUpdateNotifier(options: {
  text: (source: string) => string;
  icon: string;
  open: (action: 'open' | 'restart') => void;
  later: () => void;
}): { ready: (snapshot: UpdateSnapshot) => void; close: () => void } {
  let current: Notification | undefined;
  const close = (): void => {
    current?.close();
    current = undefined;
  };
  return {
    close,
    ready(snapshot) {
      close();
      if (!Notification.isSupported()) {
        return;
      }
      const notice = new Notification({
        title: options.text('Actualización lista para reiniciar Battly.'),
        body: [
          snapshot.target,
          options.text('Actualización preparada. Reinicia Battly para aplicarla.'),
        ]
          .filter(Boolean)
          .join('\n'),
        icon: options.icon,
        actions:
          process.platform === 'linux'
            ? []
            : [
                { type: 'button', text: options.text('Reiniciar') },
                { type: 'button', text: options.text('Recuérdamelo más tarde') },
              ],
      });
      current = notice;
      notice.on('click', () => options.open('open'));
      notice.on('action', (details) => {
        if (details.actionIndex === 0) {
          options.open('restart');
        }
        if (details.actionIndex === 1) {
          options.later();
        }
        notice.close();
      });
      notice.on('failed', () => {
        if (current === notice) {
          current = undefined;
        }
      });
      notice.show();
    },
  };
}
