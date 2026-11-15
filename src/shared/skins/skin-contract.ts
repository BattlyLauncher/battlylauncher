export type SkinModel = 'default' | 'slim';

export interface SkinLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly model: SkinModel;
}

export interface SkinLibrarySnapshot {
  readonly currentSkinId: string | null;
  readonly currentSkinUrl: string;
  readonly limitReached: boolean;
  readonly premium: boolean;
  readonly skins: readonly SkinLibraryItem[];
}

export interface SkinActionResult {
  readonly message: string;
  readonly snapshot: SkinLibrarySnapshot;
}

export function normalizeSkinId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TypeError('Invalid skin id');
  }
  return value;
}

export interface CapeLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly deletable: boolean;
}
export interface CapeLibrarySnapshot {
  readonly established: string | null;
  readonly premium: boolean;
  readonly capes: readonly CapeLibraryItem[];
}
export interface CapeActionResult {
  readonly message: string;
  readonly snapshot: CapeLibrarySnapshot;
}
