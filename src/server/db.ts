import { Pool, type PoolClient } from 'pg';

export function poolSsl(connectionString: string): { rejectUnauthorized: false } | undefined {
  try {
    const url = new URL(connectionString);
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return undefined;
    if (url.searchParams.get('sslmode') === 'disable') return undefined;
    return { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

export function dbSchema(connectionString: string): string {
  const configured = process.env.DB_SCHEMA?.trim();
  if (configured) {
    if (!/^[a-z_][a-z0-9_]*$/.test(configured)) {
      throw new Error('DB_SCHEMA must be a valid lowercase PostgreSQL identifier.');
    }
    return configured;
  }
  return poolSsl(connectionString) ? 'duhn' : 'public';
}

export function poolOptions(connectionString: string): string | undefined {
  const schema = dbSchema(connectionString);
  return schema !== 'public' ? `-c search_path=${schema},public` : undefined;
}

const shared = globalThis as typeof globalThis & { duhnPool?: Pool };
export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  if (!shared.duhnPool) {
    shared.duhnPool = new Pool({
      connectionString,
      ssl: poolSsl(connectionString),
      options: poolOptions(connectionString),
      max: 8,
      connectionTimeoutMillis: 15000,
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
