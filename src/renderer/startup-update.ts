import type { StartupUpdateBridge, StartupUpdateSnapshot } from '../shared/startup-updates';
import type { LanguageStrings } from './i18n/language-service';
import spanish from './i18n/locales/es.json';
import { setUiText, translateUiText } from './i18n/dialog-text';
import { setUserText, UiTranslator } from './i18n/ui-translator';
import './startup-update.css';

const bridge = (window as unknown as { startupUpdates: StartupUpdateBridge }).startupUpdates;
const parameters = new URLSearchParams(location.search);
const language = parameters.get('lang') || 'es';
const bundles = import.meta.glob<LanguageStrings>('./i18n/locales/*.json', { import: 'default' });
const translator = new UiTranslator(spanish);
translator.start();
translator.setStrings(spanish);
let last: StartupUpdateSnapshot | undefined;
// Startup must remain usable offline; this window only loads bundled translations.
void (async () => {
  const load = bundles[`./i18n/locales/${language}.json`];
  if (!load) {
    return;
  }
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  translator.setStrings(await load());
  if (last) {
    render(last);
  }
})().catch(() => undefined);
const find = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const phases = {
  checking: 'Comprobando',
  downloading: 'Descargando',
  verifying: 'Verificando archivos',
  installing: 'Instalando',
  error: 'No se pudo actualizar',
};
const titles = {
  checking: 'Preparando Battly',
  downloading: 'Actualizando Battly',
  verifying: 'Verificando la actualización',
  installing: 'Instalando la actualización',
  error: 'No se pudo actualizar',
};
function render(s: StartupUpdateSnapshot): void {
  document.body.dataset.phase = s.phase;
  setUiText(find('[data-channel]'), s.channel === 'beta' ? 'Beta' : 'Estable');
  setUiText(find('[data-title]'), titles[s.phase]);
  const type = s.kind === 'patch' ? 'Parche' : 'Actualización completa';
  setUserText(
    find('[data-target]'),
    s.kind ? `${translateUiText(type)}${s.target ? ` · ${s.target}` : ''}` : '',
  );
  const descriptions = {
    checking: 'Comprobando si hay actualizaciones…',
    downloading:
      s.kind === 'patch'
        ? 'Descargando los cambios del parche.'
        : 'Descargando la nueva versión de Battly.',
    verifying: 'Comprobando la integridad de los archivos.',
    installing:
      s.kind === 'patch'
        ? 'Preparando los archivos del parche y activando la nueva build.'
        : parameters.get('platform') === 'win32'
          ? 'Abriendo el instalador. Windows puede pedirte permiso para continuar.'
          : 'Abriendo el instalador de Battly.',
    error: 'La versión actual sigue disponible. Puedes volver a intentarlo o abrir Battly.',
  };
  setUiText(find('[data-description]'), descriptions[s.phase]);
  setUiText(find('.progress-label [data-phase]'), phases[s.phase]);
  const progress = find<HTMLProgressElement>('progress');
  if (s.percent === null) {
    progress.removeAttribute('value');
  } else {
    progress.value = s.percent;
  }
  setUserText(find('[data-percent]'), s.percent === null ? '' : `${Math.floor(s.percent)}%`);
  const bytes = (n: number): string =>
    `${(n / 1048576).toLocaleString(document.documentElement.lang, { maximumFractionDigits: 1 })} MB`;
  setUserText(
    find('[data-transfer]'),
    s.downloaded || s.reused
      ? `${bytes(s.downloaded)} ${translateUiText('descargados')}${s.reused ? ` · ${bytes(s.reused)} ${translateUiText('reutilizados')}` : ''}`
      : '',
  );
  const order =
    s.kind === 'patch'
      ? ['downloading', 'installing', 'verifying']
      : ['downloading', 'verifying', 'installing'];
  const steps = find('.steps');
  for (const phase of order) {
    steps.append(find(`[data-step="${phase}"]`));
  }
  for (const item of document.querySelectorAll<HTMLElement>('[data-step]')) {
    const index = order.indexOf(item.dataset.step!);
    item.classList.toggle('active', item.dataset.step === s.phase);
    item.classList.toggle('complete', index < order.indexOf(s.phase));
    if (item.dataset.step === s.phase) {
      item.setAttribute('aria-current', 'step');
    } else {
      item.removeAttribute('aria-current');
    }
  }
  find('[data-footer]').hidden = s.phase === 'error';
  find('[data-retry]').parentElement!.hidden = s.phase !== 'error';
}
bridge.onSnapshot((snapshot) => {
  last = snapshot;
  render(snapshot);
});
find('[data-retry]').onclick = () => bridge.action('retry');
find('[data-continue]').onclick = () => bridge.action('continue');
