export type BattlyProtocolAction =
  | { readonly type: 'worlds-discord'; readonly secret: string }
  | { readonly type: 'settings' }
  | { readonly type: 'themes'; readonly tab: 'marketplace' | 'share' };

export function isBattlyProtocolAction(value: unknown): value is BattlyProtocolAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  if (source.type === 'worlds-discord') {
    return (
      Object.keys(source).length === 2 &&
      typeof source.secret === 'string' &&
      /^[a-f0-9]{64}$/.test(source.secret)
    );
  }
  if (source.type === 'settings') {
    return Object.keys(source).length === 1;
  }
  if (source.type === 'themes') {
    return (
      Object.keys(source).length === 2 && (source.tab === 'share' || source.tab === 'marketplace')
    );
  }
  return false;
}
