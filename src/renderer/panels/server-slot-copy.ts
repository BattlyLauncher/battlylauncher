import spanish from '../i18n/locales/es.json';
import { translateUiText } from '../i18n/dialog-text';

const keys = {
  add: 'plusAdd',
  benefit: 'plusBenefit',
  full: 'plusFull',
  unavailable: 'plusUnavailable',
} as const;
export function serverSlotText(key: keyof typeof keys): string {
  return translateUiText(spanish.servers[keys[key]]);
}
