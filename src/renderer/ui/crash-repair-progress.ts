import { setUiText } from '../i18n/dialog-text';

export function showCrashRepairProgress(
  reportId: string,
  repairId: string,
  dependency: boolean,
): () => Promise<void> {
  const dialog = document.createElement('dialog');
  dialog.className = 'battly-ask-modal crash-repair-working';
  const card = document.createElement('section');
  card.className = 'modal-card';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-wand-magic-sparkles crash-thinking-wand';
  icon.setAttribute('aria-hidden', 'true');
  const title = document.createElement('h2');
  title.className = 'title';
  const detail = document.createElement('p');
  detail.className = 'crash-working-detail';
  detail.setAttribute('translate', 'no');
  const progress = document.createElement('progress');
  progress.className = 'progress is-info';
  progress.setAttribute('aria-label', 'Battly AutoFix');
  setUiText(title, 'Buscando una solución compatible…');
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.append(title, detail);
  card.append(icon, status, progress);
  dialog.append(card);
  document.body.append(dialog);
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.showModal();
  // Run repairs immediately, but present their real phases at a readable pace.
  type Phase = { phase: string; mod?: string };
  const queue: Phase[] = [];
  let lastKey = 'searching';
  let visibleUntil = performance.now() + 1_000;
  let worker: Promise<void> | null = null;
  const drain = async () => {
    while (queue.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, visibleUntil - performance.now())),
      );
      const event = queue.shift()!;
      setUiText(
        title,
        event.phase === 'searching'
          ? 'Buscando una solución compatible…'
          : event.phase === 'installing'
            ? 'Instalando mod…'
            : 'Aplicando solución…',
      );
      detail.textContent = event.mod ?? '';
      visibleUntil = performance.now() + 900;
    }
  };
  const enqueue = (event: Phase) => {
    const key = `${event.phase}:${event.mod ?? ''}`;
    if (key === lastKey || (event.phase === 'searching' && lastKey === 'searching')) {
      return;
    }
    lastKey = key;
    // Several downloads arriving at once must not leave a long animation backlog.
    if (queue.at(-1)?.phase === event.phase) {
      queue[queue.length - 1] = event;
    } else {
      queue.push(event);
    }
    if (!worker) {
      worker = drain().finally(() => {
        worker = null;
      });
    }
  };
  if (!dependency) {
    enqueue({ phase: 'repairing' });
  }
  const unsubscribe = window.battly.onCrashRepairProgress((event) => {
    if (event.reportId !== reportId || event.repairId !== repairId) {
      return;
    }
    enqueue(event);
  });
  let closing: Promise<void> | null = null;
  return () => {
    if (closing) {
      return closing;
    }
    unsubscribe();
    closing = (async () => {
      await worker;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, visibleUntil - performance.now())),
      );
      dialog.close();
      dialog.remove();
    })();
    return closing;
  };
}
