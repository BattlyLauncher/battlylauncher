import type { BattlyNotice } from '../../shared/notifications';
export function nativeControls(notice: BattlyNotice, platform: string) {
  if (platform !== 'win32' && platform !== 'darwin') {
    return [];
  }
  return [
    ...notice.actions.map((link) => ({
      type: 'button' as const,
      text: link.label,
      options: [link],
    })),
    ...(platform === 'win32'
      ? notice.dropdowns.map((select) => ({
          type: 'selection' as const,
          text: select.label,
          items: select.options.map((v) => v.label),
          options: select.options,
        }))
      : []),
  ].slice(0, 5);
}
