import steveUrl from '../assets/steve-empty.png';
import { setUiText } from '../i18n/dialog-text';
import './empty-state.css';

export function thinkingSteveImage(): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'empty-state-steve';
  image.src = steveUrl;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.width = 160;
  image.height = 146;
  image.decoding = 'async';
  return image;
}

export function emptyState(message: string, detail?: string): HTMLElement {
  const state = document.createElement('div');
  state.className = 'battly-empty-state';
  const text = document.createElement('p');
  setUiText(text, message);
  state.append(thinkingSteveImage(), text);
  if (detail) {
    const description = document.createElement('p');
    description.className = 'empty-state-detail';
    setUiText(description, detail);
    state.append(description);
  }
  return state;
}
