export function renderAppTitle(root: Document = document, showEdition = true): void {
  const title = root.querySelector<HTMLElement>('[data-app-info]');
  if (!title) {
    return;
  }
  const version = title.dataset.version ?? '3.1.0';
  const edition = root.body.dataset.battlyPlus === 'true' ? 'Premium' : 'Free';
  title.translate = false;
  title.replaceChildren(`Battly Launcher ${version}${showEdition ? ` ${edition} Edition` : ''}`);
  const build = Number(title.dataset.build);
  if (Number.isSafeInteger(build) && build > 0) {
    const patch = root.createElement('small');
    patch.className = 'header-patch';
    setUiText(patch, `parche ${build}`);
    title.append(patch);
  }
}
import { setUiText } from '../i18n/dialog-text';
