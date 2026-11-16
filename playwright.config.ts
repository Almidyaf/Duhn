import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
process.env.DUHN_TEST = '1';
config({ path: '.env.test.local', override: true, quiet: true });

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3109', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx next dev --hostname 127.0.0.1 --port 3109',
    url: 'http://localhost:3109/login',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
