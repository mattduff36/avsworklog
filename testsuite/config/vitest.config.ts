import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [path.resolve(__dirname, '../../tests/setup.ts')],
    include: [
      'testsuite/api/**/*.test.ts',
    ],
    reporters: ['verbose', 'json'],
    outputFile: {
      json: path.resolve(__dirname, '../reports/vitest-results.json'),
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../'),
    },
  },
});
