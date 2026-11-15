import driveArtwork from '../legacy/assets/images/rnd/1.png?url';
import './google-drive-auth.css';
let pending: Promise<void> | null = null;

function openGoogleAuthorization(): Promise<void> {
  if (pending) {
    return pending;
  }
  pending = new Promise<void>((resolve, reject) => {
    const popup = window.open(
      'https://battlylauncher.com/google-drive/auth',
      'battly-google-drive-auth',
      'width=600,height=680',
    );
    if (!popup) {
      reject(new Error('No se pudo abrir la autorización de Google'));
      return;
    }
    let saving = false;
    const started = Date.now();
    const cleanup = (): void => {
      window.removeEventListener('message', receive);
      unsubscribe?.();
      clearInterval(timer);
    };
    const receive = (event: MessageEvent): void => {
      const payload: unknown = event.data;
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('type' in payload) ||
        !('tokens' in payload) ||
        saving ||
        event.origin !== 'https://battlylauncher.com' ||
        event.source !== popup ||
        payload.type !== 'google-tokens'
      ) {
        return;
      }
      save(payload.tokens);
    };
    const save = (tokens: unknown): void => {
      if (saving) {
        return;
      }
      saving = true;
      void window.battly
        .saveGoogleDriveCredentials(tokens)
        .then((saved) => {
          if (!saved) {
            throw new Error('Google no ha autorizado la cuenta');
          }
          cleanup();
          popup.close();
          window.dispatchEvent(new Event('battly:drive-changed'));
          resolve();
        })
        .catch((error) => {
          cleanup();
          popup.close();
          reject(error instanceof Error ? error : new Error('No se pudo autorizar Google Drive'));
        });
    };
    const unsubscribe = window.battly.onGoogleDriveAuthorization(save);
    window.addEventListener('message', receive);
    const timer = window.setInterval(() => {
      if (!saving && (popup.closed || Date.now() - started > 300000)) {
        cleanup();
        popup.close();
        reject(new Error('Autorización de Google cancelada'));
      }
    }, 500);
  }).finally(() => {
    pending = null;
  });
  return pending;
}

let introduction: Promise<void> | null = null;
export function authorizeGoogleDrive(): Promise<void> {
  if (introduction) {
    return introduction;
  }
  introduction = new Promise<void>((resolve, reject) => {
    const modal = document.createElement('dialog');
    modal.className = 'drive-original-modal';
    modal.innerHTML = /* HTML */ `<img alt="Battly y Google Drive" />
      <h2>¿Quieres guardar tus mundos de Battly en tu cuenta de Google Drive?</h2>
      <p>
        Si guardas tus mundos en tu cuenta de Google Drive, podrás acceder a ellos desde cualquier
        dispositivo. Aparte, si pierdes tus mundos, podrás recuperarlos fácilmente.
      </p>
      <footer>
        <button
          type="button"
          data-drive-start
        >
          Guardar mundos</button
        ><button
          type="button"
          data-drive-ignore
        >
          Ignorar
        </button>
      </footer>`;
    modal.querySelector('img')!.src = driveArtwork;
    modal
      .querySelector('[data-drive-start]')!
      .insertAdjacentHTML(
        'afterbegin',
        '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> ',
      );
    modal
      .querySelector('[data-drive-ignore]')!
      .insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-xmark" aria-hidden="true"></i> ');
    const start = modal.querySelector<HTMLButtonElement>('[data-drive-start]')!;
    const ignore = modal.querySelector<HTMLButtonElement>('[data-drive-ignore]')!;
    const finish = (): void => {
      modal.close();
      modal.remove();
    };
    const cancel = (): void => {
      finish();
      reject(new Error('Autorización de Google cancelada'));
    };
    ignore.addEventListener('click', cancel);
    modal.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!start.disabled) {
        cancel();
      }
    });
    start.addEventListener('click', () => {
      start.disabled = true;
      ignore.disabled = true;
      start.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-label="Conectando"></i>';
      modal.querySelector('h2')!.textContent = 'Espera un momento...';
      modal.querySelector('p')!.textContent =
        'Se abrirá una ventana para iniciar sesión en tu cuenta de Google. Acepta los permisos de acceso para guardar tus mundos en Google Drive. Las credenciales se guardan localmente en Battly.';
      void openGoogleAuthorization().then(
        () => {
          finish();
          resolve();
        },
        (error: unknown) => {
          finish();
          reject(error instanceof Error ? error : new Error('No se pudo autorizar Google Drive'));
        },
      );
    });
    document.body.append(modal);
    modal.showModal();
  }).finally(() => {
    introduction = null;
  });
  return introduction;
}
