import { Pool, type PoolClient } from 'pg';

const shared = globalThis as typeof globalThis & { duhnPool?: Pool };
export function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if (!shared.duhnPool) {
    shared.duhnPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'duhn-web',
    });
    shared.duhnPool.on('error', () => console.error('Database pool connection error.'));
  }
  return shared.duhnPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
