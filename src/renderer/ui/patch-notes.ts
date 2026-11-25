import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { InstalledPatchNotes } from '../../shared/updates';
import banner from '../assets/instance-banners/vanilla.png';
import battlyLogo from '../assets/battly-logo.png';
import { setUiText, translateUiText } from '../i18n/dialog-text';
import { privateStorage } from '../private-storage';
import './patch-notes.css';

export function showPatchNotes(patch: InstalledPatchNotes | undefined): void {
  if (!patch) {
    return;
  }
  const seen = `battly.patch-notes.${patch.key}`;
  if (privateStorage.getItem(seen)) {
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'patch-notes';
  dialog.setAttribute('aria-labelledby', 'patch-notes-title');
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.id = 'patch-notes-title';
  setUiText(heading, 'Novedades');
  const version = document.createElement('p');
  version.textContent = patch.version;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'patch-notes__close';
  close.textContent = '×';
  close.setAttribute('aria-label', translateUiText('Cerrar'));
  close.addEventListener('click', () => dialog.close());
  header.append(heading, version, close);

  const body = document.createElement('section');
  body.className = 'patch-notes__body';
  body.tabIndex = 0;
  body.setAttribute('aria-labelledby', heading.id);
  const artwork = document.createElement('div');
  artwork.className = 'patch-notes__art';
  artwork.style.setProperty('--patch-notes-art', `url(${JSON.stringify(banner)})`);
  const logo = document.createElement('img');
  logo.src = battlyLogo;
  logo.alt = '';
  artwork.append(logo);
  const intro = document.createElement('p');
  setUiText(intro, 'Gracias por seguir jugando con Battly.');
  if (patch.notes) {
    const content = DOMPurify.sanitize(marked.parse(patch.notes, { async: false }), {
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'p',
        'ul',
        'ol',
        'li',
        'strong',
        'em',
        'code',
        'a',
        'br',
        'blockquote',
      ],
      ALLOWED_ATTR: ['href'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    content.querySelectorAll('a').forEach((link) => {
      if (link.protocol !== 'https:' || !/^https:\/\//i.test(link.getAttribute('href') ?? '')) {
        link.removeAttribute('href');
      } else {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
    const criticalHeading = [...content.children].find(
      (element) =>
        /^H[1-4]$/.test(element.tagName) &&
        /^(crítico|critical)$/iu.test(element.textContent?.trim() ?? ''),
    );
    if (criticalHeading) {
      const critical = document.createElement('section');
      critical.className = 'patch-notes__critical';
      let next = criticalHeading.nextSibling;
      critical.append(criticalHeading);
      while (
        next &&
        !(next instanceof HTMLHeadingElement && next.tagName <= criticalHeading.tagName)
      ) {
        const current = next;
        next = current.nextSibling;
        critical.append(current);
      }
      body.append(critical);
    }
    body.append(artwork, intro, content);
  } else {
    body.append(artwork, intro);
  }

  const footer = document.createElement('footer');
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'button is-info';
  setUiText(done, 'Continuar');
  done.addEventListener('click', () => dialog.close());
  footer.append(done);
  dialog.append(header, body, footer);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  privateStorage.setItem(seen, 'seen');
}
