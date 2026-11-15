/** Native top-layer popovers escape the launch modal's scrolling/clipping area. */
export function bindPlaySortPopover(
  root: Document = document,
  scope: 'play' | 'instances' = 'play',
): void {
  const panel = root.querySelector<HTMLElement>(`[data-${scope}-sort-menu]`);
  const button = root.querySelector<HTMLButtonElement>(`[data-${scope}-sort-toggle]`);
  if (!panel || !button) {
    return;
  }
  const place = (): void => {
    if (!panel.matches(':popover-open')) {
      return;
    }
    const anchor = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const viewport = root.documentElement;
    const left = Math.max(
      12,
      Math.min(anchor.right - bounds.width, viewport.clientWidth - bounds.width - 12),
    );
    const below = anchor.bottom + 8;
    const top =
      below + bounds.height <= viewport.clientHeight - 12
        ? below
        : Math.max(12, anchor.top - bounds.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  panel.addEventListener('toggle', () => {
    const open = panel.matches(':popover-open');
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      place();
    }
  });
  button.setAttribute('aria-expanded', 'false');
  root.defaultView?.addEventListener('resize', place);
  root.addEventListener('scroll', place, true);
  root.addEventListener('animationend', place, true);
  root.addEventListener('transitionend', place, true);
}
