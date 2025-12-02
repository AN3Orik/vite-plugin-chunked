import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'client/index': 'src/client/index.ts'
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['vite', 'fs', 'path', 'fs/promises', 'react', 'react-dom'],
  splitting: false,
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
