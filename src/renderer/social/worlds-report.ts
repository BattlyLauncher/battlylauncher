import type { WorldsControlsApi } from './worlds-controls';
export function showWorldsReport(
  api: Pick<WorldsControlsApi, 'worldsAction'>,
  roomCode: string,
  target?: { userId: string; username: string },
): void {
  if (document.querySelector('[data-worlds-report-dialog]')) {
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.dataset.worldsReportDialog = '';
  dialog.className = 'bw-report-dialog';
  const form = document.createElement('form');
  const title = document.createElement('h2');
  title.textContent = 'Reportar en Battly Worlds';
  title.id = 'bw-report-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const context = document.createElement('p');
  context.textContent = target ? target.username : 'Reportar esta sala';
  const categoryLabel = document.createElement('label');
  categoryLabel.textContent = 'Motivo';
  const category = document.createElement('select');
  category.required = true;
  for (const [value, label] of [
    ['harassment', 'Acoso'],
    ['hate', 'Odio o discriminación'],
    ['cheating', 'Trampas o abuso'],
    ['inappropriate', 'Contenido inapropiado'],
    ['privacy', 'Privacidad'],
    ['other', 'Otro motivo'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    category.append(option);
  }
  categoryLabel.append(category);
  const descriptionLabel = document.createElement('label');
  descriptionLabel.textContent = 'Describe lo ocurrido';
  const description = document.createElement('textarea');
  description.required = true;
  description.minLength = 10;
  description.maxLength = 2000;
  description.rows = 5;
  descriptionLabel.append(description);
  const privacy = document.createElement('p');
  privacy.className = 'bw-hint';
  privacy.textContent =
    'El equipo de Battly revisará el reporte. No incluyas contraseñas ni datos privados.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const footer = document.createElement('footer'),
    cancel = document.createElement('button'),
    send = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'bw-secondary';
  cancel.textContent = 'Cancelar';
  send.type = 'submit';
  send.className = 'bw-primary';
  send.textContent = 'Enviar reporte';
  cancel.onclick = () => dialog.close();
  footer.append(cancel, send);
  form.append(title, context, categoryLabel, descriptionLabel, privacy, status, footer);
  dialog.append(form);
  document.body.append(dialog);
  let sending = false;
  dialog.addEventListener('cancel', (event) => {
    if (sending) {
      event.preventDefault();
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.onsubmit = (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) {
      return;
    }
    sending = true;
    send.disabled = true;
    cancel.disabled = true;
    status.textContent = 'Enviando reporte…';
    void api
      .worldsAction({
        type: 'report',
        roomCode,
        category: category.value,
        description: description.value.trim(),
        ...(target ? { targetUserId: target.userId } : {}),
      })
      .then((result) => {
        form.querySelectorAll('label').forEach((label) => {
          label.hidden = true;
        });
        privacy.hidden = true;
        send.hidden = true;
        status.textContent = result.message;
        cancel.textContent = 'Cerrar';
      })
      .catch((error) => {
        status.textContent =
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
            : 'No se pudo enviar el reporte';
      })
      .finally(() => {
        sending = false;
        send.disabled = false;
        cancel.disabled = false;
      });
  };
  dialog.showModal();
  description.focus();
}
