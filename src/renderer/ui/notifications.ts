import { formatPlayVersion } from '../../shared/minecraft/play-version-presentation';
import type { BattlyNotice, NoticeSnapshot, NoticeSettings } from '../../shared/notifications';
import { setUiText } from '../i18n/dialog-text';
import './notifications.css';
import { uiLocale } from '../i18n/locale';

export function mountNotifications(): void {
  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'b-notice-bell';
  bell.title = 'Notificaciones';
  bell.setAttribute('aria-label', 'Notificaciones');
  const bellIcon = document.createElement('i');
  bellIcon.className = 'fas fa-bell';
  bellIcon.setAttribute('aria-hidden', 'true');
  const badge = document.createElement('span');
  badge.className = 'b-notice-badge';
  badge.hidden = true;
  bell.append(bellIcon, badge);
  const dialog = document.createElement('dialog');
  dialog.className = 'b-notice-center';
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = 'Notificaciones';
  heading.id = 'b-notice-heading';
  dialog.setAttribute('aria-labelledby', heading.id);
  const headingIcon = document.createElement('i');
  headingIcon.className = 'fas fa-bell';
  headingIcon.setAttribute('aria-hidden', 'true');
  heading.prepend(headingIcon);
  const close = button('Cerrar', () => dialog.close());
  close.className = 'b-notice-close';
  close.setAttribute('aria-label', 'Cerrar');
  delete close.dataset.uiSource;
  close.textContent = '×';
  header.append(heading, close);
  const tools = document.createElement('nav');
  tools.append(
    button('Marcar todas como leídas', () => {
      void window.battly.readNotification(null).then(render).catch(failure);
    }),
    button('Borrar historial', () => {
      void window.battly.clearNotifications().then(render).catch(failure);
    }),
  );
  const preferences = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Preferencias de notificaciones';
  preferences.append(summary);
  const items = document.createElement('section');
  items.className = 'b-notice-items';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const toast = document.createElement('aside');
  toast.className = 'b-notice-toast';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-atomic', 'true');
  dialog.append(header, tools, preferences, status, items);
  document.body.append(dialog, toast);
  const windowControls = document.querySelector('.titlebar .window-controls');
  if (windowControls) {
    windowControls.before(bell);
  }
  let state: NoticeSnapshot = {
    items: [],
    settings: { native: true, actions: true, announcements: true, social: true },
  };
  let known = new Set<string>();
  let initialized = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const dismissToast = (): void => {
    clearTimeout(toastTimer);
    toast.hidden = true;
  };
  const scheduleDismiss = (): void => {
    clearTimeout(toastTimer);
    if (!toast.hidden) {
      toastTimer = setTimeout(dismissToast, 10000);
    }
  };
  function button(label: string, act: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    setUiText(b, label);
    b.onclick = act;
    return b;
  }
  function failure(): void {
    status.textContent = 'No se pudo completar la acción. Vuelve a intentarlo.';
  }
  function open(id?: string): void {
    dismissToast();
    if (!dialog.open) {
      dialog.showModal();
    }
    if (id) {
      items.querySelectorAll<HTMLElement>('[data-notice-id]').forEach((card) => {
        if (card.dataset.noticeId === id) {
          card.scrollIntoView({ block: 'nearest' });
          card.focus();
        }
      });
      void window.battly.readNotification(id).then(render).catch(failure);
    }
  }
  bell.onclick = () => open();
  function card(notice: BattlyNotice): HTMLElement {
    const article = document.createElement('article');
    article.dataset.noticeId = notice.id;
    article.tabIndex = -1;
    article.className = notice.read ? 'is-read' : 'is-unread';
    const title = document.createElement('h3');
    title.textContent = notice.title;
    const date = document.createElement('time');
    date.dateTime = new Date(notice.createdAt).toISOString();
    date.textContent = new Date(notice.createdAt).toLocaleString(uiLocale());
    const body = document.createElement('p');
    body.textContent = /^Minecraft (?:iniciado|cerrado|se ha cerrado|started|closed)/i.test(
      notice.title,
    )
      ? formatPlayVersion(notice.body)
      : notice.body;
    const controls = document.createElement('div');
    controls.className = 'b-notice-controls';
    const openLink = (url: string) => {
      void window.battly.openNotificationLink(notice.id, url).catch(failure);
    };
    for (const action of notice.actions) {
      const b = button(action.label, () => openLink(action.url));
      b.title = action.url;
      controls.append(b);
    }
    for (const dropdown of notice.dropdowns) {
      const group = document.createElement('div');
      group.className = 'b-notice-dropdown';
      const select = document.createElement('select');
      select.setAttribute('aria-label', dropdown.label);
      const placeholder = document.createElement('option');
      placeholder.textContent = dropdown.label;
      placeholder.value = '';
      select.append(placeholder);
      dropdown.options.forEach((option) => {
        const item = document.createElement('option');
        item.textContent = option.label;
        item.value = option.url;
        select.append(item);
      });
      const go = button('Abrir enlace', () => {
        if (select.value) {
          openLink(select.value);
        }
      });
      go.disabled = true;
      select.onchange = () => {
        go.disabled = !select.value;
      };
      group.append(select, go);
      controls.append(group);
    }
    if (!notice.read) {
      const read = button('Marcar como leída', () => {
        void window.battly.readNotification(notice.id).then(render).catch(failure);
      });
      read.classList.add('b-notice-read');
      controls.append(read);
    }
    const icon = document.createElement('span');
    icon.className = 'b-notice-icon';
    icon.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('i');
    glyph.className =
      notice.category === 'social'
        ? 'fas fa-user-friends'
        : notice.category === 'announcement'
          ? 'fas fa-bullhorn'
          : 'fas fa-check-circle';
    icon.append(glyph);
    const content = document.createElement('div');
    content.className = 'b-notice-content';
    const itemHeading = document.createElement('div');
    itemHeading.className = 'b-notice-item-heading';
    itemHeading.append(title, date);

    content.append(itemHeading, body, controls);
    article.append(icon, content);
    return article;
  }
  function render(snapshot: NoticeSnapshot, openId?: string): void {
    state = snapshot;
    status.textContent = '';
    const unread = state.items.filter((n) => !n.read).length;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
    bell.setAttribute('aria-label', `Notificaciones (${unread})`);
    items.replaceChildren(...state.items.map(card));
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No tienes notificaciones.';
      items.append(empty);
    }
    preferences.querySelectorAll('label').forEach((el) => el.remove());
    const labels: Record<keyof NoticeSettings, string> = {
      native: 'Notificaciones del sistema',
      actions: 'Instalaciones y Minecraft',
      announcements: 'Avisos de Battly',
      social: 'Solicitudes de amistad',
    };
    for (const key of Object.keys(labels) as (keyof NoticeSettings)[]) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.settings[key];
      input.onchange = () => {
        input.disabled = true;
        void window.battly
          .setNotificationSettings({ [key]: input.checked })
          .then(render)
          .catch(() => {
            input.checked = state.settings[key];
            input.disabled = false;
            failure();
          });
      };
      label.append(input, document.createTextNode(labels[key]));
      preferences.append(label);
    }
    const newest = initialized ? state.items.find((n) => !known.has(n.id)) : undefined;
    known = new Set(state.items.map((n) => n.id));
    initialized = true;
    if (newest && !dialog.open) {
      const icon = document.createElement('span');
      icon.className = 'b-notice-toast-icon';
      icon.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('i');
      glyph.className =
        newest.category === 'social'
          ? 'fas fa-user-friends'
          : newest.category === 'announcement'
            ? 'fas fa-bullhorn'
            : 'fas fa-gamepad';
      icon.append(glyph);
      const content = document.createElement('div');
      content.className = 'b-notice-toast-content';
      const title = document.createElement('strong');
      title.textContent = newest.title;
      title.title = newest.title;
      const body = document.createElement('p');
      body.textContent = /^Minecraft (?:iniciado|cerrado|se ha cerrado|started|closed)/i.test(
        newest.title,
      )
        ? formatPlayVersion(newest.body)
        : newest.body;
      const footer = document.createElement('div');
      footer.className = 'b-notice-toast-footer';
      const view = button('Ver notificación', () => open(newest.id));
      view.className = 'b-notice-toast-view';
      const arrow = document.createElement('i');
      arrow.className = 'fas fa-arrow-right';
      arrow.setAttribute('aria-hidden', 'true');
      view.append(arrow);
      const time = document.createElement('time');
      const createdAt = new Date(newest.createdAt);
      time.dateTime = createdAt.toISOString();
      time.textContent = createdAt.toLocaleTimeString(document.documentElement.lang || undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      time.title = createdAt.toLocaleString(uiLocale());
      footer.append(view, time);
      content.append(title, body, footer);
      const dismiss = button('Cerrar', dismissToast);
      dismiss.className = 'b-notice-toast-dismiss';
      dismiss.setAttribute('aria-label', 'Cerrar');
      dismiss.title = 'Cerrar';
      delete dismiss.dataset.uiSource;
      dismiss.textContent = '×';
      toast.dataset.category = newest.category;
      toast.replaceChildren(icon, content, dismiss);
      toast.hidden = false;
      scheduleDismiss();
    }
    if (openId) {
      open(openId);
    }
  }
  window.addEventListener('battly:language-changed', () => render(state));
  window.battly.onNotifications(render);
  void window.battly.getNotifications().then(render).catch(failure);
}
