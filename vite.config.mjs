import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist/renderer'),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        launcher: resolve(import.meta.dirname, 'src/renderer/index.html'),
        worldsOverlay: resolve(import.meta.dirname, 'src/renderer/worlds-overlay.html'),
        splash: resolve(import.meta.dirname, 'src/renderer/splash.html'),
        startupUpdate: resolve(import.meta.dirname, 'src/renderer/startup-update.html'),
      },
    },
  },
});
