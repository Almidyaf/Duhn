import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { assertTestDatabase } from '../../scripts/env';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import { createAsset, updateAsset, listAssets } from '../../src/server/assets';
import type { Member } from '../../src/server/members';
import { testMember } from '../fixtures';

let member: Member;
const input = {
  name: 'فرن الاختبار',
  category: 'oven' as const,
  location: 'منطقة التجربة',
  notes: '',
};
beforeAll(async () => {
  assertTestDatabase();
  await migrate();
  member = (await testMember()).member;
});
afterAll(async () => {
  await getPool().end();
});

it('persists one asset and one audit entry for concurrent copies of a request', async () => {
  const key = randomUUID();
  const [a, b] = await Promise.all([
    createAsset(member, key, input),
    createAsset(member, key, input),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    (
      await getPool().query('SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1', [
        a.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(createAsset(member, key, { ...input, name: 'طلب مختلف' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
});
it('permits only one concurrent update with the same old version', async () => {
  const original = await createAsset(member, randomUUID(), input);
  const update = { ...input, active: true, expected_version: original.version };
  const results = await Promise.allSettled([
    updateAsset(member, randomUUID(), original.id, { ...update, name: 'الاسم الأول' }),
    updateAsset(member, randomUUID(), original.id, { ...update, name: 'الاسم الثاني' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const row = (await getPool().query('SELECT version FROM assets WHERE id=$1', [original.id]))
    .rows[0];
  expect(row.version).toBe(2);
});
it('returns a successful retry before checking its now-stale version', async () => {
  const original = await createAsset(member, randomUUID(), input);
  const key = randomUUID(),
    body = { ...input, active: false, expected_version: 1 };
  const first = await updateAsset(member, key, original.id, body);
  expect(await updateAsset(member, key, original.id, body)).toEqual(first);
  expect(first.version).toBe(2);
});
it('rolls back an unsuccessful update and its idempotency reservation', async () => {
  const original = await createAsset(member, randomUUID(), input);
  const key = randomUUID();
  await expect(
    updateAsset(member, key, original.id, { ...input, active: true, expected_version: 99 }),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(
    (
      await getPool().query(
        'SELECT 1 FROM idempotency_requests WHERE actor_id=$1 AND request_key=$2',
        [member.id, key],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await getPool().query('SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1', [
        original.id,
      ])
    ).rows[0].n,
  ).toBe(1);
});
it('checks live membership and prevents app-role modification of the audit or membership', async () => {
  await expect(
    createAsset({ ...member, role: 'operator' }, randomUUID(), input),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    getPool().query("UPDATE app_members SET role='owner' WHERE user_id=$1", [member.id]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    getPool().query('DELETE FROM audit_events WHERE actor_id=$1', [member.id]),
  ).rejects.toMatchObject({ code: '42501' });
  const disabled = (await testMember()).member;
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    await admin.query('UPDATE app_members SET active=false WHERE user_id=$1', [disabled.id]);
  } finally {
    await admin.end();
  }
  await expect(createAsset(disabled, randomUUID(), input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
it('paginates matching rows without duplicates and treats search wildcards literally', async () => {
  const name = `مجموعة-${randomUUID()}`;
  for (let i = 0; i < 27; i++)
    await createAsset(member, randomUUID(), { ...input, name: `${name}-${i}` });
  const first = await listAssets(member, undefined, name);
  expect(first.items).toHaveLength(25);
  expect(first.next_cursor).not.toBeNull();
  const next = await listAssets(member, first.next_cursor!, name);
  expect(next.items).toHaveLength(2);
  expect(new Set([...first.items, ...next.items].map((a) => a.id)).size).toBe(27);
  expect((await listAssets(member, undefined, '%')).items).toHaveLength(0);
});
