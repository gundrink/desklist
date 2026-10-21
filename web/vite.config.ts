import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  server: { port: 5174, strictPort: true, fs: { allow: [path.resolve(root, '..')] } },
  preview: { port: 5174, strictPort: true },
  resolve: { alias: { '@desklist/shared': path.join(root, '../shared/src/index.ts') } },
  plugins: [react()],
});
