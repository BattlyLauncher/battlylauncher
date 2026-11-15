import { app, BrowserWindow, dialog } from 'electron';

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

export function maintenanceWindowHtml(
  message: string,
  translate: (text: string) => string,
): string {
  const title = escapeHtml(translate('Battly está en mantenimiento'));
  const explanation = escapeHtml(
    message ||
      translate('Estamos realizando tareas de mantenimiento. Vuelve a intentarlo más tarde.'),
  );
  const closing = escapeHtml(translate('Battly se cerrará en unos segundos.'));
  const close = escapeHtml(translate('Cerrar Battly'));
  return /* HTML */ `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'"
        />
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: #101827;
            color: #f3f6fc;
            font:
              15px system-ui,
              sans-serif;
          }
          header {
            padding: 22px 28px;
            border-bottom: 1px solid #ffffff15;
            font-weight: 700;
          }
          main {
            flex: 1;
            min-height: 0;
            padding: 26px 28px;
            overflow: auto;
          }
          h1 {
            margin: 0 0 20px;
            font-size: 25px;
          }
          .message {
            padding: 18px;
            border-left: 3px solid #f4bf56;
            border-radius: 8px;
            background: #1a2638;
            color: #d5dfed;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          p {
            color: #9fb1c8;
            line-height: 1.6;
          }
          footer {
            padding: 0 28px 24px;
            text-align: right;
          }
          a {
            display: inline-block;
            padding: 11px 20px;
            border-radius: 9px;
            background: #7652ca;
            color: white;
            text-decoration: none;
            font-weight: 600;
          }
          a:focus-visible {
            outline: 2px solid #c9b7ff;
            outline-offset: 3px;
          }
        </style>
      </head>
      <body>
        <header>Battly Launcher</header>
        <main>
          <h1>${title}</h1>
          <div class="message">${explanation}</div>
          <p>${closing}</p>
        </main>
        <footer><a href="https://battly.invalid/close">${close}</a></footer>
      </body>
    </html>`;
}

export class MaintenanceWindow {
  #window?: BrowserWindow;
  #timer?: ReturnType<typeof setTimeout>;

  focus(): boolean {
    if (!this.#window || this.#window.isDestroyed()) {
      return false;
    }
    if (this.#window.isMinimized()) {
      this.#window.restore();
    }
    this.#window.show();
    this.#window.focus();
    return true;
  }

  show(message: string, translate: (text: string) => string): void {
    const window = new BrowserWindow({
      width: 640,
      height: 400,
      useContentSize: true,
      show: false,
      resizable: false,
      autoHideMenuBar: true,
      title: 'Battly Launcher',
      backgroundColor: '#101827',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.#window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      app.quit();
    });
    window.on('closed', () => {
      clearTimeout(this.#timer);
      this.#window = undefined;
      app.quit();
    });
    window.once('ready-to-show', () => {
      if (window.isDestroyed()) {
        return;
      }
      window.show();
      window.focus();
      this.#timer = setTimeout(() => app.quit(), 10_000);
    });
    void window
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(maintenanceWindowHtml(message, translate))}`,
      )
      .catch(() => {
        if (!window.isDestroyed()) {
          dialog.showErrorBox(translate('Battly está en mantenimiento'), message);
          app.quit();
        }
      });
  }
}
