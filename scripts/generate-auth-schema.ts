import './env';
import { mkdir, writeFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/server/auth';
import { getPool } from '../src/server/db';

async function main() {
  const migration = await getMigrations(createAuth().options);
  const sql = await migration.compileMigrations();
  if (!sql.trim()) throw new Error('Generate the initial auth schema against an empty database.');
  await mkdir('db/migrations', { recursive: true });
  await writeFile(
    'db/migrations/001_auth.sql',
    '-- Generated from pinned Better Auth 1.7.16; reviewed before migration.\n' + sql + '\n',
    { flag: 'wx' },
  );
}
main().finally(() => getPool().end());
