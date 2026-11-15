type PendingTransition = { cancel: () => void };

/** Animate the actual card dimensions in both directions, then restore responsive sizing. */
export class DownloadPanelTransition {
  private pending: PendingTransition | undefined;
  private size: { width: number; height: number } | undefined;

  constructor(private readonly panel: HTMLElement | null) {
    if (!panel) {
      return;
    }
    // Cached lists still arrive asynchronously; animate their final size too.
    let contentHeight: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || contentHeight === entry.contentRect.height) {
        return;
      }
      contentHeight = entry.contentRect.height;
      if (this.pending) {
        const style = getComputedStyle(panel);
        const extraHeight = [
          'padding-top',
          'padding-bottom',
          'border-top-width',
          'border-bottom-width',
        ].reduce((sum, property) => sum + (parseFloat(style.getPropertyValue(property)) || 0), 0);
        const content = entry.target.getBoundingClientRect();
        // Lists can finish loading mid-transition. Retarget only if their natural
        // height changed, rather than reacting to each frame of our own resize.
        if (Math.abs(content.height + extraHeight - (this.size?.height ?? 0)) > 1) {
          this.run(() => {});
        }
      } else {
        this.run(() => {}, this.size);
      }
    });
    observer.observe(panel.querySelector('.download-panel') ?? panel);
    window.addEventListener('resize', () => {
      this.reset();
      this.size = panel.getBoundingClientRect();
    });
  }

  reset(): void {
    this.pending?.cancel();
    this.pending = undefined;
  }

  run(update: () => void, previousSize?: { width: number; height: number }): void {
    const panel = this.panel;
    const before = previousSize ?? panel?.getBoundingClientRect();
    this.reset();
    update();
    const after = panel?.getBoundingClientRect();
    this.size = after;
    if (
      !panel ||
      !after ||
      !after.width ||
      !after.height ||
      !before?.width ||
      !before.height ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    if (Math.abs(before.width - after.width) < 1 && Math.abs(before.height - after.height) < 1) {
      return;
    }
    const properties = ['width', 'height', 'transition', 'overflow'] as const;
    const original = properties.map((name) => ({
      name,
      value: panel.style.getPropertyValue(name),
      priority: panel.style.getPropertyPriority(name),
    }));
    panel.style.setProperty('transition', 'none');
    panel.style.setProperty('overflow', 'hidden');
    panel.style.setProperty('width', before.width + 'px', 'important');
    panel.style.setProperty('height', before.height + 'px', 'important');
    void panel.offsetHeight;
    panel.style.setProperty('transition', 'width 500ms ease-in-out, height 500ms ease-in-out');
    panel.style.setProperty('width', after.width + 'px', 'important');
    panel.style.setProperty('height', after.height + 'px', 'important');
    const cleanup = (): void => {
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      window.removeEventListener('resize', cleanup);
      // Clear the transition before returning to auto dimensions.
      panel.style.setProperty('transition', 'none');
      for (const property of original) {
        if (property.name === 'transition') {
          continue;
        }
        if (property.value) {
          panel.style.setProperty(property.name, property.value, property.priority);
        } else {
          panel.style.removeProperty(property.name);
        }
      }
      void panel.offsetHeight;
      const transition = original.find((property) => property.name === 'transition')!;
      if (transition.value) {
        panel.style.setProperty('transition', transition.value, transition.priority);
      } else {
        panel.style.removeProperty('transition');
      }
      if (this.pending?.cancel === cleanup) {
        this.pending = undefined;
      }
    };
    const onEnd = (event: TransitionEvent): void => {
      if (
        event.target === panel &&
        (event.propertyName === 'height' || event.propertyName === 'width')
      ) {
        cleanup();
      }
    };
    const timer = setTimeout(cleanup, 550);
    this.pending = { cancel: cleanup };
    panel.addEventListener('transitionend', onEnd);
    window.addEventListener('resize', cleanup, { once: true });
  }
}
