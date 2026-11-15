/** Only visible covers load media. Free accounts see a still frame, never playback. */
export class MarketplaceMedia {
  private cleanups: Array<() => void> = [];
  private root: HTMLElement | null = null;
  private frame = 0;
  private covers: Array<{ cover: HTMLElement; show: (visible: boolean) => void }> = [];
  private schedule = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.root) {
        return;
      }
      const viewport = this.root.getBoundingClientRect();
      for (const { cover, show } of this.covers) {
        const bounds = cover.getBoundingClientRect();
        show(bounds.bottom > viewport.top && bounds.top < viewport.bottom && bounds.width > 0);
      }
    });
  };

  reset(root: HTMLElement): void {
    this.stop();
    this.root = root;
    root.addEventListener('scroll', this.schedule, { passive: true });
    window.addEventListener('resize', this.schedule);
  }

  add(cover: HTMLElement, url: string, premium: boolean, hoverPlayback = false): void {
    const video = /\.(mp4|webm)(?:[?#]|$)/i.test(url);
    let media: HTMLImageElement | HTMLVideoElement | null = null;
    let poster: HTMLCanvasElement | null = null;
    let hovered = false;
    let inView = false;
    const stop = (): void => {
      if (media instanceof HTMLVideoElement) {
        media.pause();
      }
      media?.removeAttribute('src');
      if (media instanceof HTMLVideoElement) {
        media.load();
      }
      media?.remove();
      media = null;
      cover.querySelector('canvas')?.remove();
    };
    const show = (visible: boolean): void => {
      inView = visible;
      if (!visible) {
        stop();
        return;
      }
      if (poster && (!premium || (hoverPlayback && !hovered))) {
        cover.prepend(poster);
        return;
      }
      if (media) {
        return;
      }
      const element = video ? document.createElement('video') : document.createElement('img');
      media = element;
      if (element instanceof HTMLVideoElement) {
        element.muted = true;
        element.loop = true;
        element.playsInline = true;
        element.preload = 'auto';
      } else {
        element.alt = '';
        element.decoding = 'async';
      }
      element.addEventListener(
        video ? 'loadeddata' : 'load',
        () => {
          if (media !== element) {
            return;
          }
          if (!premium || (hoverPlayback && !hovered)) {
            const canvas = document.createElement('canvas');
            const width =
              element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
            const height =
              element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
            const scale = Math.min(1, 360 / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
            poster = canvas;
            cover.prepend(canvas);
            element.removeAttribute('src');
            element.remove();
            if (element instanceof HTMLVideoElement) {
              element.load();
            }
          } else if (element instanceof HTMLVideoElement) {
            void element.play().catch(() => undefined);
          }
        },
        { once: true },
      );
      element.addEventListener(
        'error',
        () => {
          if (media === element) {
            stop();
          }
        },
        { once: true },
      );
      element.src = url;
      cover.prepend(element);
    };
    if (premium && hoverPlayback) {
      const card = cover.parentElement ?? cover;
      const enter = (): void => {
        hovered = true;
        if (inView) {
          stop();
          show(true);
        }
      };
      const leave = (): void => {
        hovered = false;
        if (inView) {
          stop();
          show(true);
        }
      };
      card.addEventListener('pointerenter', enter);
      card.addEventListener('pointerleave', leave);
      card.addEventListener('focusin', enter);
      card.addEventListener('focusout', leave);
      this.cleanups.push(() => {
        card.removeEventListener('pointerenter', enter);
        card.removeEventListener('pointerleave', leave);
        card.removeEventListener('focusin', enter);
        card.removeEventListener('focusout', leave);
      });
    }
    this.cleanups.push(stop);
    this.covers.push({ cover, show });
    this.schedule();
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.root?.removeEventListener('scroll', this.schedule);
    window.removeEventListener('resize', this.schedule);
    this.root = null;
    this.covers = [];
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
  }
}
