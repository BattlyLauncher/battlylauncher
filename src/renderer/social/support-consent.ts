import { askBattly } from '../ui/ask-modal';

export function mountSupportConsent(): void {
  let current: AbortController | undefined;
  const cancel = (): void => current?.abort();
  const unsubscribe = window.battly.onSupportConsentRequest((request) => {
    if (current || document.body.dataset.panel === 'login' || request.expiresAt <= Date.now()) {
      void window.battly.respondSupportConsent(request.id, false).catch(() => undefined);
      return;
    }
    const controller = new AbortController();
    current = controller;
    const timer = setTimeout(() => controller.abort(), Math.max(0, request.expiresAt - Date.now()));
    void askBattly({
      title: 'Asistencia de Battly',
      text: '¿Permitir una sesión de asistencia remota?',
      note: 'El equipo de soporte podrá revisar registros y modificar archivos y ajustes para ayudarte. Acepta solo si has solicitado ayuda. El permiso dura 10 minutos y termina al desconectarte o cerrar Battly.',
      cancelText: 'Cancelar',
      confirmText: 'Permitir asistencia',
      focusCancel: true,
      signal: controller.signal,
    })
      .then((accepted) =>
        window.battly.respondSupportConsent(request.id, accepted && !controller.signal.aborted),
      )
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        if (current === controller) {
          current = undefined;
        }
      });
  });
  window.addEventListener('battly:account-changed', cancel);
  const unsubscribeState = window.battly.onSocialRealtimeState((state) => {
    if (state === 'disconnected' || state === 'reconnecting') {
      cancel();
    }
  });
  window.addEventListener(
    'beforeunload',
    () => {
      cancel();
      unsubscribe();
      unsubscribeState();
      window.removeEventListener('battly:account-changed', cancel);
    },
    { once: true },
  );
}
