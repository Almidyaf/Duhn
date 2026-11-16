import { test as base, expect } from '@playwright/test';
import { getPool } from '../src/server/db';
import { assertTestDatabase } from '../scripts/env';

// Multiple spec files can share a worker. Close the shared pool at worker teardown,
// not after the first file, while Better Auth still holds a reference to it.
export const test = base.extend<{ rateLimitState: void }, { databaseLifecycle: void }>({
  rateLimitState: [
    async ({}, use) => {
      assertTestDatabase();
      // Independent serial tests must not consume each other's login attempt quota.
      await getPool().query('DELETE FROM "rateLimit"');
      await use();
    },
    { auto: true },
  ],
  databaseLifecycle: [
    async ({}, use) => {
      await use();
      await getPool().end();
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect };
