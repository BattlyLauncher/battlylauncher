import { instanceCopyParts, type InstanceSummary } from '../../shared/minecraft/instance';
import { translateUiText } from '../i18n/dialog-text';
import { openBypackFlow } from './bypack-panel';

const copyLabels = {
  mods: 'Mods',
  settings: 'Ajustes del juego y configuración de mods',
  worlds: 'Mundos',
  resourcepacks: 'Paquetes de recursos',
  shaderpacks: 'Shaders',
  screenshots: 'Capturas',
  servers: 'Servidores guardados',
} as const;

function actionDialog(title: string, instance: InstanceSummary): HTMLDialogElement {
  const previous = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'bypack-dialog instance-action-dialog';
  const heading = document.createElement('h2');
  heading.textContent = translateUiText(title);
  dialog.setAttribute('aria-label', heading.textContent);
  const name = document.createElement('p');
  name.textContent = instance.name;
  dialog.append(heading, name);
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    },
    { once: true },
  );
  return dialog;
}

function actionButton(title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = translateUiText(title);
  return button;
}

export function chooseInstanceExport(instance: InstanceSummary): void {
  const dialog = actionDialog('Exportar instancia', instance);
  const options = document.createElement('div');
  options.className = 'instance-export-options';
  const bypack = actionButton('ByPack (.bypack)');
  const mrpack = actionButton('Modrinth (.mrpack)');
  const cancel = actionButton('Cancelar');
  const footer = document.createElement('footer');
  footer.append(cancel);
  const addOption = (button: HTMLButtonElement, description: string): void => {
    const detail = document.createElement('small');
    detail.textContent = translateUiText(description);
    button.append(detail);
    options.append(button);
  };
  addOption(bypack, 'Para importar en Battly.');
  addOption(mrpack, 'Para importar en Prism Launcher, Modrinth App o Battly.');
  bypack.onclick = () => {
    dialog.close();
    void openBypackFlow(instance);
  };
  mrpack.onclick = () => {
    dialog.close();
    void openBypackFlow(instance, undefined, (id) => window.battly.exportMrpack(id), 'mrpack');
  };
  cancel.onclick = () => dialog.close();
  dialog.append(options, footer);
  document.body.append(dialog);
  dialog.showModal();
}

export function openInstanceCopy(
  instance: InstanceSummary,
  onCopied: (copy: InstanceSummary) => void,
): void {
  const dialog = actionDialog('Duplicar instancia', instance);
  const form = document.createElement('form');
  const nameLabel = document.createElement('label');
  nameLabel.textContent = translateUiText('Nombre de la instancia');
  const name = document.createElement('input');
  name.className = 'input';
  name.required = true;
  name.maxLength = 128;
  const suffix = ` (${translateUiText('Copia')})`;
  name.value = instance.name.slice(0, name.maxLength - suffix.length) + suffix;
  nameLabel.append(name);
  const choices = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = translateUiText('Qué quieres copiar');
  choices.append(legend);
  const checks = instanceCopyParts.map((part) => {
    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = part;
    check.checked = part !== 'worlds' && part !== 'screenshots';
    label.append(check, translateUiText(copyLabels[part]));
    choices.append(label);
    return { part, check };
  });
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const cancel = actionButton('Cancelar');
  const submit = actionButton('Duplicar');
  submit.type = 'submit';
  submit.className = 'instance-action-primary';
  const footer = document.createElement('footer');
  footer.append(cancel, submit);
  let pending = false;
  cancel.onclick = () => dialog.close();
  dialog.addEventListener('cancel', (event) => {
    if (pending) {
      event.preventDefault();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    pending = true;
    name.disabled = choices.disabled = cancel.disabled = submit.disabled = true;
    status.textContent = translateUiText('Copiando la instancia…');
    void window.battly
      .duplicateInstance(instance.id, {
        name: name.value.trim(),
        parts: checks.filter(({ check }) => check.checked).map(({ part }) => part),
      })
      .then(
        (copy) => {
          dialog.close();
          onCopied(copy);
        },
        (error: unknown) => {
          status.textContent =
            error instanceof Error
              ? translateUiText(
                  error.message.replace(
                    /^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/,
                    '',
                  ),
                )
              : translateUiText('No se pudo duplicar la instancia.');
        },
      )
      .finally(() => {
        pending = false;
        name.disabled = choices.disabled = cancel.disabled = submit.disabled = false;
      });
  });
  form.append(nameLabel, choices, status, footer);
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  name.select();
}
