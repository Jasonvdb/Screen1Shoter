import { defineConfig } from 'vitest/config';

// Two projects: `pnpm test` runs unit only, `pnpm test:smoke` runs the
// Playwright-backed smoke test with a long timeout.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'smoke',
          environment: 'node',
          include: ['tests/smoke/**/*.smoke.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 300_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
