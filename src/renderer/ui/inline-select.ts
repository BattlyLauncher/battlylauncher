let nextId = 0;

/** In-window picker: never creates an OS popup behind an always-on-top overlay. */
export function mountInlineSelect(select: HTMLSelectElement): () => void {
  const wrapper = document.createElement('div');
  wrapper.className = 'bw-inline-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'bw-inline-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  const caption = document.createElement('span');
  caption.className = 'bw-inline-select-caption';
  trigger.append(caption);
  const list = document.createElement('div');
  list.className = 'bw-inline-select-options';
  list.id = `bw-inline-options-${++nextId}`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', select.getAttribute('aria-label') || 'Micrófono');
  trigger.setAttribute('aria-controls', list.id);
  wrapper.append(trigger, list);
  select.hidden = true;
  select.after(wrapper);
  const close = (focus = false): void => {
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) {
      trigger.focus();
    }
  };
  const options = (): HTMLButtonElement[] => [
    ...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
  const refresh = (): void => {
    caption.textContent =
      select.selectedOptions[0]?.textContent || select.options[0]?.textContent || '';
    trigger.title = caption.textContent;
    trigger.setAttribute(
      'aria-label',
      `${select.getAttribute('aria-label') || 'Micrófono'}: ${caption.textContent}`,
    );
    trigger.disabled = select.disabled;
    list.replaceChildren();
    for (const option of select.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.tabIndex = -1;
      item.disabled = option.disabled;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      const label = document.createElement('span');
      label.className = 'bw-inline-select-option-label';
      label.textContent = option.textContent;
      item.append(label);
      item.title = option.textContent || '';
      item.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
        close(true);
      });
      list.append(item);
    }
    close();
  };
  const open = (): void => {
    if (trigger.disabled) {
      return;
    }
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (
      list.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)') || options()[0]
    )?.focus();
  };
  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (event) => {
    const items = options(),
      index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') {
      next = Math.min(items.length - 1, index + 1);
    }
    if (event.key === 'ArrowUp') {
      next = Math.max(0, index - 1);
    }
    if (event.key === 'Home') {
      next = 0;
    }
    if (event.key === 'End') {
      next = items.length - 1;
    }
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  wrapper.addEventListener('focusout', (event) => {
    if (!wrapper.contains(event.relatedTarget as Node | null)) {
      close();
    }
  });
  select.addEventListener('change', refresh);
  refresh();
  return refresh;
}
