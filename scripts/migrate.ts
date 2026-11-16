import './env';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';

export async function migrate() {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required.');
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72703108)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir('db/migrations'))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort()) {
      const sql = await readFile(`db/migrations/${name}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [
        name,
      ]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [
          name,
          checksum,
        ]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(72703108)');
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('migrate.ts'))
  migrate().catch(() => {
    console.error(
      'Migration failed. Check database access and migration consistency; no partial migration was committed.',
    );
    process.exitCode = 1;
  });
