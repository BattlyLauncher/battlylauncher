import { privateStorage } from '../private-storage';
/** Increment only when a future release deliberately introduces a new welcome. */
import battlyLogo from '../assets/battly-logo.png';
import { PremiumWelcomeAudio } from './premium-audio';
import { renderAppTitle } from './app-title';
const welcomeVersion = '4';
const seenThisSession = new Set<string>();
const active = new WeakMap<Document, { accountId: string; cancel: () => void }>();

export interface AdvertisementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function presentPremiumWelcome(
  accountId: string | null,
  advertisements: readonly AdvertisementBounds[],
  root: Document = document,
): void {
  // Startup owns the screen (and sound); keep the Plus greeting pending until later.
  if (
    root.body.hasAttribute('data-startup-pending') ||
    root.body.classList.contains('release-welcome-pending') ||
    root.body.classList.contains('og-intro-pending')
  ) {
    return;
  }
  const current = active.get(root);
  if (current?.accountId === accountId) {
    return;
  }
  current?.cancel();
  if (!accountId || !root.defaultView) {
    return;
  }
  const view = root.defaultView;
  const key = `battly:plus-welcome:${welcomeVersion}:${accountId}`;
  if (seenThisSession.has(key)) {
    return;
  }
  try {
    if (privateStorage.getItem(key) === 'seen') {
      return;
    }
  } catch {
    /* Session fallback. */
  }

  let timer: ReturnType<typeof setTimeout>;
  let overlay: HTMLElement | undefined;
  const sound = new PremiumWelcomeAudio();
  const impacts: Animation[] = [];
  const stages: ReturnType<typeof setTimeout>[] = [];
  const previousFocus = root.activeElement;
  const title = root.querySelector<HTMLElement>('[data-app-info]');
  const dismiss = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      cancel();
    }
  };
  const cancel = (): void => {
    clearTimeout(timer);
    sound.dispose();
    stages.forEach(clearTimeout);
    impacts.forEach((animation) => animation.cancel());
    const heldFocus = overlay?.contains(root.activeElement);
    overlay?.remove();
    root.querySelector('.titlebar')?.classList.remove('plus-welcome-shine');
    delete root.body.dataset.plusWelcomeStage;
    if (title && root.body.dataset.battlyPlus === 'true') {
      renderAppTitle(root);
    }
    root.removeEventListener('keydown', dismiss);
    active.delete(root);
    if (heldFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus();
    }
  };
  active.set(root, { accountId, cancel });
  if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.body.dataset.plusWelcomeStage = 'waiting';
    if (title) {
      renderAppTitle(root, false);
    }
  }

  const start = (): void => {
    // Never spend the one-time welcome behind the startup loader or another dialog.
    const loader = root.querySelector<HTMLElement>('[data-panel-loader]');
    if (
      root.visibilityState === 'hidden' ||
      (loader && !loader.hidden) ||
      root.querySelector('dialog[open]')
    ) {
      timer = setTimeout(start, 250);
      return;
    }
    if (root.body.dataset.battlyPlus !== 'true') {
      cancel();
      return;
    }
    seenThisSession.add(key);
    try {
      privateStorage.setItem(key, 'seen');
    } catch {
      /* Avoid replaying within this session. */
    }
    const reduced = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    overlay = root.createElement('div');
    overlay.className = 'plus-welcome';
    overlay.innerHTML = /* HTML */ `<div class="plus-welcome-controls">
      <button
        class="plus-sound"
        type="button"
        aria-label="Silenciar bienvenida"
        aria-pressed="false"
      >
        Silenciar</button
      ><button
        class="plus-skip"
        type="button"
        aria-label="Saltar bienvenida Battly+"
      >
        Saltar
      </button>
    </div>`;
    overlay.querySelector('.plus-skip')!.addEventListener('click', cancel);
    const mute = overlay.querySelector<HTMLButtonElement>('.plus-sound')!;
    mute.addEventListener('click', () => {
      const muted = sound.toggleMute();
      mute.textContent = muted ? 'Activar sonido' : 'Silenciar';
      mute.setAttribute(
        'aria-label',
        muted ? 'Activar sonido de bienvenida' : 'Silenciar bienvenida',
      );
      mute.setAttribute('aria-pressed', String(muted));
    });
    const showNotice = (): void => {
      if (!overlay) {
        return;
      }
      root.body.dataset.plusWelcomeStage = 'message';
      overlay.querySelector('.plus-skip')?.remove();
      const notice = root.createElement('aside');
      notice.className = 'plus-welcome-notice';
      notice.innerHTML = /* HTML */ `<img
          src="${battlyLogo}"
          alt=""
        />
        <div role="status">
          <strong>Battly+</strong>
          <p>Anuncios eliminados</p>
        </div>
        <button
          type="button"
          aria-label="Cerrar bienvenida Battly+"
        >
          ✕
        </button>`;
      notice.querySelector('button')!.addEventListener('click', cancel);
      overlay.append(notice);
    };
    let totalDuration = 3500;
    if (!reduced) {
      root.body.dataset.plusWelcomeStage = 'explosion';
      sound.play('fuse');
      stages.push(setTimeout(() => sound.play('explosion'), 1000));
      // Move the entire launcher together without replacing existing panel transforms.
      // Individual translate + additive composition also preserves window controls.
      const shake = [
        [0, 0],
        [-3, 2],
        [14, -9],
        [-12, 7],
        [10, 6],
        [-9, -5],
        [7, -4],
        [-5, 4],
        [4, 2],
        [-3, -2],
        [1, 1],
        [0, 0],
      ].map(([x, y]) => ({ translate: `${x}px ${y}px` }));
      for (const element of root.body.children) {
        if (!(element instanceof HTMLElement) || element.classList.contains('plus-welcome')) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) {
          continue;
        }
        impacts.push(
          element.animate(shake, {
            duration: 650,
            delay: 1000,
            easing: 'linear',
            composite: 'add',
          }),
        );
      }
      const bounds = advertisements.length
        ? advertisements.slice(0, 8)
        : [
            {
              x: (view.innerWidth - Math.min(260, view.innerWidth - 40)) / 2,
              y: Math.max(90, view.innerHeight * 0.35),
              width: Math.min(260, view.innerWidth - 40),
              height: 105,
            },
          ];
      const headerAt = 2600 + (bounds.length - 1) * 80;
      stages.push(
        setTimeout(() => {
          if (!overlay) {
            return;
          }
          overlay.querySelectorAll('.plus-ad-burst').forEach((burst) => burst.remove());
          root.body.dataset.plusWelcomeStage = 'header';
          sound.play('upgrade');
          if (title) {
            renderAppTitle(root);
          }
          root.querySelector('.titlebar')?.classList.add('plus-welcome-shine');
        }, headerAt),
      );
      stages.push(setTimeout(showNotice, headerAt + 1700));
      totalDuration = headerAt + 5200;
      for (const [index, rect] of bounds.entries()) {
        const burst = root.createElement('div');
        burst.className = 'plus-ad-burst';
        burst.setAttribute('aria-hidden', 'true');
        const width = Math.min(rect.width, view.innerWidth - 32, 400);
        const height = Math.min(rect.height, 180);
        burst.style.left = `${Math.max(16, Math.min(rect.x, view.innerWidth - width - 16))}px`;
        burst.style.top = `${Math.max(52, Math.min(rect.y, view.innerHeight - height - 24))}px`;
        burst.style.width = `${width}px`;
        burst.style.height = `${height}px`;
        burst.style.setProperty('--burst-delay', `${index * 80}ms`);
        // Purely decorative stand-ins: never resurrect or load a real advertisement.
        burst.innerHTML = /* HTML */ `<div class="plus-ad-ghost">
            <span>PUBLICIDAD</span><i></i><i></i><i></i>
          </div>
          <svg
            class="plus-creeper"
            viewBox="0 0 16 24"
            shape-rendering="crispEdges"
          >
            <path
              fill="#65b643"
              d="M4 0h8v8H4zM6 8h4v10H6zM4 18h4v6H4zM8 18h4v6H8z"
            />
            <path
              fill="#93d765"
              d="M4 0h3v2H4zM9 2h3v2H9zM6 9h2v4H6zM8 15h2v3H8zM4 20h2v2H4z"
            />
            <path
              fill="#24351f"
              d="M5 2h2v2H5zM9 2h2v2H9zM7 4h2v3H7zM6 5h1v3H6zM9 5h1v3H9zM4 23h4v1H4zM8 23h4v1H8z"
            />
          </svg>
          <div class="plus-impact-flare"></div>
          <div class="plus-ad-ring"></div>
          <div class="plus-ad-smoke"></div>`;
        for (let n = 0; n < 30; n++) {
          const particle = root.createElement('i');
          particle.className = 'plus-ad-particle';
          const angle = (n * Math.PI * 2) / 30;
          const distance = 140 + (n % 5) * 36;
          particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
          particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
          particle.style.setProperty('--particle-turn', `${n * 41}deg`);
          burst.append(particle);
        }
        overlay.append(burst);
      }
    }
    root.body.append(overlay);
    if (reduced) {
      sound.play('upgrade');
      showNotice();
    }
    root.addEventListener('keydown', dismiss);
    timer = setTimeout(cancel, totalDuration);
  };
  timer = setTimeout(start, 120);
}
