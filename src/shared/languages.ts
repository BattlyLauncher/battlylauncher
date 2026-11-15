export const supportedLanguages = Object.freeze([
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'it',
  'ja',
  'pt',
  'ru',
  'zh',
] as const);
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const languageNames: Record<SupportedLanguage, string> = {
  ar: 'العربية',
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  ja: '日本語',
  pt: 'Português',
  ru: 'Русский',
  zh: '简体中文',
};
export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && supportedLanguages.includes(value as SupportedLanguage);
}
