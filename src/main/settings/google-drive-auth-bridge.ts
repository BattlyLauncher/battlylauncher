import type { BrowserWindow } from 'electron';
import { desktopChannels } from '../../shared/desktop-api';

export function isGoogleDriveCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === 'https://battlylauncher.com' &&
      parsed.pathname === '/google-drive/callback' &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

/** Read the server's JSON literal, never execute the callback script. */
export function callbackCredentials(scripts: readonly string[]): unknown {
  for (const script of scripts) {
    if (script.length > 65536) {
      continue;
    }
    const match = /postMessage\s*\(\s*\{\s*type\s*:\s*(['"])google-tokens\1\s*,\s*tokens\s*:/.exec(
      script,
    );
    if (!match) {
      continue;
    }
    const start = script.indexOf('{', match.index + match[0].length);
    if (start < 0) {
      continue;
    }
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let index = start; index < script.length; index++) {
      const char = script[index];
      if (quoted) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          quoted = false;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}' && --depth === 0) {
        try {
          return JSON.parse(script.slice(start, index + 1)) as unknown;
        } catch {
          break;
        }
      }
      if (depth > 16) {
        break;
      }
    }
  }
  return null;
}

export function bridgeGoogleDriveAuthorization(owner: BrowserWindow, popup: BrowserWindow): void {
  let delivered = false;
  popup.webContents.on('dom-ready', () => {
    if (delivered || popup.isDestroyed() || !isGoogleDriveCallback(popup.webContents.getURL())) {
      return;
    }
    void popup.webContents
      .executeJavaScript(
        'Array.from(document.scripts).slice(0, 16).map(script => script.textContent.slice(0, 65537))',
      )
      .then((scripts: unknown) => {
        if (
          delivered ||
          owner.isDestroyed() ||
          popup.isDestroyed() ||
          !isGoogleDriveCallback(popup.webContents.getURL())
        ) {
          return;
        }
        if (!Array.isArray(scripts) || !scripts.every((item) => typeof item === 'string')) {
          return;
        }
        const credentials = callbackCredentials(scripts);
        if (!credentials) {
          return;
        }
        delivered = true;
        owner.webContents.send(desktopChannels.googleDriveAuthorization, credentials);
      })
      .catch(() => undefined);
  });
}
