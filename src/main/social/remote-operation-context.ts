import { AsyncLocalStorage } from 'node:async_hooks';
export const remoteOperationContext = new AsyncLocalStorage<AbortSignal>();
