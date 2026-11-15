import { setUiText, translateUiText } from '../i18n/dialog-text';
import { askBattly } from './ask-modal';

interface SelectionItem {
  readonly id: string;
  readonly name: string;
  readonly enabled?: boolean;
}
interface SelectionOptions {
  readonly items: readonly SelectionItem[];
  readonly archive: (id: string) => Promise<unknown>;
  readonly toggle?: (id: string) => Promise<unknown>;
  readonly refresh: () => Promise<void>;
}

export function clearMyBattlySelection(table: HTMLTableElement): void {
  table.parentElement?.querySelector('.b-mybattly-selection')?.remove();
  table.querySelector('[data-selection-heading]')?.remove();
}

/** Uses the same recoverable operations as the individual row actions. */
export function mountMyBattlySelection(table: HTMLTableElement, options: SelectionOptions): void {
  clearMyBattlySelection(table);
  if (!options.items.length) {
    return;
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'b-mybattly-selection';
  const count = document.createElement('span');
  count.setAttribute('aria-live', 'polite');
  const selected = new Set<string>();
  const all = document.createElement('input');
  all.type = 'checkbox';
  all.setAttribute('aria-label', translateUiText('Seleccionar todo'));
  const headerRow = table.tHead?.rows[0];
  headerRow?.querySelector('[data-selection-heading]')?.remove();
  const heading = document.createElement('th');
  heading.dataset.selectionHeading = '';
  heading.append(all);
  headerRow?.prepend(heading);
  const buttons: HTMLButtonElement[] = [];
  const checks: HTMLInputElement[] = [];
  const update = (): void => {
    count.textContent = `${selected.size} / ${options.items.length}`;
    all.checked = selected.size === options.items.length;
    all.indeterminate = selected.size > 0 && !all.checked;
    buttons.forEach((button) => (button.disabled = selected.size === 0));
    checks.forEach((check, index) => {
      check.checked = selected.has(options.items[index].id);
      check.closest('tr')?.classList.toggle('is-selected', check.checked);
    });
  };
  [...(table.tBodies[0]?.rows ?? [])].forEach((row, index) => {
    const item = options.items[index];
    if (!item) {
      return;
    }
    const cell = document.createElement('td');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', item.name);
    check.onchange = () => {
      if (check.checked) {
        selected.add(item.id);
      } else {
        selected.delete(item.id);
      }
      update();
    };
    checks.push(check);
    cell.append(check);
    row.prepend(cell);
  });
  all.onchange = () => {
    selected.clear();
    if (all.checked) {
      options.items.forEach((item) => selected.add(item.id));
    }
    update();
  };
  let busy = false;
  const addAction = (label: string, enabled?: boolean): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button is-small is-outlined';
    setUiText(button, label);
    button.onclick = async () => {
      if (busy || !selected.size) {
        return;
      }
      busy = true;
      try {
        const items = options.items.filter((item) => selected.has(item.id));
        if (
          enabled === undefined &&
          !(await askBattly({
            text: translateUiText(
              'Los elementos seleccionados se moverán al archivo recuperable. ¿Continuar?',
            ),
          }))
        ) {
          return;
        }
        toolbar.setAttribute('aria-busy', 'true');
        [...toolbar.querySelectorAll('button'), ...table.querySelectorAll('button,input')].forEach(
          (control) => ((control as HTMLButtonElement).disabled = true),
        );
        let failed = 0;
        for (const [index, item] of items.entries()) {
          count.textContent = `${index + 1} / ${items.length}`;
          try {
            if (enabled === undefined) {
              await options.archive(item.id);
            } else if (item.enabled !== enabled) {
              await options.toggle?.(item.id);
            }
          } catch {
            failed++;
          }
        }
        await options.refresh();
        if (failed) {
          const error = document.createElement('p');
          error.className = 'b-mybattly-selection-error';
          error.setAttribute('role', 'alert');
          setUiText(error, 'No se pudieron guardar los cambios. Inténtalo de nuevo.');
          table.parentElement?.querySelector('.b-mybattly-selection-error')?.remove();
          table.before(error);
        }
      } finally {
        busy = false;
        toolbar.removeAttribute('aria-busy');
        table
          .querySelectorAll('button,input')
          .forEach((control) => ((control as HTMLButtonElement).disabled = false));
        update();
      }
    };
    buttons.push(button);
    toolbar.append(button);
  };
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'button is-small is-outlined b-mybattly-select-all';
  // Keep the select-all control in the table header, with its label in the toolbar.
  setUiText(label, 'Seleccionar todo');
  label.onclick = () => {
    if (!busy) {
      all.click();
    }
  };
  toolbar.append(label, count);
  if (options.toggle) {
    addAction('Activar', true);
    addAction('Desactivar', false);
  }
  addAction('Eliminar');
  table.before(toolbar);
  update();
}
