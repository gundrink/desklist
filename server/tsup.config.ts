import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/migrate.ts', 'src/seed.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // bundle the workspace types package; keep real npm deps external
  noExternal: ['@desklist/shared'],
});
