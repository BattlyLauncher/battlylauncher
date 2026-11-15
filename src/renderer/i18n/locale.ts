import { isSupportedLanguage } from '../../shared/languages';
export function uiLocale(): string {
  const language = typeof document === 'undefined' ? 'es' : document.documentElement.lang;
  return isSupportedLanguage(language) ? language : 'es';
}
