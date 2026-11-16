import { Pool, type PoolClient } from 'pg';

export function poolSsl(connectionString: string): { rejectUnauthorized: false } | undefined {
  try {
    const url = new URL(connectionString);
    if (['localhost', '127.0.0.1'].includes(url.hostname)) return undefined;
    if (url.hostname.endsWith('.hyperdrive.local')) return undefined;
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
  if (poolSsl(connectionString)) return 'duhn';
  try {
    if (new URL(connectionString).hostname.endsWith('.hyperdrive.local')) return 'duhn';
  } catch {
    // ignore
  }
  return 'public';
}

export function poolOptions(connectionString: string): string | undefined {
  const schema = dbSchema(connectionString);
  return schema !== 'public' ? `-c search_path=${schema},public` : undefined;
}

type CfContext = {
  env?: { HYPERDRIVE?: { connectionString?: string } };
  __duhnPool?: Pool;
};

function getCfContext(): CfContext | undefined {
  return (globalThis as Record<symbol, CfContext | undefined>)[
    Symbol.for('__cloudflare-context__')
  ];
}

const shared = globalThis as typeof globalThis & { duhnPool?: Pool };
export function getPool() {
  const cf = getCfContext();
  const hyperdriveUrl = cf?.env?.HYPERDRIVE?.connectionString;
  const connectionString = hyperdriveUrl || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  const createPool = () => {
    const pool = new Pool({
      connectionString,
      ssl: hyperdriveUrl ? undefined : poolSsl(connectionString),
      options: poolOptions(connectionString),
      max: cf ? 5 : 8,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'duhn-web',
    });
    pool.on('error', () => console.error('Database pool connection error.'));
    return pool;
  };

  if (cf) {
    return (cf.__duhnPool ??= createPool());
  }
  if (!shared.duhnPool) {
    shared.duhnPool = createPool();
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
