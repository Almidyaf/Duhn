import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import type { Member } from '../../src/server/members';
import { testMember } from '../fixtures';
import {
  productionFixture,
  startFixture,
  matureFermentation,
  configureFactory,
} from '../production-fixtures';
import {
  approveRecipe,
  disableRecipe,
  getFactorySettings,
  updateFactorySettings,
} from '../../src/server/settings';
import { createRecipe, getCatalogItem, listRecipes } from '../../src/server/catalog';
import {
  fermentationOptions,
  startFermentation,
  readyFermentation,
  withdrawFermentation,
  getFermentation,
} from '../../src/server/fermentation';
import { getReceipt, voidReceipt } from '../../src/server/receipts';
import { reconcileMaterials } from '../../src/server/material-ledger';
import { createAsset } from '../../src/server/assets';
import { startOven, availableOvens } from '../../src/server/oven';
let owner: Member, manager: Member;
beforeAll(async () => {
  await migrate();
  owner = (await testMember('owner')).member;
  manager = (await testMember()).member;
});
afterAll(async () => {
  await getPool().end();
});
it('starts an oven once, prevents concurrent equipment allocation and preserves material balances', async () => {
  const f = await startFixture(owner);
  const id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  await withdrawFermentation(owner, randomUUID(), id, {
    expected_version: 2,
    quantity_g: '1000.000',
  });
  const withdrawn = await withdrawFermentation(owner, randomUUID(), id, {
    expected_version: 3,
    quantity_g: '2000.000',
  });
  const [a, b] = withdrawn.orders.items;
  const oven = await createAsset(owner, randomUUID(), {
    name: `فرن ${randomUUID()}`,
    category: 'oven',
    location: '',
    notes: '',
  });
  const input = {
    expected_version: 1,
    asset_id: oven.id,
    asset_version: oven.version,
    duration_minutes: 2,
  };
  const key = randomUUID();
  const results = await Promise.allSettled([
    startOven(owner, key, a.id, input),
    startOven(owner, randomUUID(), b.id, input),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: 'OVEN_BUSY' });
  const started = (await getFermentation(owner, id)).orders.items.find(
    (o) => o.stage_status === 'running',
  )!;
  expect(started.asset_name).toBe(oven.name);
  expect(started.duration_minutes).toBe(2);
  expect(started.warning_minutes).toBe(1);
  expect(Date.parse(started.due_at!) - Date.parse(started.started_at!)).toBe(120000);
  expect((await availableOvens(owner, oven.name)).items).toHaveLength(0);
  if (results[0].status === 'fulfilled')
    expect(await startOven(owner, key, a.id, input)).toEqual(results[0].value);
  await expect(startOven(owner, randomUUID(), started.id, input)).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
  });
  const op = (await testMember('operator')).member;
  await expect(startOven(op, randomUUID(), started.id, input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  expect((await getFermentation(owner, id)).fermentation.balance_g).toBe('22000.000');
  const counts = (
    await getPool().query(
      "SELECT count(*)::int AS n FROM outbox_events WHERE topic='oven.started' AND entity_id=ANY($1::uuid[])",
      [[a.id, b.id]],
    )
  ).rows[0];
  expect(counts.n).toBe(1);
  expect(await reconcileMaterials()).toEqual([]);
});
it('saves a batch duration independently of the approved recipe, clamps warning and replays safely', async () => {
  const f = await productionFixture(owner);
  for (const duration of [1, 2880, undefined]) {
    const options = await fermentationOptions(owner, f.product.id);
    const input = {
      product_id: f.product.id,
      recipe_id: f.recipe.id,
      raw_lot_id: options.sources.items[0].id,
      source_version: options.sources.items[0].version,
      settings_version: options.settings_version,
      quantity_g: '1000.000',
      ...(duration === undefined ? {} : { fermentation_duration_minutes: duration }),
    };
    const key = randomUUID();
    const result = await startFermentation(owner, key, input);
    expect(await startFermentation(owner, key, input)).toEqual(result);
    const expected = duration ?? 60;
    expect(
      Date.parse(result.fermentation.due_at) - Date.parse(result.fermentation.started_at),
    ).toBe(expected * 60000);
    const saved = (
      await getPool().query(
        `SELECT f.recipe_snapshot, f.fermentation_duration_minutes, s.policy
      FROM fermentations f JOIN stage_runs s ON s.fermentation_id=f.id WHERE f.id=$1`,
        [result.fermentation.id],
      )
    ).rows[0];
    expect(saved.recipe_snapshot.policy.fermentation.duration_minutes).toBe(60);
    expect(saved.fermentation_duration_minutes).toBe(duration ?? null);
    expect(saved.policy.duration_minutes).toBe(expected);
    expect(saved.policy.warning_minutes).toBe(Math.min(15, expected - 1));
    for (const invalid of [0, -1, 1.5, 525601]) {
      await expect(async () =>
        startFermentation(owner, randomUUID(), {
          ...input,
          fermentation_duration_minutes: invalid,
        }),
      ).rejects.toThrow();
    }
  }
  expect(
    (await listRecipes(owner, f.product.id)).items[0].policy.fermentation.duration_minutes,
  ).toBe(60);
});
it('restricts configuration and approval to owner; keeps approved content immutable and activation versioned', async () => {
  const f = await productionFixture(owner, false);
  const body = {
    expected_version: f.product_version,
    settings_version: f.settings.version,
    note: 'اعتماد اختباري',
    process_confirmed: true as const,
  };
  await expect(
    approveRecipe(manager, randomUUID(), f.product.id, f.recipe.id, body),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(fermentationOptions(owner, f.product.id)).rejects.toMatchObject({
    code: 'NO_ACTIVE_RECIPE',
  });
  const key = randomUUID();
  const [a, b] = await Promise.all([
    approveRecipe(owner, key, f.product.id, f.recipe.id, body),
    approveRecipe(owner, key, f.product.id, f.recipe.id, body),
  ]);
  expect(a).toEqual(b);
  expect(a.product_version).toBe(f.product_version + 1);
  const list = await listRecipes(owner, f.product.id);
  expect(list.items[0]).toMatchObject({ status: 'approved', active: true });
  await expect(
    getPool().query("UPDATE recipe_approvals SET approval_note='غير صالح' WHERE recipe_id=$1", [
      f.recipe.id,
    ]),
  ).rejects.toThrow();
  await disableRecipe(owner, randomUUID(), f.product.id, {
    expected_version: a.product_version,
    reason: 'إيقاف للاختبار',
  });
  expect((await listRecipes(owner, f.product.id)).items[0]).toMatchObject({
    status: 'approved',
    active: false,
  });
  await expect(fermentationOptions(owner, f.product.id)).rejects.toMatchObject({
    code: 'NO_ACTIVE_RECIPE',
  });
  await expect(
    approveRecipe(owner, randomUUID(), f.product.id, f.recipe.id, body),
  ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  const settings = await getFactorySettings(owner);
  await expect(
    updateFactorySettings(manager, randomUUID(), {
      name: 'مرفوض',
      timezone: 'UTC',
      week_starts_on: 0,
      measurement_confirmed: true,
      expected_version: settings.version,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('moves the full starting quantity once, rejects early inspection and prevents voiding consumed receipts', async () => {
  const f = await productionFixture(owner);
  const options = await fermentationOptions(owner, f.product.id);
  const source = options.sources.items[0];
  const body = {
    product_id: f.product.id,
    recipe_id: f.recipe.id,
    raw_lot_id: source.id,
    source_version: source.version,
    settings_version: options.settings_version,
    quantity_g: '25000.000',
  };
  const key = randomUUID();
  const [a, b] = await Promise.all([
    startFermentation(owner, key, body),
    startFermentation(owner, key, body),
  ]);
  expect(a).toEqual(b);
  expect(a.fermentation.balance_g).toBe('25000.000');
  expect((await getReceipt(owner, f.receipt.receipt.id)).lines[0].balance_g).toBe('0.000');
  await expect(startFermentation(owner, randomUUID(), body)).rejects.toMatchObject({
    code: 'VERSION_CONFLICT',
  });
  await expect(
    readyFermentation(owner, randomUUID(), a.fermentation.id, {
      expected_version: 1,
      inspection_confirmed: true,
    }),
  ).rejects.toMatchObject({ code: 'INSPECTION_NOT_DUE' });
  await expect(
    withdrawFermentation(owner, randomUUID(), a.fermentation.id, {
      expected_version: 1,
      quantity_g: '1.000',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  await expect(
    voidReceipt(owner, randomUUID(), f.receipt.receipt.id, {
      expected_version: 1,
      reason: 'غير مسموح',
    }),
  ).rejects.toMatchObject({ code: 'MATERIAL_ALREADY_USED' });
  expect(
    (
      await getPool().query(
        'SELECT count(*)::int AS n FROM material_movements WHERE fermentation_id=$1',
        [a.fermentation.id],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(await reconcileMaterials()).toEqual([]);
});
it('tracks partial withdrawals, independent queued orders and exact remainder without repeating product entry', async () => {
  const f = await startFixture(owner);
  const id = f.batch.fermentation.id;
  await matureFermentation(id);
  const ready = await readyFermentation(owner, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const key = randomUUID(),
    body = { expected_version: ready.fermentation.version, quantity_g: '5000.000' };
  const [a, b] = await Promise.all([
    withdrawFermentation(owner, key, id, body),
    withdrawFermentation(owner, key, id, body),
  ]);
  expect(a).toEqual(b);
  expect(a.fermentation.balance_g).toBe('20000.000');
  expect(a.orders.items).toHaveLength(1);
  expect(a.orders.items[0]).toMatchObject({
    sequence_no: 1,
    stage_status: 'queued',
    quantity_g: '5000.000',
  });
  await expect(
    withdrawFermentation(owner, randomUUID(), id, { expected_version: 3, quantity_g: '20000.001' }),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  const drained = await withdrawFermentation(owner, randomUUID(), id, {
    expected_version: 3,
    quantity_g: '20000.000',
  });
  expect(drained.fermentation).toMatchObject({
    balance_g: '0.000',
    status: 'depleted',
    withdrawal_count: 2,
  });
  expect(drained.orders.items.map((o) => o.sequence_no)).toEqual([2, 1]);
  expect(
    (
      await getPool().query(
        'SELECT quantity_g::text FROM material_balances b JOIN material_accounts a ON a.id=b.account_id WHERE stage_run_id=ANY($1::uuid[]) ORDER BY b.quantity_g',
        [drained.orders.items.map((o) => o.stage_id)],
      )
    ).rows.map((r) => r.quantity_g),
  ).toEqual(['5000.000', '20000.000']);
  expect(await reconcileMaterials()).toEqual([]);
});
it('serializes competing withdrawals and preserves snapshots when active recipe/settings change', async () => {
  const f = await startFixture(owner);
  const id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      withdrawFermentation(owner, randomUUID(), id, {
        expected_version: 2,
        quantity_g: '15000.000',
      }),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { code: 'VERSION_CONFLICT' },
  });
  const p = await getCatalogItem(owner, 'products', f.product.id);
  const next = await createRecipe(owner, randomUUID(), p.id, {
    expected_version: p.version,
    raw_product_id: f.raw.id,
    policy: { ...f.recipe.policy, oven: { ...f.recipe.policy.oven, duration_minutes: 120 } },
    note: 'اختبار إصدار جديد',
  });
  const settings = await configureFactory(owner);
  await approveRecipe(owner, randomUUID(), p.id, next.recipe.id, {
    expected_version: next.product_version,
    settings_version: settings.version,
    process_confirmed: true,
    note: 'تفعيل اختباري',
  });
  const existing = await getFermentation(owner, id);
  expect(existing.fermentation).toMatchObject({
    balance_g: '10000.000',
    recipe_id: f.recipe.id,
    recipe_revision: 1,
  });
  expect(
    (
      await getPool().query('SELECT policy FROM stage_runs WHERE production_order_id=$1', [
        existing.orders.items[0].id,
      ])
    ).rows[0].policy.duration_minutes,
  ).toBe(60);
  await expect(
    startFermentation(owner, randomUUID(), { ...f.input, settings_version: settings.version }),
  ).rejects.toMatchObject({ code: 'RECIPE_CHANGED' });
  expect(await reconcileMaterials()).toEqual([]);
});
it('rolls back a withdrawal if its durable event cannot be saved', async () => {
  const f = await startFixture(owner);
  const id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  const key = randomUUID();
  try {
    await admin.query(
      `CREATE FUNCTION test_withdraw_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic='fermentation.withdrawn' THEN RAISE EXCEPTION 'injected withdrawal failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_withdraw_fail BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION test_withdraw_fail()`,
    );
    await expect(
      withdrawFermentation(owner, key, id, { expected_version: 2, quantity_g: '5000.000' }),
    ).rejects.toThrow('injected withdrawal failure');
    const unchanged = await getFermentation(owner, id);
    expect(unchanged.fermentation).toMatchObject({
      balance_g: '25000.000',
      version: 2,
      withdrawal_count: 0,
    });
    expect(unchanged.orders.items).toHaveLength(0);
    expect(
      (await getPool().query('SELECT 1 FROM idempotency_requests WHERE request_key=$1', [key]))
        .rowCount,
    ).toBe(0);
  } finally {
    await admin.query(
      'DROP TRIGGER IF EXISTS test_withdraw_fail ON outbox_events; DROP FUNCTION IF EXISTS test_withdraw_fail()',
    );
    await admin.end();
  }
  expect(
    (await withdrawFermentation(owner, key, id, { expected_version: 2, quantity_g: '5000.000' }))
      .fermentation.balance_g,
  ).toBe('20000.000');
});

it('database rejects state-only changes and incomplete orders without corrupting the batch', async () => {
  const f = await startFixture(owner),
    id = f.batch.fermentation.id;
  await expect(
    getPool().query("UPDATE fermentations SET status='ready',version=version+1 WHERE id=$1", [id]),
  ).rejects.toThrow('state mismatch');
  await expect(
    getPool().query(
      'INSERT INTO production_orders(id,fermentation_id,sequence_no,quantity_g,created_by) VALUES($1,$2,1,1,$3)',
      [randomUUID(), id, owner.id],
    ),
  ).rejects.toThrow();
  expect((await getFermentation(owner, id)).fermentation).toMatchObject({
    version: 1,
    balance_g: '25000.000',
    status: 'fermenting',
    withdrawal_count: 0,
  });
});
