export function bindReleaseNews(panel: HTMLElement, complete: () => Promise<unknown>): void {
  const slides = [...panel.querySelectorAll<HTMLElement>('[data-news-slide]')];
  const steps = [...panel.querySelectorAll<HTMLButtonElement>('[data-news-step]')];
  const back = panel.querySelector<HTMLButtonElement>('[data-news-back]');
  const next = panel.querySelector<HTMLButtonElement>('[data-news-next]');
  const finish = panel.querySelector<HTMLButtonElement>('[data-news-finish]');
  const progress = panel.querySelector<HTMLElement>('[role="progressbar"]');
  const bar = panel.querySelector<HTMLElement>('[data-news-progress]');
  const status = panel.querySelector<HTMLElement>('[data-news-status]');
  let current = 0;
  let transitioning = false;
  let saving = false;
  if (!slides.length) {
    return;
  }

  const render = (): void => {
    slides.forEach((slide, index) => {
      slide.hidden = index !== current;
    });
    steps.forEach((step, index) => {
      if (index === current) {
        step.setAttribute('aria-current', 'step');
      } else {
        step.removeAttribute('aria-current');
      }
      step.classList.toggle('is-complete', index < current);
      step.disabled = saving;
    });
    if (back) {
      back.disabled = current === 0 || saving;
    }
    if (next) {
      next.hidden = current === slides.length - 1;
      next.disabled = saving;
      const label = next.querySelector('span');
      if (label) {
        label.textContent = current === 0 ? 'Descubrir novedades' : 'Siguiente';
      }
    }
    if (finish) {
      finish.hidden = current !== slides.length - 1;
      finish.disabled = saving;
    }
    progress?.setAttribute('aria-valuemax', String(slides.length));
    progress?.setAttribute('aria-valuenow', String(current + 1));
    if (bar) {
      bar.style.width = `${((current + 1) / slides.length) * 100}%`;
    }
    if (status) {
      status.dataset.error = 'false';
      status.textContent = slides[current].getAttribute('aria-label');
    }
  };

  const goTo = async (index: number): Promise<void> => {
    if (transitioning || saving || index === current || index < 0 || index >= slides.length) {
      return;
    }
    transitioning = true;
    const outgoing = slides[current];
    const direction = index > current ? 1 : -1;
    const focusWasInSlide = outgoing.contains(document.activeElement);
    const focusWasNext = document.activeElement === next;
    const focusWasBack = document.activeElement === back;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      outgoing.classList.remove('is-entering');
      if (!reduced) {
        await outgoing.animate(
          [
            { opacity: 1, transform: 'translateX(0)' },
            { opacity: 0, transform: `translateX(${-direction * 18}px)` },
          ],
          { duration: 120, easing: 'ease-in' },
        ).finished;
      }
      current = index;
      render();
      const incoming = slides[current];
      incoming.scrollTop = 0;
      incoming.classList.add('is-entering');
      if (focusWasInSlide) {
        incoming.focus({ preventScroll: true });
      } else if (focusWasNext && next?.hidden) {
        finish?.focus({ preventScroll: true });
      } else if (focusWasBack && back?.disabled) {
        next?.focus({ preventScroll: true });
      }
      if (!reduced) {
        await incoming.animate(
          [
            { opacity: 0, transform: `translateX(${direction * 28}px) scale(.985)` },
            { opacity: 1, transform: 'translateX(0) scale(1)' },
          ],
          { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' },
        ).finished;
      }
    } catch {
      // An interrupted animation must never block the navigation controls.
      render();
    } finally {
      transitioning = false;
    }
  };

  steps.forEach((step, index) => step.addEventListener('click', () => void goTo(index)));
  back?.addEventListener('click', () => void goTo(current - 1));
  next?.addEventListener('click', () => void goTo(current + 1));
  panel.addEventListener('keydown', (event) => {
    const target = event.target;
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select')))
    ) {
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    void goTo(current + (event.key === 'ArrowRight' ? 1 : -1));
  });

  const finishNews = async (): Promise<void> => {
    if (!finish || saving || transitioning || current !== slides.length - 1) {
      return;
    }
    saving = true;
    render();
    const label = finish.querySelector('span');
    if (label) {
      label.textContent = 'Guardando…';
    }
    try {
      await complete();
    } catch {
      if (status) {
        status.dataset.error = 'true';
        status.textContent = 'No se pudo guardar. Vuelve a intentarlo.';
      }
    } finally {
      saving = false;
      if (back) {
        back.disabled = current === 0;
      }
      steps.forEach((step) => {
        step.disabled = false;
      });
      finish.disabled = false;
      if (label) {
        label.textContent = '¡Vamos a jugar!';
      }
    }
  };
  finish?.addEventListener('click', () => void finishNews());
  render();
  slides[current].classList.add('is-entering');
}
