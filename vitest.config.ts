import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

process.env.DUHN_TEST = '1';
config({ path: '.env.test.local', override: true, quiet: true });
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
