import { defineConfig } from 'tsup';
import { fileURLToPath } from 'node:url';
const shared = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));
export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // bundle the workspace types package (resolved by path, so `npm ci -w server` in Docker works); keep npm deps external
  noExternal: ['@desklist/shared'],
  esbuildOptions(o) { o.alias = { ...(o.alias ?? {}), '@desklist/shared': shared }; },
});
