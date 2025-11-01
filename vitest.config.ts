import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'build/**',
        'src/__tests__/**',
        '**/*.test.ts',
      ],
    },
    testTimeout: 10000, // 10 seconds for e2e tests
  },
});
