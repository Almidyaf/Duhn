import './env';
import { parseArgs } from 'node:util';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { Pool } from 'pg';
import { z } from 'zod';
import { createAuth } from '../src/server/auth';
import { getPool } from '../src/server/db';

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean' },
    },
  });
  let email = values.email ?? '',
    name = values.name ?? '',
    password = '';
  if (values['password-stdin']) {
    for await (const chunk of process.stdin) password += chunk;
    password = password.replace(/\r?\n$/, '');
  } else {
    if (!process.stdin.isTTY)
      throw new Error('Use --email, --name and --password-stdin in non-interactive mode.');
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (!muted) process.stdout.write(chunk);
        callback();
      },
    });
    const input = createInterface({ input: process.stdin, output, terminal: true });
    try {
      email ||= await input.question('Owner email: ');
      name ||= await input.question('Owner name: ');
      process.stdout.write('Password (12+ characters, hidden): ');
      muted = true;
      password = await input.question('');
      muted = false;
      process.stdout.write('\nConfirm password (hidden): ');
      muted = true;
      const confirmation = await input.question('');
      muted = false;
      process.stdout.write('\n');
      if (password !== confirmation) throw new Error('Passwords do not match.');
    } finally {
      input.close();
    }
  }
  email = z.email().parse(email.trim());
  name = z.string().trim().min(2).max(120).parse(name);
  z.string().min(12).max(128).parse(password);
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(72703109)');
    const owners = await client.query("SELECT user_id FROM app_members WHERE role='owner'");
    if (owners.rowCount) throw new Error('An owner already exists. No account was changed.');
    const result = await createAuth(true).api.signUpEmail({ body: { email, name, password } });
    await client.query("INSERT INTO app_members(user_id,role) VALUES($1,'owner')", [
      result.user.id,
    ]);
    console.log('Owner created. Public registration remains disabled.');
  } finally {
    await client.query('SELECT pg_advisory_unlock(72703109)');
    client.release();
    await pool.end();
  }
}
main()
  .catch((error) => {
    console.error(
      error instanceof z.ZodError
        ? 'Check email, name and password requirements.'
        : error instanceof Error
          ? error.message
          : 'Owner creation failed.',
    );
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
