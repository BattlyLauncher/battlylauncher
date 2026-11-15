import DOMPurify from 'dompurify';
import { remoteHtmlToText, type BattlyNewsItem } from '../../shared/home/home-contract';
import { setUiText, translateUiText } from '../i18n/dialog-text';
import { uiLocale } from '../i18n/locale';
import './minecraft-news-article.css';

export function translateMinecraftNews(): boolean {
  return localStorage.getItem('battly.minecraft-news.translate') !== 'false';
}

function displayedNews(news: BattlyNewsItem): BattlyNewsItem {
  if (translateMinecraftNews()) {
    return news;
  }
  return {
    ...news,
    title: news.originalTitle ?? news.title,
    content:
      news.originalContent ??
      (news.articleHtml ? remoteHtmlToText(news.articleHtml) : news.content),
    translatedHtml: undefined,
  };
}

function linkText(element: HTMLElement, text: string): void {
  for (const part of text.split(/(https:\/\/[^\s<>]+)/u)) {
    if (!part.startsWith('https://')) {
      element.append(document.createTextNode(part));
      continue;
    }
    const link = document.createElement('a');
    link.href = part;
    link.textContent = part;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    element.append(link);
  }
}

/** Untrusted Mojang markup is sanitized; translated text never becomes HTML. */
export function minecraftNewsArticle(news: BattlyNewsItem): HTMLElement {
  const article = document.createElement('div');
  article.className = 'minecraft-news-article';
  article.setAttribute('translate', 'no');
  if (news.articleHtml) {
    article.innerHTML = DOMPurify.sanitize(news.translatedHtml ?? news.articleHtml, {
      ALLOWED_TAGS: [
        'p',
        'br',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        'b',
        'i',
        'a',
        'pre',
        'code',
        'blockquote',
        'img',
        'figure',
        'figcaption',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'colspan', 'rowspan'],
    });
    article.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      try {
        const url = new URL(link.getAttribute('href') ?? '', 'https://www.minecraft.net/');
        if (url.protocol !== 'https:' || url.username || url.password) {
          link.removeAttribute('href');
          return;
        }
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } catch {
        link.removeAttribute('href');
      }
    });
    article.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      try {
        const url = new URL(image.getAttribute('src') ?? '', 'https://www.minecraft.net/');
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          !['www.minecraft.net', 'minecraft.net', 'launchercontent.mojang.com'].includes(
            url.hostname,
          )
        ) {
          image.remove();
          return;
        }
        image.src = url.href;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
      } catch {
        image.remove();
      }
    });
    if (news.translatedHtml) {
      return article;
    }
    const original = remoteHtmlToText(news.articleHtml);
    if (original === news.content) {
      return article;
    }
    const lines = (value: string) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const translated = lines(news.content);
    const selector = 'p,h1,h2,h3,h4,h5,h6,li,pre,blockquote';
    const blocks = [...article.querySelectorAll<HTMLElement>(selector)];
    const counts = blocks.map((node) => {
      const ownCopy = node.cloneNode(true) as HTMLElement;
      ownCopy.querySelectorAll(selector).forEach((child) => child.remove());
      return lines(remoteHtmlToText(ownCopy.innerHTML)).length;
    });
    // If a translator changes paragraph boundaries, fall back to readable text.
    if (
      counts.reduce((sum, count) => sum + count, 0) === translated.length &&
      translated.length === lines(original).length
    ) {
      let cursor = 0;
      blocks.forEach((block, index) => {
        if (!counts[index]) {
          return;
        }
        const text = translated.slice(cursor, cursor + counts[index]).join('\n');
        cursor += counts[index];
        const nested = [...block.children].filter(
          (child) => child.matches('ul,ol') || child.matches(selector),
        );
        block.replaceChildren();
        linkText(block, text.replace(/^•\s*/u, ''));
        block.append(...nested);
      });
      return article;
    }
    article.replaceChildren();
  }
  for (const paragraph of news.content.split(/\n\s*\n/u)) {
    const block = document.createElement('p');
    linkText(block, paragraph);
    article.append(block);
  }
  return article;
}

function cover(news: BattlyNewsItem): HTMLImageElement | null {
  if (!news.imageUrl) {
    return null;
  }
  try {
    const url = new URL(news.imageUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hostname !== 'launchercontent.mojang.com'
    ) {
      return null;
    }
    const image = document.createElement('img');
    image.className = 'minecraft-news-cover';
    image.src = url.href;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), { once: true });
    return image;
  } catch {
    return null;
  }
}

function metadata(news: BattlyNewsItem): HTMLElement {
  const meta = document.createElement('p');
  meta.className = 'minecraft-news-meta';
  meta.setAttribute('translate', 'no');
  meta.textContent = `${news.author} · ${new Date(news.publishedAt).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return meta;
}

export function openMinecraftNewsReader(source: BattlyNewsItem): void {
  const news = displayedNews(source);
  document.querySelector<HTMLDialogElement>('.minecraft-news-reader')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'minecraft-news-reader';
  dialog.setAttribute('aria-labelledby', 'minecraft-article-title');
  const header = document.createElement('header');
  const label = document.createElement('span');
  label.textContent = 'Minecraft · Mojang';
  label.setAttribute('translate', 'no');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'delete';
  close.setAttribute('aria-label', translateUiText('Cerrar'));
  const tools = document.createElement('div');
  tools.className = 'minecraft-news-reader-tools';
  const translationLabel = document.createElement('label');
  translationLabel.className = 'minecraft-news-translation';
  const translation = document.createElement('input');
  translation.type = 'checkbox';
  translation.checked = translateMinecraftNews();
  const translationText = document.createElement('span');
  setUiText(translationText, 'Traducción automática');
  translationLabel.append(translation, translationText);
  translation.onchange = () => {
    localStorage.setItem('battly.minecraft-news.translate', String(translation.checked));
    window.dispatchEvent(new Event('minecraft-news-translation-change'));
    openMinecraftNewsReader(source);
    document.querySelector<HTMLInputElement>('.minecraft-news-translation input')?.focus();
  };
  close.onclick = () => dialog.close();
  tools.append(translationLabel, close);
  header.append(label, tools);
  const body = document.createElement('section');
  body.className = 'minecraft-news-reader-body';
  const image = cover(news);
  if (image) {
    body.append(image);
  }
  const title = document.createElement('h1');
  title.id = 'minecraft-article-title';
  title.textContent = news.title;
  title.setAttribute('translate', 'no');
  const content = document.createElement('article');
  content.append(metadata(news), title, minecraftNewsArticle(news));
  body.append(content);
  dialog.append(header, body);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}

export function minecraftNewsCard(source: BattlyNewsItem, featured = false): HTMLElement {
  const news = displayedNews(source);
  const card = document.createElement('article');
  card.className = 'minecraft-news-card';
  card.classList.toggle('is-featured', featured);
  const image = cover(news);
  if (image) {
    card.classList.add('has-cover');
    image.decoding = 'async';
    if (featured) {
      image.loading = 'eager';
      image.fetchPriority = 'high';
    }
    image.addEventListener('error', () => card.classList.remove('has-cover'), { once: true });
    card.append(image);
  }
  const copy = document.createElement('div');
  copy.className = 'minecraft-news-card-copy';
  const title = document.createElement('h2');
  title.textContent = news.title;
  title.setAttribute('translate', 'no');
  const excerpt = document.createElement('p');
  excerpt.className = 'minecraft-news-excerpt';
  excerpt.textContent = news.content.split('\n').find((line) => line.trim()) ?? '';
  excerpt.setAttribute('translate', 'no');
  const read = document.createElement('button');
  read.type = 'button';
  read.className = 'button is-info';
  setUiText(read, 'Leer más');
  read.onclick = () => openMinecraftNewsReader(source);
  const arrow = document.createElement('i');
  arrow.className = 'fa-solid fa-arrow-right';
  arrow.setAttribute('aria-hidden', 'true');
  read.append(arrow);
  copy.append(metadata(news), title, excerpt, read);
  card.append(copy);
  return card;
}
