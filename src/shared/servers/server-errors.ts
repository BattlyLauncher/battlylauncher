import { stripElectronErrorPrefix } from '../ipc-errors';

export const serverDomainTakenMessage = 'Este subdominio ya está en uso. Elige otro.';

export function serverErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  return stripElectronErrorPrefix(error.message);
}
