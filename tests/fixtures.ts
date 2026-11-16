import { randomUUID, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { assertTestDatabase } from '../scripts/env';
import { createAuth } from '../src/server/auth';
import type { Member } from '../src/server/members';

export async function testMember(role: Member['role'] = 'manager') {
  assertTestDatabase();
  const email = `test-${randomUUID()}@duhn.invalid`;
  const password = randomBytes(24).toString('base64url');
  const name = 'مستخدم الاختبار';
  const result = await createAuth(true).api.signUpEmail({ body: { email, password, name } });
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    await admin.query('INSERT INTO app_members(user_id,role) VALUES($1,$2)', [
      result.user.id,
      role,
    ]);
  } finally {
    await admin.end();
  }
  return { member: { id: result.user.id, name, role } as Member, email, password };
}
