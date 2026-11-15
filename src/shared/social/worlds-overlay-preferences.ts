export interface WorldsOverlayPreferences {
  opacity: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showVoice: boolean;
  showPresence: boolean;
  animations: boolean;
  width: number;
  height: number;
  minimal: boolean;
  offsetX: number | null;
  offsetY: number | null;
}
export const defaultWorldsOverlayPreferences: WorldsOverlayPreferences = {
  opacity: 90,
  position: 'top-right',
  showVoice: true,
  showPresence: true,
  animations: true,
  width: 300,
  height: 0,
  minimal: false,
  offsetX: null,
  offsetY: null,
};
export function normalizeWorldsOverlayPreferences(input: unknown): WorldsOverlayPreferences {
  if (!input || typeof input !== 'object') {
    throw new Error('Preferencias de overlay no válidas');
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.opacity !== 'number' ||
    !Number.isFinite(value.opacity) ||
    value.opacity < 25 ||
    value.opacity > 100 ||
    !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(String(value.position)) ||
    typeof value.showVoice !== 'boolean' ||
    typeof value.showPresence !== 'boolean' ||
    typeof value.animations !== 'boolean'
  ) {
    throw new Error('Preferencias de overlay no válidas');
  }
  const dimension = (key: string, fallback: number, min: number, max: number) => {
    if (value[key] === undefined) {
      return fallback;
    }
    if (
      typeof value[key] !== 'number' ||
      !Number.isFinite(value[key]) ||
      value[key] < min ||
      value[key] > max
    ) {
      throw new Error('Tamaño de overlay no válido');
    }
    return Math.round(value[key]);
  };
  const offset = (key: string) => {
    if (value[key] === undefined || value[key] === null) {
      return null;
    }
    if (
      typeof value[key] !== 'number' ||
      !Number.isFinite(value[key]) ||
      value[key] < 0 ||
      value[key] > 1
    ) {
      throw new Error('Posición de overlay no válida');
    }
    return value[key];
  };
  if (value.minimal !== undefined && typeof value.minimal !== 'boolean') {
    throw new Error('Vista de overlay no válida');
  }
  const height = dimension('height', 0, 0, 600);
  if (height > 0 && height < 80) {
    throw new Error('Altura de overlay no válida');
  }
  return {
    width: dimension('width', 300, 220, 520),
    height,
    minimal: value.minimal === true,
    offsetX: offset('offsetX'),
    offsetY: offset('offsetY'),
    opacity: Math.round(value.opacity),
    position: value.position as WorldsOverlayPreferences['position'],
    showVoice: value.showVoice,
    showPresence: value.showPresence,
    animations: value.animations,
  };
}

export function isMinimalWorldsOverlay(value: WorldsOverlayPreferences): boolean {
  return value.minimal || value.width < 280 || (value.height > 0 && value.height < 220);
}
