import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { assertTestDatabase } from '../../scripts/env';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import {
  createCatalogItem,
  updateCatalogItem,
  listCatalog,
  getCatalogItem,
  createRecipe,
  listRecipes,
} from '../../src/server/catalog';
import {
  recipeInputSchema,
  catalogUpdateSchemas,
  type CatalogItem,
} from '../../src/contracts/catalog';
import type { Member } from '../../src/server/members';
import { testMember } from '../fixtures';
let member: Member;
const name = (prefix: string) => `${prefix} ${randomUUID()}`;
const timing = {
  duration_minutes: 60,
  warning_minutes: 15,
  grace_minutes: 10,
  time_basis: 'active' as const,
  resume_policy: 'require_review' as const,
};
async function setupProducts() {
  const type = await createCatalogItem(member, randomUUID(), 'types', { name: name('نوع') });
  const raw = await createCatalogItem(member, randomUUID(), 'products', {
    name: name('خام'),
    kind: 'raw',
  });
  const finished = await createCatalogItem(member, randomUUID(), 'products', {
    name: name('دهن'),
    kind: 'finished',
    raw_product_id: raw.id,
  });
  return { type, raw, finished };
}
const recipe = (raw: CatalogItem, finished: CatalogItem) => ({
  expected_version: finished.version,
  raw_product_id: raw.id,
  policy: { fermentation: timing, oven: timing },
  note: 'بيانات اختبار غير صناعية',
});
beforeAll(async () => {
  assertTestDatabase();
  await migrate();
  member = (await testMember()).member;
});
afterAll(async () => {
  await getPool().end();
});
it('creates once, detects duplicate names and rolls back failed keys', async () => {
  const key = randomUUID();
  const input = { name: name('نوع') };
  const [a, b] = await Promise.all([
    createCatalogItem(member, key, 'types', input),
    createCatalogItem(member, key, 'types', input),
  ]);
  expect(a.id).toBe(b.id);
  expect(
    (
      await getPool().query('SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1', [
        a.id,
      ])
    ).rows[0].n,
  ).toBe(1);
  await expect(
    createCatalogItem(member, key, 'types', { name: name('آخر') }),
  ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const failed = randomUUID();
  await expect(
    createCatalogItem(member, failed, 'types', { name: `  ${input.name.toUpperCase()}  ` }),
  ).rejects.toMatchObject({ code: 'DUPLICATE_NAME' });
  expect(
    (await getPool().query('SELECT 1 FROM idempotency_requests WHERE request_key=$1', [failed]))
      .rowCount,
  ).toBe(0);
});
it('requires a type, filters kinds, and excludes disabled parents from active choices', async () => {
  const { type, raw, finished } = await setupProducts();
  await expect(listCatalog(member, 'products', { q: '', status: 'all' })).rejects.toMatchObject({
    code: 'TYPE_REQUIRED',
  });
  const list = await listCatalog(member, 'products', {
    q: '',
    status: 'active',
    type_id: type.id,
    kind: 'raw',
  });
  expect(list.items.map((p) => p.id)).toEqual([raw.id]);
  await updateCatalogItem(member, randomUUID(), 'types', type.id, {
    name: type.name,
    active: false,
    expected_version: type.version,
  });
  expect(
    (await listCatalog(member, 'products', { q: '', status: 'active', type_id: type.id })).items,
  ).toHaveLength(0);
  expect(
    (await listCatalog(member, 'products', { q: '', status: 'all', type_id: type.id })).items,
  ).toHaveLength(2);
  await expect(
    createCatalogItem(member, randomUUID(), 'products', {
      name: name('مرفوض'),
      kind: 'raw',
    }),
  ).rejects.toMatchObject({ code: 'INACTIVE_REFERENCE' });
  await expect(
    createRecipe(member, randomUUID(), finished.id, recipe(raw, finished)),
  ).rejects.toMatchObject({ code: 'INACTIVE_REFERENCE' });
});
it('serializes competing updates and refuses changes to product identity', async () => {
  const { raw } = await setupProducts();
  const results = await Promise.allSettled(
    [true, false].map((active) =>
      updateCatalogItem(member, randomUUID(), 'products', raw.id, {
        name: raw.name,
        active,
        expected_version: raw.version,
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'VERSION_CONFLICT' },
  });
  expect(
    catalogUpdateSchemas.products.safeParse({
      name: raw.name,
      active: true,
      expected_version: 1,
      kind: 'finished',
    }).success,
  ).toBe(false);
  await expect(
    getPool().query("UPDATE products SET kind='finished' WHERE id=$1", [raw.id]),
  ).rejects.toThrow();
});
it('creates immutable recipe snapshots; retries return the original revision after later changes', async () => {
  const { raw, finished } = await setupProducts();
  const input = recipe(raw, finished);
  const key = randomUUID();
  const [a, b] = await Promise.all([
    createRecipe(member, key, finished.id, input),
    createRecipe(member, key, finished.id, input),
  ]);
  expect(a).toEqual(b);
  expect(a.recipe.revision).toBe(1);
  await updateCatalogItem(member, randomUUID(), 'products', raw.id, {
    name: name('اسم جديد'),
    active: true,
    expected_version: raw.version,
  });
  const second = await createRecipe(member, randomUUID(), finished.id, {
    ...input,
    expected_version: a.product_version,
    policy: { ...input.policy, oven: { ...timing, duration_minutes: 90 } },
  });
  expect(second.recipe.revision).toBe(2);
  expect(second.recipe.raw_snapshot.name).not.toBe(raw.name);
  expect((await createRecipe(member, key, finished.id, input)).recipe.raw_snapshot.name).toBe(
    raw.name,
  );
  expect((await listRecipes(member, finished.id)).items.map((r) => r.revision)).toEqual([2, 1]);
  expect((await getCatalogItem(member, 'products', finished.id)).version).toBe(3);
  await expect(
    getPool().query("UPDATE recipe_versions SET note='changed' WHERE id=$1", [a.recipe.id]),
  ).rejects.toThrow();
  await expect(
    getPool().query('DELETE FROM recipe_versions WHERE id=$1', [a.recipe.id]),
  ).rejects.toThrow();
});
it('only one recipe with the same product version commits and failed work leaves no revision', async () => {
  const { raw, finished } = await setupProducts();
  const input = recipe(raw, finished);
  const results = await Promise.allSettled(
    [1, 2].map(() => createRecipe(member, randomUUID(), finished.id, input)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'VERSION_CONFLICT' },
  });
  expect((await listRecipes(member, finished.id)).items).toHaveLength(1);
  await expect(
    createRecipe(member, randomUUID(), raw.id, { ...input, raw_product_id: finished.id }),
  ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_KIND' });
  expect(
    recipeInputSchema.safeParse({
      ...input,
      policy: { ...input.policy, oven: { ...timing, warning_minutes: 60 } },
    }).success,
  ).toBe(false);
});
it('denies operator and revoked member writes, including retries of completed requests', async () => {
  const operator = (await testMember('operator')).member;
  await expect(
    createCatalogItem(operator, randomUUID(), 'types', { name: name('مرفوض') }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(listCatalog(operator, 'types', { q: '', status: 'all' })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const revoked = (await testMember()).member;
  const key = randomUUID();
  const input = { name: name('مورد'), contact: '' };
  await createCatalogItem(revoked, key, 'suppliers', input);
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    await admin.query('UPDATE app_members SET active=false WHERE user_id=$1', [revoked.id]);
  } finally {
    await admin.end();
  }
  await expect(createCatalogItem(revoked, key, 'suppliers', input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
it('paginates within one type without duplicates and treats wildcard search literally', async () => {
  const { type } = await setupProducts();
  const prefix = name('صفحة');
  for (let i = 0; i < 27; i++)
    await createCatalogItem(member, randomUUID(), 'products', {
      name: `${prefix} ${i}`,
      kind: 'raw',
    });
  const first = await listCatalog(member, 'products', {
    q: prefix,
    status: 'all',
    type_id: type.id,
  });
  const second = await listCatalog(member, 'products', {
    q: prefix,
    status: 'all',
    type_id: type.id,
    cursor: first.next_cursor!,
  });
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(2);
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(27);
  expect(
    (await listCatalog(member, 'products', { q: '%', status: 'all', type_id: type.id })).items,
  ).toHaveLength(0);
});
