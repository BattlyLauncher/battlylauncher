import type { BattlyDesktopApi } from '../shared/desktop-api';

declare global {
  interface Window {
    battly: BattlyDesktopApi;
  }
}

export {};
