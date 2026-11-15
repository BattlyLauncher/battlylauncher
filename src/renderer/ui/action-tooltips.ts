/** One animated tooltip surface for dialog actions created now or later. */
export function bindActionTooltips(): void {
  const tooltip = document.createElement('div');
  tooltip.id = 'battly-action-tooltip';
  tooltip.className = 'battly-action-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('popover', 'manual');
  document.body.append(tooltip);
  let owner: HTMLElement | null = null;
  const hide = (): void => {
    tooltip.hidePopover();
    owner?.removeAttribute('aria-describedby');
    owner = null;
  };
  const show = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>(
      '[data-skin-dialog] button, [data-instances-dialog] button',
    );
    if (!button || button.matches(':disabled')) {
      return;
    }
    if (owner === button) {
      return;
    }
    const label =
      button.getAttribute('title') ||
      button.dataset.tooltip ||
      button.getAttribute('aria-label') ||
      button.textContent?.trim();
    if (!label) {
      return;
    }
    hide();
    owner = button;
    button.dataset.tooltip = label;
    button.classList.add('has-action-tooltip');
    button.removeAttribute('title');
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.textContent = label;
    tooltip.showPopover();
    const rect = button.getBoundingClientRect();
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, rect.left + (rect.width - bounds.width) / 2))}px`;
    tooltip.style.top = `${rect.top > bounds.height + 16 ? rect.top - bounds.height - 8 : rect.bottom + 8}px`;
  };
  document.addEventListener('pointerover', show);
  document.addEventListener('focusin', show);
  document.addEventListener('pointerout', (event) => {
    if (owner && !(event.relatedTarget instanceof Node && owner.contains(event.relatedTarget))) {
      hide();
    }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('click', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
    }
  });
}
