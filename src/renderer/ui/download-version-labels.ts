/** Measure at 16px, then use exactly 12px only when the full name does not fit. */
export function fitDownloadVersionLabels(root: HTMLElement): void {
  const selector =
    '[data-download-versions] .texto, [data-download-loader-versions] .texto, [data-download-labymod-versions] .texto, [data-download-battly-client-versions] .texto';
  let frame = 0;
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const texts = [...root.querySelectorAll<HTMLElement>(selector)].filter(
        (text) => text.getClientRects().length > 0,
      );
      // Reset all names before measuring: interleaving writes and reads forces
      // a full layout for every version in Fabric's long catalogue.
      for (const text of texts) {
        text.classList.remove('version-name-small');
      }
      const overflowing = texts.map((text) => text.scrollWidth > text.clientWidth);
      texts.forEach((text, index) => {
        text.classList.toggle('version-name-small', overflowing[index]);
        text.title = text.textContent ?? '';
      });
    });
  };
  const resize = new ResizeObserver(schedule);
  const observe = (): void => {
    resize.disconnect();
    root.querySelectorAll<HTMLElement>(selector).forEach((text) => {
      if (text.parentElement) {
        resize.observe(text.parentElement);
      }
    });
    schedule();
  };
  new MutationObserver(observe).observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  document.fonts.addEventListener('loadingdone', schedule);
  void document.fonts.ready.then(schedule);
  observe();
}
