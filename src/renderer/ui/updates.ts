import type { UpdateAction, UpdateSnapshot } from '../../shared/updates';
import { setUserText } from '../i18n/ui-translator';
import './updates.css';

export function mountUpdates(root: HTMLElement): void {
  const launcher = root.querySelector<HTMLElement>('#b-settings-panel-launcher');
  if (!launcher || launcher.querySelector('[data-updates]')) {
    return;
  }
  const section = document.createElement('section');
  section.className = 'battly-updates';
  section.dataset.updates = '';
  section.innerHTML = /* HTML */ `<h3>Actualizaciones de Battly</h3>
    <p data-update-current></p>
    <div class="battly-update-preferences">
      <label
        >Canal
        <select data-update-channel>
          <option value="stable">Estable</option>
          <option value="beta">Beta</option>
        </select></label
      >
    </div>
    <p>
      Los parches siguen el canal seleccionado y descargan solo los archivos modificados. Se aplican
      al reiniciar y permiten volver a la build anterior.
    </p>
    <p data-update-config></p>
    <p
      data-update-message
      role="status"
      aria-live="polite"
    ></p>
    <progress
      data-update-progress
      max="100"
      hidden
    ></progress>
    <p data-update-bytes></p>
    <div class="battly-update-actions">
      <button
        data-update-action="check"
        hidden
      >
        Reintentar
      </button>
      <button
        data-update-action="install"
        hidden
      >
        Reiniciar</button
      ><button
        data-update-action="later"
        hidden
      >
        Recuérdamelo más tarde
      </button>
    </div>`;
  launcher.append(section);
  const find = <T extends HTMLElement>(name: string): T =>
    section.querySelector<T>(`[data-update-${name}]`)!;
  const notice = document.createElement('aside');
  notice.className = 'battly-update-notice';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.innerHTML = /* HTML */ `<strong>Actualización lista para reiniciar Battly.</strong
    ><span data-notice-target></span><span data-required-message></span
    ><button
      type="button"
      data-required-restart
    >
      Reiniciar</button
    ><button
      type="button"
      data-required-later
    >
      Recuérdamelo más tarde
    </button>`;
  document.body.append(notice);
  const message = notice.querySelector<HTMLElement>('[data-required-message]')!;
  const restart = notice.querySelector<HTMLButtonElement>('[data-required-restart]')!;
  const later = notice.querySelector<HTMLButtonElement>('[data-required-later]')!;
  let last: UpdateSnapshot | undefined;
  let shownKey = '';
  let pending = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const showNotice = (): void => {
    if (!last || last.status !== 'ready') {
      return;
    }
    notice.hidden = false;
    setUserText(notice.querySelector<HTMLElement>('[data-notice-target]')!, last.target);
    message.textContent = last.message;
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      notice.hidden = true;
    }, 10_000);
  };
  const render = (s: UpdateSnapshot, force = false): void => {
    last = s;
    const busy = s.status === 'checking' || s.status === 'downloading';
    find('current').textContent =
      `Versión ${s.version} · Build ${s.build}${s.target ? ` → ${s.target}` : ''}`;
    find('message').textContent = s.message;
    find<HTMLSelectElement>('channel').value = s.settings.channel;
    find('config').textContent = s.patchConfigured
      ? ''
      : 'Esta instalación todavía no tiene configurado el canal firmado de parches.';
    find<HTMLSelectElement>('channel').disabled = busy || s.status === 'ready';
    find<HTMLProgressElement>('progress').hidden = !busy;
    if (s.status === 'checking') {
      find('progress').removeAttribute('value');
    } else {
      find<HTMLProgressElement>('progress').value = s.percent;
    }
    find('bytes').textContent =
      s.downloaded || s.reused
        ? `${(s.downloaded / 1048576).toFixed(1)} MB descargados · ${(s.reused / 1048576).toFixed(1)} MB reutilizados`
        : '';
    for (const button of section.querySelectorAll<HTMLButtonElement>('[data-update-action]')) {
      button.hidden =
        button.dataset.updateAction === 'check' ? s.status !== 'error' : s.status !== 'ready';
      button.disabled = busy;
    }
    const key = `${s.target}:${s.noticeId || 0}`;
    if (s.status !== 'ready' || (!force && (s.remindAt || 0) > Date.now())) {
      notice.hidden = true;
    } else if (force || shownKey !== key) {
      shownKey = key;
      showNotice();
    }
  };
  const act = async (action: UpdateAction): Promise<void> => {
    if (pending) {
      return;
    }
    pending = true;
    restart.disabled = later.disabled = true;
    try {
      render(await window.battly.updateAction(action));
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo actualizar';
      find('message').textContent = text;
      if (action === 'install') {
        showNotice();
        message.textContent = text;
      }
    } finally {
      pending = false;
      restart.disabled = later.disabled = false;
    }
  };
  restart.onclick = () => {
    void act('install');
  };
  later.onclick = () => {
    void act('later');
  };
  section.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-update-action]');
    if (button) {
      void act(button.dataset.updateAction as UpdateAction);
    }
  });
  section.addEventListener('change', () => {
    void window.battly
      .updateSettings({ channel: find<HTMLSelectElement>('channel').value as 'stable' | 'beta' })
      .then((s) => render(s))
      .catch((error) => {
        find('message').textContent =
          error instanceof Error ? error.message : 'No se pudieron guardar las preferencias';
      });
  });
  const unsubscribe = window.battly.onUpdateNotice?.((action) => {
    document.querySelector<HTMLElement>('[data-panel="settings"]')?.click();
    document.querySelector<HTMLElement>('#launcher-btn')?.click();
    launcher.querySelector<HTMLElement>('[data-update-tab]')?.click();
    void window.battly
      .getUpdates()
      .then((s) => {
        render(s, true);
        if (action === 'restart' && s.status === 'ready') {
          void act('install');
        }
      })
      .catch(() => {});
  });
  let polling = false;
  const refresh = (): void => {
    if (polling || !section.isConnected || document.hidden) {
      return;
    }
    polling = true;
    void window.battly
      .getUpdates()
      .then((s) => render(s))
      .catch(() => {})
      .finally(() => {
        polling = false;
      });
  };
  refresh();
  const interval = setInterval(() => {
    if (!section.isConnected) {
      clearInterval(interval);
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      unsubscribe?.();
      notice.remove();
    } else {
      refresh();
    }
  }, 1500);
}
