const invocationPrefix = /^\s*(?:Error:\s*)?Error invoking remote method (?:'[^']*'|"[^"]*"):\s*/;
const errorTypePrefix = /^(?:(?:Error|[A-Z][A-Za-z]*Error):\s*)+/;
const internalIpcFailure =
  /^(?:No handler registered for\b|An object could not be cloned\b|Object has been destroyed\b|Cannot serialize arguments\b|ERR_IPC_\w+\b|Rejected IPC request from an untrusted renderer\b)/;
const unavailableMessage = 'No se pudo completar la acción. Vuelve a intentarlo.';

/** Remove Electron's transport wrapper, preserving the application's explanation. */
export function stripElectronErrorPrefix(value: string): string {
  let message = value;
  for (let depth = 0; depth < 16; depth += 1) {
    const unwrapped = message.replace(invocationPrefix, '');
    if (unwrapped === message) {
      break;
    }
    message = unwrapped.replace(errorTypePrefix, '');
  }
  return message;
}

type IpcInvoke = (channel: string, ...arguments_: unknown[]) => Promise<unknown>;

export function createIpcInvoker(invoke: IpcInvoke): IpcInvoke {
  return async (channel, ...arguments_) => {
    try {
      return await invoke(channel, ...arguments_);
    } catch (error) {
      const original =
        error && typeof error === 'object' && 'message' in error ? error.message : error;
      const detail = typeof original === 'string' ? stripElectronErrorPrefix(original) : '';
      const message =
        internalIpcFailure.test(detail) || !detail.trim() ? unavailableMessage : detail;
      if (error instanceof Error && message === error.message && message.trim()) {
        throw error;
      }
      throw new Error(message, { cause: error });
    }
  };
}
