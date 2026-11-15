import { LanguageService, type LanguageStrings } from './language-service';
import { UiTranslator } from './ui-translator';
import spanish from './locales/es.json';
import english from './locales/en.json';

/** Independent windows need their own translator and the saved launcher language. */
export function startWindowLanguage(
  readLanguage: () => Promise<string>,
  formatText?: (text: string) => string,
): void {
  const bundles = import.meta.glob<LanguageStrings>(
    ['./locales/*.json', '!./locales/es.json', '!./locales/en.json'],
    { import: 'default' },
  );
  const translator = new UiTranslator(spanish, formatText);
  let selected = '',
    request = 0;
  const service = new LanguageService({
    bundledFallback: english,
    bundledLanguages: {
      es: () => Promise.resolve(spanish),
      en: () => Promise.resolve(english),
      ...Object.fromEntries(
        Object.entries(bundles).map(([path, load]) => [
          path.split('/').pop()!.replace('.json', ''),
          load,
        ]),
      ),
    },
    onUpdate: (language, strings) => {
      if (language === selected) {
        translator.setStrings(strings);
      }
    },
  });
  translator.start();
  const refresh = async (): Promise<void> => {
    const current = ++request;
    try {
      const language = await readLanguage();
      if (current !== request) {
        return;
      }
      if (language === selected) {
        await service.refresh(language);
        return;
      }
      const strings = await service.load(language);
      if (current !== request) {
        return;
      }
      selected = language;
      document.documentElement.lang = language;
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      translator.setStrings(strings);
      void service.refresh(language);
    } catch {
      /* Retain the current language if settings are temporarily unavailable. */
    }
  };
  window.addEventListener('focus', () => {
    void refresh();
  });
  void refresh();
}
