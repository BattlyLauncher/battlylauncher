import battlyLogoUrl from '../assets/battly-logo.png?url';
import englishFlagUrl from '../assets/flags/en.png?url';
import spanishFlagUrl from '../assets/flags/es.png?url';
import languageVideoUrl from '../assets/videos/video-select-lang-2.webm?url';

import type { InitialLanguage } from '../../shared/onboarding/onboarding-contract';
import { supportedLanguages, languageNames } from '../../shared/languages';

interface OnboardingPanelOptions {
  readonly navigate: (panel: string, animate?: boolean) => Promise<void>;
  readonly applyLanguage?: (language: string) => Promise<void>;
}

export function mountOnboardingPanel({ navigate, applyLanguage }: OnboardingPanelOptions): void {
  const video = document.querySelector<HTMLVideoElement>('[data-language-video]');
  const welcomeLogo = document.querySelector<HTMLImageElement>('[data-welcome-logo]');
  const spanishFlag = document.querySelector<HTMLImageElement>('[data-language-flag="es"]');
  const englishFlag = document.querySelector<HTMLImageElement>('[data-language-flag="en"]');
  if (video) {
    video.src = languageVideoUrl;
  }
  if (welcomeLogo) {
    welcomeLogo.src = battlyLogoUrl;
  }
  if (spanishFlag) {
    spanishFlag.src = spanishFlagUrl;
  }
  if (englishFlag) {
    englishFlag.src = englishFlagUrl;
  }
  const legacyLanguageOptions = document.querySelector<HTMLElement>('.button-divs');
  if (legacyLanguageOptions) {
    legacyLanguageOptions.classList.add('onboarding-language-grid');
    for (const language of supportedLanguages) {
      if (legacyLanguageOptions.querySelector(`[data-initial-language="${language}"]`)) {
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button is-info is-outlined is-medium';
      button.dataset.initialLanguage = language;
      button.textContent = languageNames[language];
      button.setAttribute('translate', 'no');
      button.lang = language;
      legacyLanguageOptions.append(button);
    }
    window.setTimeout(() => {
      legacyLanguageOptions.style.display = 'flex';
    }, 2_000);
  }

  document.querySelectorAll<HTMLButtonElement>('[data-initial-language]').forEach((button) => {
    button.addEventListener('click', () => {
      const language = button.dataset.initialLanguage as InitialLanguage;
      const status = document.querySelector<HTMLElement>('[data-language-status]');
      document
        .querySelectorAll<HTMLButtonElement>('[data-initial-language]')
        .forEach((candidate) => (candidate.disabled = true));
      if (status) {
        status.textContent = '';
      }
      void window.battly
        .selectInitialLanguage(language)
        .then(async () => {
          document.documentElement.lang = language;
          await applyLanguage?.(language);
          await navigate('welcome', false);
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo guardar el idioma. Inténtalo de nuevo.';
          }
        })
        .finally(() => {
          document
            .querySelectorAll<HTMLButtonElement>('[data-initial-language]')
            .forEach((candidate) => (candidate.disabled = false));
        });
    });
  });

  const next = document.querySelector<HTMLButtonElement>('[data-welcome-next]');
  next?.addEventListener('click', () => {
    const intro = document.querySelector<HTMLElement>('[data-welcome-step="intro"]');
    const account = document.querySelector<HTMLElement>('[data-welcome-step="account"]');
    if (intro) {
      intro.hidden = true;
    }
    if (account) {
      account.hidden = false;
    }
  });
  document
    .querySelector<HTMLButtonElement>('[data-welcome-back]')
    ?.addEventListener('click', () => {
      const intro = document.querySelector<HTMLElement>('[data-welcome-step="intro"]');
      const account = document.querySelector<HTMLElement>('[data-welcome-step="account"]');
      if (intro) {
        intro.hidden = false;
      }
      if (account) {
        account.hidden = true;
      }
    });
  document.querySelectorAll<HTMLButtonElement>('[data-welcome-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = document.querySelector<HTMLElement>(
        '[data-welcome-step="account"] [data-welcome-status]',
      );
      const method = button.dataset.welcomeAuth;
      document
        .querySelectorAll<HTMLButtonElement>('[data-welcome-auth]')
        .forEach((candidate) => (candidate.disabled = true));
      if (status) {
        status.textContent = 'Guardando bienvenida…';
      }
      void window.battly
        .completeWelcome()
        .then(async () => {
          await navigate('login', false);
          if (method === 'microsoft') {
            document.querySelector<HTMLButtonElement>('[data-auth-method="microsoft"]')?.click();
          }
        })
        .catch(() => {
          if (status) {
            status.textContent = 'No se pudo completar la bienvenida. Inténtalo de nuevo.';
          }
        })
        .finally(() => {
          document
            .querySelectorAll<HTMLButtonElement>('[data-welcome-auth]')
            .forEach((candidate) => (candidate.disabled = false));
        });
    });
  });
}
