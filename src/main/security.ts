import type { WebPreferences } from 'electron';

export function createSecureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

export function isTrustedRendererUrl(candidate: string, expectedDocument: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(expectedDocument);

    return (
      actual.protocol === expected.protocol &&
      actual.host === expected.host &&
      actual.pathname === expected.pathname
    );
  } catch {
    return false;
  }
}
