import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
    },
    target: 'node24',
    outDir: 'dist',
    rolldownOptions: {
      platform: 'node',
      external: [
        ...builtinModules.flatMap((p) => [p, `node:${p}`]),
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
    minify: false,
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
