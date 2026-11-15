/** Remember open read-only views so tours close only the dialogs they opened. */
export function tutorialSession() {
  let native = new Set<HTMLDialogElement>();
  let legacy = new Set<HTMLElement>();
  let details = new Map<HTMLDetailsElement, boolean>();
  return {
    start: (): void => {
      details = new Map(
        [...document.querySelectorAll('details')].map((element) => [element, element.open]),
      );
      native = new Set(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
      legacy = new Set(document.querySelectorAll<HTMLElement>('.modal.is-active'));
    },
    finish: (): void => {
      details.forEach((open, element) => {
        if (element.isConnected) {
          element.open = open;
        }
      });
      document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((dialog) => {
        if (!native.has(dialog)) {
          dialog.close();
        }
      });
      document.querySelectorAll<HTMLElement>('.modal.is-active').forEach((dialog) => {
        if (!legacy.has(dialog)) {
          dialog.classList.remove('is-active');
          dialog.setAttribute('aria-hidden', 'true');
        }
      });
    },
  };
}
