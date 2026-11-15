import './laby-update-dialog.css';
import { setUiText } from '../i18n/dialog-text';
import type { BattlyClientUpdateNotice } from '../../shared/minecraft/battly-client-contract';
export function chooseLabyUpdate(): Promise<number> {
  return chooseUpdate();
}
export function chooseBattlyClientUpdate(notice: BattlyClientUpdateNotice): Promise<number> {
  return chooseUpdate(notice);
}
function chooseUpdate(notice?: BattlyClientUpdateNotice): Promise<number> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal is-active battly-ask-modal laby-update-modal';
    const card = document.createElement('div');
    card.className = 'modal-card modal-animated';
    const body = document.createElement('section');
    body.className = 'modal-card-body';
    const title = document.createElement('h2');
    title.className = 'title';
    title.id = notice ? 'battly-client-update-title' : 'labymod-update-title';
    setUiText(
      title,
      notice ? 'Hay una actualización de Battly Client' : 'Hay una actualización de LabyMod',
    );
    const text = document.createElement('p');
    text.className = 'subtitle';
    setUiText(
      text,
      'Puedes jugar con la versión instalada o actualizar antes de iniciar. La actualización en segundo plano se hará cuando cierres todas las partidas. Mantén Battly abierto.',
    );
    const footer = document.createElement('footer');
    footer.className = 'modal-card-foot';
    if (notice) {
      const versions = document.createElement('p');
      versions.className = 'subtitle';
      versions.textContent = `Minecraft ${notice.minecraftVersion}\n${notice.installedVersion} #${notice.installedBuild} → ${notice.clientVersion} #${notice.build}`;
      versions.style.whiteSpace = 'pre-line';
      body.append(title, versions);
      if (!notice.canUpdateNow) {
        const warning = document.createElement('p');
        warning.className = 'subtitle';
        setUiText(warning, 'Cierra las otras partidas para actualizar ahora.');
        body.append(warning);
      }
    }
    let settled = false;
    const finish = (choice: number) => {
      if (settled) {
        return;
      }
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(choice);
    };
    let defaultButton: HTMLButtonElement | undefined;
    ['Actualizar ahora', 'Iniciar versión instalada', 'Actualizar al cerrar Minecraft'].forEach(
      (label, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = index === 0 ? 'laby-choice laby-choice-primary' : 'laby-choice';
        button.dataset.choice = String(index);
        setUiText(button, label);
        button.onclick = () => finish(index);
        footer.append(button);
        if (index === 1) {
          defaultButton = button;
        }
        if (index === 0 && notice && !notice.canUpdateNow) {
          button.disabled = true;
        }
      },
    );
    if (!notice) {
      body.append(title);
    }
    body.append(text);
    card.append(body, footer);
    dialog.append(card);
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
    });
    document.body.append(dialog);
    dialog.showModal();
    defaultButton?.focus();
  });
}
