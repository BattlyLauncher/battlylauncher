import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, Notification, app } from 'electron';
import type { AccessBan } from './access-monitor';
import { scrollbarStyle } from '../scrollbar-style';

const escape = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function banWindowHtml(
  ban: AccessBan,
  translate: (text: string) => string = (text) => text,
): string {
  const text = [
    'Acceso suspendido',
    'Tu acceso a Battly está bloqueado.',
    'Motivo del baneo',
    'No puedes jugar ni utilizar las funciones de Battly mientras esta restricción siga activa.',
    'Si crees que se trata de un error, contacta con el soporte de Battly.',
    'Cerrar Battly',
  ].map((value) => escape(translate(value)));
  let fonts = '';
  for (const [file, weight] of [
    ['Regular', 400],
    ['Bold', 700],
  ]) {
    try {
      fonts += `@font-face{font-family:Poppins;font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(__dirname, '../../renderer/assets/fonts', `Poppins-${file}.woff2`)).toString('base64')})}`;
    } catch {
      /* System fonts remain available if the packaged asset is missing. */
    }
  }
  return /* HTML */ `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:"
        />
        <style>
          ${scrollbarStyle} ${fonts} * {
            box-sizing: border-box;
          }
          html {
            color-scheme: dark;
          }
          body {
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin: 0;
            background: #0f1622;
            color: #f4f6fb;
            font:
              15px Poppins,
              system-ui,
              sans-serif;
          }
          header {
            flex-shrink: 0;
            padding: 22px 28px;
            border-bottom: 1px solid #ffffff18;
            font-size: 18px;
            font-weight: 800;
            color: #47a3df;
          }
          main {
            padding: 25px 30px;
            flex: 1;
            min-height: 0;
            overflow: auto;
          }
          h1 {
            font-size: 27px;
            margin: 0 0 12px;
          }
          p {
            color: #b9c8da;
            line-height: 1.6;
            margin: 10px 0;
          }
          .reason {
            margin: 24px 0;
            padding: 18px 20px;
            background: #1a2637;
            border-left: 4px solid #f4b544;
            border-radius: 8px;
            overflow-wrap: anywhere;
            max-height: 190px;
            overflow: auto;
          }
          .reason small {
            display: block;
            color: #f4b544;
            font-weight: 700;
            margin-bottom: 9px;
          }
          .reason div {
            white-space: pre-wrap;
          }
          footer {
            flex-shrink: 0;
            padding: 0 30px 28px;
            text-align: right;
          }
          a {
            display: inline-block;
            padding: 12px 25px;
            background: #3996d5;
            border-radius: 9px;
            color: white;
            text-decoration: none;
            font-weight: 750;
          }
          .badge {
            float: right;
            font-size: 12px;
            background: #f4b54420;
            color: #f4b544;
            padding: 5px 9px;
            border-radius: 6px;
          }
        </style>
      </head>
      <body>
        <header>Battly Launcher <span class="badge">${text[0]}</span></header>
        <main>
          <h1>${text[1]}</h1>
          <p>${text[3]}</p>
          <section class="reason">
            <small>${text[2]}</small>
            <div>${escape(ban.message || text[0])}</div>
          </section>
          <p>${text[4]}</p>
        </main>
        <footer><a href="https://battly.invalid/close">${text[5]}</a></footer>
      </body>
    </html>`;
}

export class BanWindow {
  #window?: BrowserWindow;
  #lifting = false;
  owns(window: BrowserWindow): boolean {
    return this.#window === window;
  }
  show(ban: AccessBan, translate: (text: string) => string): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window !== this.#window) {
        window.hide();
      }
    }
    if (!this.#window || this.#window.isDestroyed()) {
      const window = new BrowserWindow({
        width: 650,
        height: 530,
        useContentSize: true,
        resizable: false,
        autoHideMenuBar: true,
        backgroundColor: '#0f1622',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      this.#window = window;
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => {
        event.preventDefault();
        app.quit();
      });
      window.on('closed', () => {
        this.#window = undefined;
        if (!this.#lifting) {
          app.quit();
        }
      });
    }
    void this.#window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(banWindowHtml(ban, translate))}`,
    );
    this.#window.show();
    if (Notification.isSupported()) {
      const notice = new Notification({
        title: `Battly · ${translate('Acceso suspendido')}`,
        body: ban.message,
        silent: false,
      });
      notice.on('click', () => {
        this.#window?.show();
        this.#window?.focus();
      });
      notice.on('failed', () =>
        console.warn('[access] System notification unavailable; blocking window remains active'),
      );
      notice.show();
    }
  }
  lift(): void {
    this.#lifting = true;
    this.#window?.destroy();
    this.#lifting = false;
  }
}
