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

function scopePoolSchema(pool: Pool, schema: string): Pool {
  const wrapped = new WeakSet<PoolClient>();
  const beginScopedSql = `BEGIN; SET LOCAL search_path TO "${schema}", public;`;
  const setLocalSql = `SET LOCAL search_path TO "${schema}", public`;

  const wrapClient = (client: PoolClient): PoolClient => {
    if (wrapped.has(client)) return client;
    wrapped.add(client);
    const origQuery = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
    let inTx = false;

    client.query = ((...args: unknown[]) => {
      const last = args[args.length - 1];
      if (typeof last === 'function') {
        return (origQuery as (...a: unknown[]) => unknown)(...args);
      }
      const first = args[0];
      const sql = (typeof first === 'string' ? first : (first as { text?: string })?.text ?? '').trim();

      return (async () => {
        if (/^BEGIN\b/i.test(sql)) {
          if (args.length === 1 && typeof first === 'string') {
            const res = await origQuery(`${sql.replace(/;+$/, '')}; ${setLocalSql};`);
            inTx = true;
            return res;
          }
          const res = await origQuery(...args);
          inTx = true;
          await origQuery(setLocalSql);
          return res;
        }
        if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) {
          try {
            return await origQuery(...args);
          } finally {
            inTx = false;
          }
        }
        if (inTx) {
          return origQuery(...args);
        }
        await origQuery(beginScopedSql);
        try {
          const res = await origQuery(...args);
          await origQuery('COMMIT');
          return res;
        } catch (err) {
          await origQuery('ROLLBACK').catch(() => {});
          throw err;
        }
      })();
    }) as PoolClient['query'];

    return client;
  };

  const origConnect = pool.connect.bind(pool) as (
    cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void,
  ) => Promise<PoolClient>;

  pool.connect = ((
    cb?: (err: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void,
  ) => {
    if (typeof cb === 'function') {
      return origConnect((err, client, done) => {
        cb(err, client ? wrapClient(client) : client, done);
      });
    }
    return origConnect().then(wrapClient);
  }) as Pool['connect'];

  const origPoolQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  pool.query = ((...args: unknown[]) => {
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      return (origPoolQuery as (...a: unknown[]) => unknown)(...args);
    }
    return (async () => {
      const client = await pool.connect();
      try {
        return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        client.release();
      }
    })();
  }) as Pool['query'];

  return pool;
}

const shared = globalThis as typeof globalThis & { duhnPool?: Pool };
export function getPool() {
  const cf = getCfContext();
  const hyperdriveUrl = cf?.env?.HYPERDRIVE?.connectionString;
  const connectionString = hyperdriveUrl || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  const createPool = () => {
    const schema = hyperdriveUrl
      ? process.env.DB_SCHEMA?.trim() || 'duhn'
      : dbSchema(connectionString);
    const pool = new Pool({
      connectionString,
      ssl: hyperdriveUrl ? undefined : poolSsl(connectionString),
      options: hyperdriveUrl ? undefined : poolOptions(connectionString),
      max: cf ? 5 : 8,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      application_name: 'duhn-web',
    });
    pool.on('error', () => console.error('Database pool connection error.'));
    return hyperdriveUrl && schema !== 'public' ? scopePoolSchema(pool, schema) : pool;
  };

  if (cf) {
    return (cf.__duhnPool ??= createPool());
  }
  if (!shared.duhnPool) {
    shared.duhnPool = createPool();
  }
  return shared.duhnPool;
}

export function getDynamicPool(): Pool {
  return new Proxy({} as Pool, {
    get(_target, prop) {
      const pool = getPool();
      const value = Reflect.get(pool, prop, pool);
      return typeof value === 'function' ? value.bind(pool) : value;
    },
  });
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
