import { setUserText } from '../i18n/ui-translator';
import { uiLocale } from '../i18n/locale';
import type { ChatMessage } from '../../shared/social/social-contract';

export type ChatDeliveryState = 'sent' | 'pending' | 'failed';

export function renderChatEmpty(
  container: HTMLElement,
  state: 'empty' | 'loading' | 'error',
  title: string,
  description: string,
): void {
  const empty = document.createElement('div');
  empty.className = 'battly-chat-empty';
  empty.dataset.state = state;
  const icon = document.createElement('i');
  icon.className =
    state === 'loading'
      ? 'fa-solid fa-circle-notch fa-spin'
      : state === 'error'
        ? 'fa-solid fa-cloud-arrow-down'
        : 'fa-regular fa-comments';
  icon.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const text = document.createElement('p');
  text.textContent = description;
  empty.append(icon, heading, text);
  container.replaceChildren(empty);
  container.dataset.empty = 'true';
  container.setAttribute('aria-busy', String(state === 'loading'));
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(date: Date): string {
  const today = new Date();
  if (localDay(date) === localDay(today)) {
    return 'Hoy';
  }
  today.setDate(today.getDate() - 1);
  if (localDay(date) === localDay(today)) {
    return 'Ayer';
  }
  return date.toLocaleDateString(uiLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function appendPresentedChatMessage(
  messages: HTMLElement,
  item: ChatMessage,
  own: boolean,
  state: ChatDeliveryState,
  faceUrl: string,
): HTMLElement {
  if (messages.dataset.empty === 'true') {
    messages.replaceChildren();
    delete messages.dataset.empty;
  }
  messages.setAttribute('aria-busy', 'false');
  const previous = messages.lastElementChild as HTMLElement | null;
  const date = new Date(item.createdAt);
  const timestamp = date.getTime();
  const validDate = Number.isFinite(timestamp);
  const day = validDate ? localDay(date) : 'unknown';
  if (previous?.dataset.messageDay !== day) {
    const separator = document.createElement('div');
    separator.className = 'battly-chat-date';
    const time = document.createElement('time');
    time.textContent = validDate ? dateLabel(date) : 'Fecha no disponible';
    if (validDate) {
      time.dateTime = date.toISOString();
    }
    separator.append(time);
    messages.append(separator);
  }
  const row = document.createElement('article');
  row.className = `battly-chat-message ${own ? 'is-own' : 'is-peer'}`;
  row.dataset.messageId = item.id;
  row.dataset.messageAuthor = item.author;
  row.dataset.messageTimestamp = validDate ? String(timestamp) : '';
  row.dataset.messageDay = day;
  row.dataset.deliveryState = state;
  const previousTimestamp = Number(previous?.dataset.messageTimestamp);
  if (
    validDate &&
    previous?.dataset.messageTimestamp &&
    previous.dataset.messageDay === day &&
    previous.dataset.messageAuthor?.toLowerCase() === item.author.toLowerCase() &&
    timestamp >= previousTimestamp &&
    timestamp - previousTimestamp <= 5 * 60_000
  ) {
    row.classList.add('is-grouped');
  }
  const face = document.createElement('img');
  face.src = faceUrl;
  face.alt = '';
  face.width = 36;
  face.height = 36;
  const bubble = document.createElement('div');
  bubble.className = 'battly-chat-bubble';
  const author = document.createElement('strong');
  setUserText(author, item.author);
  const content = document.createElement('p');
  setUserText(content, item.content);
  const meta = document.createElement('footer');
  meta.className = 'battly-chat-message-meta';
  const time = document.createElement('time');
  if (validDate) {
    time.dateTime = date.toISOString();
    time.title = date.toLocaleString(uiLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    time.textContent = date.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' });
  }
  const delivery = document.createElement('small');
  delivery.className = 'battly-chat-delivery';
  delivery.textContent = state === 'pending' ? 'Enviando…' : state === 'failed' ? 'No enviado' : '';
  meta.append(time, delivery);
  bubble.append(author, content, meta);
  row.append(face, bubble);
  messages.append(row);
  return row;
}
