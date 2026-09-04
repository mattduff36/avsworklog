import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    // Avoid high-core machines starving individual tests under full-suite load.
    fileParallelism: true,
    maxWorkers: 4,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
    testTimeout: 120_000,
    setupFiles: ['./tests/setup.ts'],
    reporters: ['default', './scripts/automation/tee-vitest-progress-reporter.cjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'app/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/*.config.*',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/tests/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
