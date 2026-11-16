import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const test = process.argv.includes('--test');
const name = `duhn-postgres-${test ? 'test' : 'dev'}`;
const database = test ? 'duhn_test' : 'duhn';
const appRole = test ? 'duhn_test_app' : 'duhn_app';
const port = test ? 55439 : 55438;
const envFile = test ? '.env.test.local' : '.env.local';
const docker = (args, options = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
let existing = false;
try {
  const label = docker([
    'inspect',
    '--format',
    '{{index .Config.Labels "com.duhn.project"}}',
    name,
  ]).trim();
  if (label !== 'duhn-factory') throw new Error('Container name belongs to another project.');
  existing = true;
} catch (error) {
  if (!/no such object/i.test(String(error.stderr || ''))) throw error;
}
if (existing) {
  if (!existsSync(envFile))
    throw new Error(
      `Container exists but ${envFile} is missing. Restore its configuration; secrets will not be overwritten.`,
    );
  docker(['start', name]);
  console.log(`Reused ${name}; configuration in ${envFile}.`);
  process.exit(0);
}
if (existsSync(envFile))
  throw new Error(`${envFile} already exists. No existing configuration was overwritten.`);
const adminPassword = randomBytes(24).toString('hex');
const appPassword = randomBytes(24).toString('hex');
mkdirSync('.local', { recursive: true, mode: 0o700 });
const containerEnv = `.local/${name}.env`;
writeFileSync(
  containerEnv,
  `POSTGRES_USER=duhn_admin\nPOSTGRES_PASSWORD=${adminPassword}\nPOSTGRES_DB=${database}\n`,
  { mode: 0o600 },
);
docker([
  'run',
  '--detach',
  '--name',
  name,
  '--label',
  'com.duhn.project=duhn-factory',
  '--memory',
  '512m',
  '--cpus',
  '1',
  '--env-file',
  containerEnv,
  '--publish',
  `127.0.0.1:${port}:5432`,
  '--volume',
  `${name}:/var/lib/postgresql/data`,
  'postgres:17.11-alpine',
]);
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    docker(['exec', name, 'pg_isready', '-U', 'duhn_admin', '-d', database]);
    ready = true;
    break;
  } catch {
    await setTimeout(500);
  }
}
if (!ready) throw new Error('Database did not become ready. Inspect this project container logs.');
const sql = `CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE ${database} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${database} TO ${appRole};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ${appRole};
ALTER DEFAULT PRIVILEGES FOR ROLE duhn_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole};
ALTER DEFAULT PRIVILEGES FOR ROLE duhn_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appRole};`;
docker(['exec', '-i', name, 'psql', '-U', 'duhn_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], {
  input: sql,
});
const base = `postgresql://${appRole}:${appPassword}@127.0.0.1:${port}/${database}`;
const admin = `postgresql://duhn_admin:${adminPassword}@127.0.0.1:${port}/${database}`;
writeFileSync(
  envFile,
  `DATABASE_URL=${base}\nMIGRATION_DATABASE_URL=${admin}\nBETTER_AUTH_URL=http://localhost:${test ? '3109' : '3108'}\nBETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}\n`,
  { mode: 0o600 },
);
console.log(
  `Created isolated ${database} database on 127.0.0.1:${port}. Secrets stored in ignored ${envFile}.`,
);
