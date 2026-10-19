import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const shared = { '@desklist/shared': resolve(__dirname, '../shared/src/index.ts') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
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
