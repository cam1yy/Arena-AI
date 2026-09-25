import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages (TypeScript sources) are bundled; third-party
  // dependencies stay external and are resolved from node_modules at runtime.
  noExternal: [/^@localy\//],
  skipNodeModulesBundle: true,
});
