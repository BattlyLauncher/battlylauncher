export const instanceContentKinds = ['mods', 'resourcepacks', 'shaderpacks', 'saves'] as const;
export type InstanceContentKind = (typeof instanceContentKinds)[number];
export type InstanceContentAction = 'toggle' | 'archive' | 'backup';

export interface InstanceContentEntry {
  readonly name: string;
  readonly directory: boolean;
  readonly enabled: boolean;
  readonly size: number;
  readonly title?: string;
  readonly version?: string | null;
  readonly gameVersion?: string | null;
  readonly iconDataUrl?: string | null;
  readonly loader?: string;
  readonly backups?: number;
}

export function normalizeInstanceContentKind(value: unknown): InstanceContentKind {
  if (!instanceContentKinds.includes(value as InstanceContentKind)) {
    throw new TypeError('Tipo de contenido inválido');
  }
  return value as InstanceContentKind;
}

export function normalizeInstanceContentName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    /[<>:"/\\|?*]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(value)
  ) {
    throw new TypeError('Nombre de contenido inválido');
  }
  return value;
}
