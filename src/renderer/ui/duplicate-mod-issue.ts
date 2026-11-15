import type {
  MinecraftCrashIssue,
  MinecraftCrashRepair,
} from '../../shared/minecraft/crash-report-contract';
import { setUiText } from '../i18n/dialog-text';
import { setUserText } from '../i18n/ui-translator';

export function duplicateModIssue(
  issue: MinecraftCrashIssue,
  repairButton: (repair: MinecraftCrashRepair) => HTMLButtonElement,
  technicalDetails: HTMLElement,
): HTMLElement {
  const article = document.createElement('article');
  article.className = 'crash-issue crash-duplicate-issue is-' + issue.severity;
  const header = document.createElement('header');
  const title = document.createElement('h3');
  setUiText(title, 'Hay mods repetidos');
  header.append(title);
  const explanation = document.createElement('p');
  setUiText(
    explanation,
    'Minecraft solo puede usar una copia de cada mod. Desactiva las que no quieras usar.',
  );
  const list = document.createElement('div');
  list.className = 'crash-duplicate-copies';
  const advanced = document.createElement('details');
  advanced.className = 'crash-duplicate-advanced';
  const summary = document.createElement('summary');
  setUiText(summary, 'Información avanzada');
  const originalTitle = document.createElement('h4');
  setUiText(originalTitle, issue.title);
  const files = document.createElement('dl');
  files.className = 'crash-duplicate-files';
  issue.repairs
    .filter((repair) => repair.kind === 'disable-mod')
    .forEach((repair, index) => {
      const row = document.createElement('div');
      row.className = 'crash-mod-row';
      const identity = document.createElement('div');
      identity.className = 'crash-duplicate-copy';
      identity.id = 'crash-duplicate-copy-' + repair.id;
      const name = document.createElement('strong');
      if (repair.mod) {
        setUserText(name, repair.mod.name);
      } else {
        setUiText(name, 'Copia del mod');
      }
      const version = document.createElement('span');
      if (repair.mod?.version) {
        setUserText(version, repair.mod.version);
      } else {
        setUiText(version, 'Versión desconocida');
      }
      const minecraft = document.createElement('span');
      if (repair.mod?.gameVersion) {
        setUserText(minecraft, 'Minecraft ' + repair.mod.gameVersion);
      }
      const copy = document.createElement('small');
      setUiText(copy, 'Copia {0}'.replace('{0}', String(index + 1)));
      identity.append(name, version, minecraft, copy);
      const button = repairButton({
        ...repair,
        description: 'Se desactivará esta copia del mod. Puedes deshacer el cambio.',
      });
      setUiText(button, 'Desactivar esta copia');
      button.setAttribute('aria-describedby', identity.id);
      row.append(identity, button);
      list.append(row);
      const label = document.createElement('dt');
      setUiText(label, 'Copia {0}'.replace('{0}', String(index + 1)));
      const file = document.createElement('dd');
      setUserText(file, repair.label.replace(/^Desactivar\s+/u, ''));
      files.append(label, file);
    });
  technicalDetails.querySelector('summary')?.remove();
  advanced.append(summary, originalTitle, files, ...Array.from(technicalDetails.childNodes));
  const note = document.createElement('p');
  note.className = 'crash-duplicate-note';
  setUiText(note, 'Puedes deshacer los cambios si lo necesitas.');
  if (!list.childElementCount) {
    setUiText(explanation, 'Abre la información avanzada para revisar qué mod está repetido.');
    article.append(header, explanation, advanced);
  } else {
    article.append(header, explanation, list, note, advanced);
  }
  return article;
}
