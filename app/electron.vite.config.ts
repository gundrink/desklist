import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Hosted sync server baked into packaged builds; override at build time with DESKLIST_DEFAULT_SERVER_URL.
const DEFAULT_SERVER_URL = process.env.DESKLIST_DEFAULT_SERVER_URL || 'https://server-production-46b2.up.railway.app';

const shared = { '@desklist/shared': resolve(__dirname, '../shared/src/index.ts') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    define: { __DESKLIST_DEFAULT_SERVER__: JSON.stringify(DEFAULT_SERVER_URL) },
    // keep real npm deps external (koffi is native), but bundle our workspace types package
    build: { externalizeDeps: { exclude: ['@desklist/shared'] } },
  },
  preload: {
    resolve: { alias: shared },
    build: { externalizeDeps: { exclude: ['@desklist/shared'] }, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: shared },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
});
