import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Pool } from 'pg';
import { assertTestDatabase } from '../../scripts/env';
import { migrate } from '../../scripts/migrate';
import { getPool, transaction } from '../../src/server/db';
import { testMember } from '../fixtures';
import type { Member } from '../../src/server/members';
import { createCatalogItem, updateCatalogItem } from '../../src/server/catalog';
import {
  createReceipt,
  voidReceipt,
  getReceipt,
  listRawLots,
  listReceipts,
} from '../../src/server/receipts';
import { postMovement, reconcileMaterials } from '../../src/server/material-ledger';
import { receiptInputSchema, type ReceiptInput } from '../../src/contracts/receipts';
let manager: Member;
let owner: Member;
async function input(): Promise<ReceiptInput> {
  const raw = await createCatalogItem(manager, randomUUID(), 'products', {
    name: `خام ${randomUUID()}`,
    kind: 'raw',
  });
  const supplier = await createCatalogItem(manager, randomUUID(), 'suppliers', {
    name: `مورد ${randomUUID()}`,
    contact: '',
  });
  return {
    kind: 'purchase',
    supplier_id: supplier.id,
    reference: randomUUID(),
    note: '',
    lines: [{ product_id: raw.id, quantity_g: '25000.000' }],
  };
}
beforeAll(async () => {
  assertTestDatabase();
  await migrate();
  manager = (await testMember()).member;
  owner = (await testMember('owner')).member;
});
afterAll(async () => {
  await getPool().end();
});
it('commits one receipt, movement, balance, audit and outbox for concurrent retries', async () => {
  const body = await input();
  const key = randomUUID();
  const [a, b] = await Promise.all([
    createReceipt(manager, key, body),
    createReceipt(manager, key, body),
  ]);
  expect(a).toEqual(b);
  expect(a.lines[0].balance_g).toBe('25000.000');
  expect(a.receipt.total_g).toBe('25000.000');
  for (const table of ['material_movements', 'outbox_events', 'audit_events']) {
    const column = table === 'material_movements' ? 'receipt_id' : 'entity_id';
    expect(
      (
        await getPool().query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [
          a.receipt.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  }
  await expect(createReceipt(manager, key, { ...body, note: 'طلب مختلف' })).rejects.toMatchObject({
    code: 'IDEMPOTENCY_CONFLICT',
  });
  await expect(createReceipt(manager, randomUUID(), body)).rejects.toMatchObject({
    code: 'DUPLICATE_REFERENCE',
  });
  expect(await reconcileMaterials()).toEqual([]);
});
it('serializes concurrent debits and refuses negative stock', async () => {
  const receipt = await createReceipt(manager, randomUUID(), await input());
  const source = receipt.lines[0];
  const external = (
    await getPool().query(
      "SELECT id FROM material_accounts WHERE product_id=$1 AND external_kind='receipt'",
      [source.product_id],
    )
  ).rows[0].id;
  // Primitive test only: no production/sale endpoint is implied by this synthetic debit.
  const spend = () =>
    transaction((client) =>
      postMovement(client, {
        kind: 'transfer',
        actor_id: manager.id,
        request_key: randomUUID(),
        lines: [
          { account_id: source.account_id, quantity_g: '-15000.000' },
          { account_id: external, quantity_g: '15000.000' },
        ],
      }),
    );
  const results = await Promise.allSettled([spend(), spend()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'INSUFFICIENT_BALANCE' },
  });
  expect((await getReceipt(manager, receipt.receipt.id)).lines[0].balance_g).toBe('10000.000');
  await expect(
    voidReceipt(manager, randomUUID(), receipt.receipt.id, {
      expected_version: 1,
      reason: 'تصحيح الاختبار',
    }),
  ).rejects.toMatchObject({ code: 'MATERIAL_ALREADY_USED' });
  expect(await reconcileMaterials()).toEqual([]);
});
it('voids by an exact immutable reversal, retries safely and preserves original data', async () => {
  const body = await input();
  const originalKey = randomUUID();
  const original = await createReceipt(manager, originalKey, body);
  const key = randomUUID();
  const reason = { expected_version: 1, reason: 'استلام مسجل بالخطأ' };
  const [a, b] = await Promise.all([
    voidReceipt(manager, key, original.receipt.id, reason),
    voidReceipt(manager, key, original.receipt.id, reason),
  ]);
  expect(a).toEqual(b);
  expect(a.receipt.status).toBe('voided');
  expect((await createReceipt(manager, originalKey, body)).receipt.status).toBe('posted');
  expect((await getReceipt(manager, original.receipt.id)).receipt.status).toBe('voided');
  expect(a.lines[0].balance_g).toBe('0.000');
  expect(a.lines[0].quantity_g).toBe('25000.000');
  expect((await listRawLots(manager, { q: original.lines[0].product_name })).items).toEqual([]);
  expect(
    (
      await getPool().query(
        'SELECT count(*)::int AS n FROM material_movements WHERE receipt_id=$1',
        [original.receipt.id],
      )
    ).rows[0].n,
  ).toBe(2);
  await expect(
    voidReceipt(manager, randomUUID(), original.receipt.id, reason),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  await expect(
    getPool().query('DELETE FROM movement_lines WHERE account_id=$1', [
      original.lines[0].account_id,
    ]),
  ).rejects.toThrow();
  await expect(
    getPool().query('UPDATE material_balances SET quantity_g=1 WHERE account_id=$1', [
      original.lines[0].account_id,
    ]),
  ).rejects.toThrow();
  await expect(
    getPool().query('UPDATE receipt_lines SET quantity_g=1 WHERE id=$1', [original.lines[0].id]),
  ).rejects.toThrow();
  expect(await reconcileMaterials()).toEqual([]);
});
it('rolls back receipt, ledger, projection, audit and request when outbox insertion fails', async () => {
  const body = await input();
  const key = randomUUID();
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  // A real failure after posting and auditing, before the final command result is saved.
  try {
    await admin.query(
      `CREATE FUNCTION test_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payload->>'actor_id'='${manager.id.replaceAll("'", "''")}' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION test_fail_outbox()`,
    );
    await expect(createReceipt(manager, key, body)).rejects.toThrow('injected failure');
    expect(
      (await getPool().query('SELECT 1 FROM receipts WHERE reference=$1', [body.reference]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await getPool().query('SELECT 1 FROM material_accounts WHERE product_id=$1', [
          body.lines[0].product_id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await getPool().query('SELECT 1 FROM audit_events WHERE request_key=$1', [key])).rowCount,
    ).toBe(0);
    expect(
      (await getPool().query('SELECT 1 FROM idempotency_requests WHERE request_key=$1', [key]))
        .rowCount,
    ).toBe(0);
  } finally {
    await admin.query(
      'DROP TRIGGER IF EXISTS test_fail_outbox ON outbox_events; DROP FUNCTION IF EXISTS test_fail_outbox()',
    );
    await admin.end();
  }
  expect((await createReceipt(manager, key, body)).lines[0].balance_g).toBe('25000.000');
});
it('database rejects unbalanced postings and appending to committed history', async () => {
  const receipt = await createReceipt(manager, randomUUID(), await input());
  const account = receipt.lines[0].account_id;
  await expect(
    transaction(async (client) => {
      const id = randomUUID();
      await client.query(
        "INSERT INTO material_movements(id,kind,actor_id,request_key) VALUES($1,'transfer',$2,$3)",
        [id, manager.id, randomUUID()],
      );
      await client.query(
        'INSERT INTO movement_lines(movement_id,account_id,quantity_g) VALUES($1,$2,1)',
        [id, account],
      );
    }),
  ).rejects.toThrow('movement must balance');
  expect((await getReceipt(manager, receipt.receipt.id)).lines[0].balance_g).toBe('25000.000');
  const old = (
    await getPool().query('SELECT id FROM material_movements WHERE receipt_id=$1', [
      receipt.receipt.id,
    ])
  ).rows[0].id;
  await expect(
    getPool().query(
      'INSERT INTO movement_lines(movement_id,account_id,quantity_g) VALUES($1,$2,1)',
      [old, account],
    ),
  ).rejects.toThrow('cannot append');
  expect(await reconcileMaterials()).toEqual([]);
});
it('validates ownership, raw kind, inactive references, precision and source type; snapshots survive renames', async () => {
  const body = await input();
  const opening = {
    ...body,
    kind: 'opening' as const,
    supplier_id: null,
    reference: '',
    note: 'رصيد جرد افتتاحي',
  };
  await expect(createReceipt(manager, randomUUID(), opening)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await createReceipt(owner, randomUUID(), opening)).receipt.kind).toBe('opening');
  const operator = (await testMember('operator')).member;
  await expect(createReceipt(operator, randomUUID(), body)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    createReceipt(manager, randomUUID(), {
      ...body,
      lines: [{ ...body.lines[0], product_id: randomUUID() }],
    }),
  ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_KIND' });
  const a = await createReceipt(manager, randomUUID(), body);
  await updateCatalogItem(manager, randomUUID(), 'products', body.lines[0].product_id, {
    name: 'اسم جديد للاختبار',
    active: false,
    expected_version: 1,
  });
  expect((await getReceipt(manager, a.receipt.id)).lines[0].product_name).toBe(
    a.lines[0].product_name,
  );
  await expect(
    createReceipt(manager, randomUUID(), { ...body, reference: randomUUID() }),
  ).rejects.toMatchObject({ code: 'INACTIVE_REFERENCE' });
  expect(
    receiptInputSchema.safeParse({ ...body, lines: [{ ...body.lines[0], quantity_g: '1.0001' }] })
      .success,
  ).toBe(false);
  expect(
    receiptInputSchema.safeParse({ ...body, lines: [body.lines[0], body.lines[0]] }).success,
  ).toBe(false);
});

it('posts distinct raw materials with exact fractional totals and refuses finished products', async () => {
  const body = await input();
  const extra = await createCatalogItem(manager, randomUUID(), 'products', {
    name: `مادة ثانية ${randomUUID()}`,
    kind: 'raw',
  });
  body.lines = [
    { ...body.lines[0], quantity_g: '25000.001' },
    { product_id: extra.id, quantity_g: '0.999' },
  ];
  const received = await createReceipt(manager, randomUUID(), body);
  expect(received.receipt.total_g).toBe('25001.000');
  expect(received.lines).toHaveLength(2);
  expect(received.lines.map((l) => l.balance_g).sort()).toEqual(['0.999', '25000.001']);
  const finished = await createCatalogItem(manager, randomUUID(), 'products', {
    name: `دهن غير خام ${randomUUID()}`,
    kind: 'finished',
    raw_product_id: extra.id,
  });
  await expect(
    createReceipt(manager, randomUUID(), {
      ...body,
      reference: randomUUID(),
      lines: [{ ...body.lines[0], product_id: finished.id }],
    }),
  ).rejects.toMatchObject({ code: 'INVALID_PRODUCT_KIND' });
  expect(await reconcileMaterials()).toEqual([]);
});
it('rejects a status-only void, incomplete receipt and excessive SQL precision at commit', async () => {
  const body = await input();
  const receipt = await createReceipt(manager, randomUUID(), body);
  await expect(
    getPool().query(
      "UPDATE receipts SET status='voided',version=version+1,void_reason='اختبار بدون عكس',voided_at=now(),voided_by=$2 WHERE id=$1",
      [receipt.receipt.id, manager.id],
    ),
  ).rejects.toThrow('requires reversal');
  expect((await getReceipt(manager, receipt.receipt.id)).receipt.status).toBe('posted');
  await expect(
    getPool().query(
      "INSERT INTO receipts(id,kind,supplier_id,supplier_name,created_by) VALUES($1,'purchase',$2,'اختبار',$3)",
      [randomUUID(), body.supplier_id, manager.id],
    ),
  ).rejects.toThrow('posting incomplete');
  await expect(
    transaction(async (client) => {
      const movement = randomUUID();
      await client.query(
        "INSERT INTO material_movements(id,kind,actor_id,request_key) VALUES($1,'transfer',$2,$3)",
        [movement, manager.id, randomUUID()],
      );
      await client.query(
        'INSERT INTO movement_lines(movement_id,account_id,quantity_g) VALUES($1,$2,0.0001)',
        [movement, receipt.lines[0].account_id],
      );
    }),
  ).rejects.toThrow();
  expect((await getReceipt(manager, receipt.receipt.id)).lines[0].balance_g).toBe('25000.000');
  expect(await reconcileMaterials()).toEqual([]);
});
it('paginates receipt and lot history without duplicates and escapes literal wildcards', async () => {
  const body = await input();
  const prefix = `PAGE-${randomUUID()}`;
  for (let i = 0; i < 27; i++)
    await createReceipt(manager, randomUUID(), { ...body, reference: `${prefix}-${i}` });
  const first = await listReceipts(manager, { q: prefix, status: 'all' });
  const second = await listReceipts(manager, {
    q: prefix,
    status: 'all',
    cursor: first.next_cursor!,
  });
  expect(first.items).toHaveLength(25);
  expect(second.items).toHaveLength(2);
  expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(27);
  const lots = await listRawLots(manager, { q: prefix });
  const rest = await listRawLots(manager, { q: prefix, cursor: lots.next_cursor! });
  expect(new Set([...lots.items, ...rest.items].map((l) => l.id)).size).toBe(27);
  expect((await listReceipts(manager, { q: `${prefix}%`, status: 'all' })).items).toHaveLength(0);
});

it('rechecks owner authority before replaying opening receipt commands', async () => {
  const former = (await testMember('owner')).member;
  const base = await input();
  const key = randomUUID();
  const body = {
    ...base,
    kind: 'opening' as const,
    supplier_id: null,
    reference: '',
    note: 'رصيد افتتاحي للاختبار',
  };
  const posted = await createReceipt(former, key, body);
  const reverseKey = randomUUID();
  const reason = { expected_version: 1, reason: 'تصحيح رصيد اختبار' };
  await voidReceipt(former, reverseKey, posted.receipt.id, reason);
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  try {
    await admin.query("UPDATE app_members SET role='manager' WHERE user_id=$1", [former.id]);
  } finally {
    await admin.end();
  }
  // Deliberately use the stale member object; the transaction must check the current role.
  await expect(createReceipt(former, key, body)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(voidReceipt(former, reverseKey, posted.receipt.id, reason)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
