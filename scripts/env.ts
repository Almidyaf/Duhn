import { config } from 'dotenv';

config({ path: process.env.DUHN_TEST === '1' ? '.env.test.local' : '.env.local', quiet: true });

export function assertTestDatabase() {
  const db = new URL(process.env.DATABASE_URL || '').pathname.slice(1);
  if (!db.endsWith('_test')) throw new Error('Tests require a separate database ending in _test.');
}
