import { setUiText, translateUiText } from '../i18n/dialog-text';
import './mod-image-zoom.css';

export function bindModImageZoom(image: HTMLImageElement): void {
  image.tabIndex = 0;
  image.setAttribute('role', 'button');
  image.classList.add('mod-zoomable');
  const open = (): void => {
    if (!image.naturalWidth) {
      return;
    }
    const root = image.ownerDocument;
    const origin = image.getBoundingClientRect();
    const dialog = root.createElement('dialog');
    dialog.className = 'mod-image-zoom';
    dialog.setAttribute('aria-label', image.alt || translateUiText('Captura del proyecto'));
    const enlarged = root.createElement('img');
    enlarged.src = image.currentSrc || image.src;
    enlarged.width = image.naturalWidth;
    enlarged.height = image.naturalHeight;
    enlarged.alt = image.alt;
    enlarged.referrerPolicy = 'no-referrer';
    const close = root.createElement('button');
    close.type = 'button';
    setUiText(close, 'Cerrar');
    dialog.append(close, enlarged);
    root.body.append(dialog);
    dialog.showModal();
    const destination = enlarged.getBoundingClientRect();
    const reduced = root.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transform = `translate(${origin.x + origin.width / 2 - destination.x - destination.width / 2}px, ${origin.y + origin.height / 2 - destination.y - destination.height / 2}px) scale(${origin.width / Math.max(destination.width, 1)}, ${origin.height / Math.max(destination.height, 1)})`;
    const frames = [
      { transform, opacity: 0.3 },
      { transform: 'none', opacity: 1 },
    ];
    if (!reduced) {
      enlarged.animate(frames, { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    let closing = false;
    const dismiss = async (): Promise<void> => {
      if (closing) {
        return;
      }
      closing = true;
      if (!reduced) {
        await enlarged
          .animate([...frames].reverse(), { duration: 160, easing: 'ease-in' })
          .finished.catch(() => undefined);
      }
      dialog.close();
      dialog.remove();
      image.focus({ preventScroll: true });
    };
    close.onclick = () => void dismiss();
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) {
        void dismiss();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      void dismiss();
    });
  };
  image.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  image.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
}
