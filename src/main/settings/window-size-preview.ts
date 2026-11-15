import { BrowserWindow, dialog, screen } from 'electron';
import { scrollbarStyle } from '../scrollbar-style';
import { normalizeRuntimeSettings } from '../../shared/settings/settings-contract';
import { translateDialogOptions } from '../i18n/native-language';

let activePreview: Promise<{ width: number; height: number } | null> | undefined;

export function previewMinecraftWindow(
  parent: BrowserWindow,
  value: unknown,
  translate: (source: string) => string,
  language: string,
): Promise<{ width: number; height: number } | null> {
  if (activePreview) {
    return activePreview;
  }
  const size = normalizeRuntimeSettings(value);
  const workArea = screen.getDisplayMatching(parent.getBounds()).workAreaSize;
  activePreview = new Promise<{ width: number; height: number } | null>((resolve, reject) => {
    const preview = new BrowserWindow({
      parent,
      width: Math.min(size.windowWidth, workArea.width - 40),
      height: Math.min(size.windowHeight, workArea.height - 80),
      useContentSize: true,
      minWidth: 336,
      minHeight: 280,
      maxWidth: 7696,
      maxHeight: 4360,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#101723',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    let asking = false;
    let result: { width: number; height: number } | null = null;
    const dimensions = () => {
      const [width, height] = preview.getContentSize();
      return { width: Math.round(width), height: Math.round(height) };
    };
    const updateTitle = () => {
      const { width, height } = dimensions();
      preview.setTitle(
        translate(`Battly · Minecraft · ${width} × ${height} — Cierra para guardar`),
      );
    };
    preview.on('resize', updateTitle);
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    preview.webContents.on('will-navigate', (event) => event.preventDefault());
    preview.on('close', (event) => {
      event.preventDefault();
      if (asking) {
        return;
      }
      asking = true;
      const picked = dimensions();
      void dialog
        .showMessageBox(
          preview,
          translateDialogOptions(
            {
              type: 'question',
              title: 'Tamaño de Minecraft',
              message: `¿Guardar ${picked.width} × ${picked.height}?`,
              detail: 'Se usará este tamaño al iniciar Minecraft.',
              buttons: ['Guardar tamaño', 'Seguir ajustando', 'Descartar'],
              defaultId: 0,
              cancelId: 1,
            },
            translate,
          ),
        )
        .then(({ response }) => {
          asking = false;
          if (preview.isDestroyed() || response === 1) {
            return;
          }
          if (response === 0) {
            result = picked;
          }
          preview.destroy();
        })
        .catch(() => {
          asking = false;
        });
    });
    preview.once('closed', () => resolve(result));
    preview.once('ready-to-show', () => {
      const [outerWidth, outerHeight] = preview.getSize();
      const [innerWidth, innerHeight] = preview.getContentSize();
      preview.setMinimumSize(320 + outerWidth - innerWidth, 240 + outerHeight - innerHeight);
      preview.setMaximumSize(7680 + outerWidth - innerWidth, 4320 + outerHeight - innerHeight);
      updateTitle();
      preview.show();
    });
    const htmlText = (text: string) =>
      translate(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    const html = /* HTML */ `<!doctype html>
      <html
        lang="${language}"
        dir="${language === 'ar' ? 'rtl' : 'ltr'}"
      >
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'"
        />
        <style>
          ${scrollbarStyle}html,
          body {
            height: 100%;
            margin: 0;
          }
          body {
            box-sizing: border-box;
            display: grid;
            place-items: center;
            padding: 24px;
            background: #101723;
            color: #f4f5fa;
            font: 16px system-ui;
            text-align: center;
            border: 2px solid #7850c6;
          }
          main {
            max-width: 480px;
          }
          h1 {
            font-size: 24px;
          }
          p {
            color: #b6c2d3;
            line-height: 1.6;
          }
          strong {
            color: #ba9bf6;
          }
        </style>
        <main>
          <h1>${htmlText('Elige el tamaño de Minecraft')}</h1>
          <p>
            ${htmlText('Arrastra los bordes o las esquinas de esta ventana. El ancho y el alto aparecen en la barra superior.')}
          </p>
          <p><strong>${htmlText('Cierra esta ventana para guardar el tamaño.')}</strong></p>
          <p>${htmlText('Se mide el área del juego, sin incluir los bordes.')}</p>
        </main>
      </html>`;
    void preview
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      .catch((error) => {
        reject(error instanceof Error ? error : new Error('No se pudo abrir la ventana de prueba'));
        preview.destroy();
      });
  }).finally(() => {
    activePreview = undefined;
  });
  return activePreview;
}
