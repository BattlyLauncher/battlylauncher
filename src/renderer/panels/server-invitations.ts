import type { ServerInvitation } from '../../shared/servers/server-contract';
import type { PlayVersionLaunchRequest } from '../../shared/minecraft/play-version-contract';

export function mountServerInvitations(
  launch: (request: PlayVersionLaunchRequest, label: string) => void,
): void {
  const original = document.getElementById('serverInviteModal');
  const card = original?.querySelector('.modal-card');
  if (!original || !card) {
    return;
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'server-invite-dialog';
  dialog.append(card);
  original.remove();
  document.body.append(dialog);
  const seen = new Map<string, number>();
  const pending: { invite: ServerInvitation; expiresAt: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = (): void => {
    clearTimeout(timer);
    dialog.close();
  };
  dialog.querySelector<HTMLButtonElement>('#reject-server-invite')!.onclick = close;
  const showPending = (): void => {
    if (document.body.dataset.panel === 'login') {
      pending.length = 0;
      return;
    }
    if (document.querySelector('dialog[open]')) {
      return;
    }
    while (pending.length && pending[0].expiresAt <= Date.now()) {
      pending.shift();
    }
    const next = pending.shift();
    if (!next) {
      return;
    }
    const invite = next.invite;
    dialog.querySelector('#invite-friend-name')!.textContent = invite.friendName;
    dialog.querySelector('#invite-server-name')!.textContent =
      `${invite.subdomain}.battlyservers.net`;
    dialog.querySelector('#invite-server-version')!.textContent = invite.serverVersion;
    const image = dialog.querySelector<HTMLImageElement>('#invite-friend-avatar')!;
    image.src = `https://mc-heads.net/avatar/${encodeURIComponent(invite.friendName)}/128`;
    dialog.querySelector<HTMLButtonElement>('#accept-server-invite')!.onclick = () => {
      if (!dialog.open) {
        return;
      }
      close();
      if (document.body.dataset.panel === 'login') {
        pending.length = 0;
        return;
      }
      launch(
        {
          version: invite.serverVersion,
          custom: false,
          customVersion: '',
          loader: 'vanilla',
          loaderVersion: '',
          requiredJavaVersion: '',
          safeMode: false,
          directConnect: { host: `${invite.subdomain}.battlyservers.net`, port: 25565 },
        },
        `Servidor ${invite.subdomain}`,
      );
    };
    dialog.showModal();
    timer = setTimeout(close, Math.max(0, next.expiresAt - Date.now()));
  };
  const afterClose = (): void => {
    queueMicrotask(showPending);
  };
  dialog.addEventListener('close', () => clearTimeout(timer));
  document.addEventListener('close', afterClose, true);
  const clearSession = (): void => {
    pending.length = 0;
    seen.clear();
    close();
  };
  window.addEventListener('battly:account-changed', clearSession);
  const unsubscribe = window.battly.onServerInvitation((invite) => {
    if (document.body.dataset.panel === 'login') {
      return;
    }
    const key = JSON.stringify(invite);
    const now = Date.now();
    for (const [entry, at] of seen) {
      if (now - at >= 15000) {
        seen.delete(entry);
      }
    }
    if (seen.has(key) || pending.length >= 10) {
      return;
    }
    seen.set(key, now);
    pending.push({ invite, expiresAt: now + 15000 });
    showPending();
  });
  window.addEventListener(
    'beforeunload',
    () => {
      unsubscribe();
      clearTimeout(timer);
      pending.length = 0;
      document.removeEventListener('close', afterClose, true);
      window.removeEventListener('battly:account-changed', clearSession);
    },
    { once: true },
  );
}
