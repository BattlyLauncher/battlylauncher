import { isSupportedLanguage, type SupportedLanguage } from '../languages';
export type InitialLanguage = SupportedLanguage;

export interface OnboardingState {
  readonly language: InitialLanguage | null;
  readonly welcomeCompleted: boolean;
}

export function normalizeInitialLanguage(value: unknown): InitialLanguage {
  if (!isSupportedLanguage(value)) {
    throw new TypeError('Invalid initial language');
  }
  return value;
}
