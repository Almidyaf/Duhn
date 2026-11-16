import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import { testMember } from '../fixtures';
import { startFixture, matureFermentation } from '../production-fixtures';
import {
  readyFermentation,
  withdrawFermentation,
  getFermentation,
} from '../../src/server/fermentation';
import { createAsset } from '../../src/server/assets';
import { startOven, availableOvens } from '../../src/server/oven';
import { processOrder } from '../../src/server/processing';
import { reconcileMaterials } from '../../src/server/material-ledger';
import type { ProcessingInput } from '../../src/contracts/processing';
import { assertTestDatabase } from '../../scripts/env';
beforeAll(migrate);
afterAll(async () => {
  await getPool().end();
});
it('completes oven, filtration, packaging and dispatch with exact balances, inspection, resource release and replay', async () => {
  const owner = (await testMember('owner')).member,
    f = await startFixture(owner),
    id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  await withdrawFermentation(owner, randomUUID(), id, {
    expected_version: 2,
    quantity_g: '1000.000',
  });
  const batch = await withdrawFermentation(owner, randomUUID(), id, {
    expected_version: 3,
    quantity_g: '1000.000',
  });
  const asset = await createAsset(owner, randomUUID(), {
    name: 'فرن إكمال ' + randomUUID(),
    category: 'oven',
    location: '',
    notes: '',
  });
  for (const [i, order] of batch.orders.items.entries()) {
    await startOven(owner, randomUUID(), order.id, {
      expected_version: 1,
      asset_id: asset.id,
      asset_version: 1,
      duration_minutes: 1,
    });
    const initialDue = (await getFermentation(owner, id)).orders.items.find(
      (x) => x.id === order.id,
    )!.due_at!;
    await processOrder(owner, randomUUID(), order.id, {
      action: 'pause_oven',
      expected_version: 2,
      note: 'انقطاع الغاز',
    });
    expect(
      (await getFermentation(owner, id)).orders.items.find((x) => x.id === order.id)!.stage_status,
    ).toBe('paused');
    expect((await availableOvens(owner, asset.name)).items).toHaveLength(0);
    await expect(
      processOrder(owner, randomUUID(), order.id, {
        action: 'complete_oven',
        expected_version: 3,
        quantity_g: '700.000',
        inspection_confirmed: true,
        note: '',
      }),
    ).rejects.toMatchObject({ code: 'OVEN_PAUSED' });
    await processOrder(owner, randomUUID(), order.id, {
      action: 'resume_oven',
      expected_version: 3,
      inspection_confirmed: true,
      note: '',
    });
    expect(
      Date.parse(
        (await getFermentation(owner, id)).orders.items.find((x) => x.id === order.id)!.due_at!,
      ),
    ).toBeGreaterThanOrEqual(Date.parse(initialDue));
    const finish: ProcessingInput = {
      action: 'complete_oven',
      expected_version: 4,
      quantity_g: '700.000',
      inspection_confirmed: true,
      note: '',
    };
    await expect(processOrder(owner, randomUUID(), order.id, finish)).rejects.toMatchObject({
      code: 'INSPECTION_NOT_DUE',
    });
    assertTestDatabase();
    const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    await admin.query(
      "UPDATE stage_runs SET started_at=now()-interval '2 minutes',due_at=now()-interval '1 minute' WHERE production_order_id=$1",
      [order.id],
    );
    await admin.end();
    await expect(
      processOrder(owner, randomUUID(), order.id, { ...finish, quantity_g: '1000.001' }),
    ).rejects.toMatchObject({ code: 'OUTPUT_EXCEEDS_INPUT' });
    const key = randomUUID(),
      result = await processOrder(owner, key, order.id, finish);
    expect(await processOrder(owner, key, order.id, finish)).toEqual(result);
    expect((await availableOvens(owner, asset.name)).items.some((a) => a.id === asset.id)).toBe(
      true,
    );
    await processOrder(owner, randomUUID(), order.id, {
      action: 'start_filter',
      expected_version: 1,
      note: '',
    });
    await processOrder(owner, randomUUID(), order.id, {
      action: 'complete_filter',
      expected_version: 2,
      quantity_g: '650.000',
      inspection_confirmed: true,
      note: '',
    });
    await processOrder(owner, randomUUID(), order.id, {
      action: 'start_packing',
      expected_version: 3,
      note: '',
    });
    await processOrder(owner, randomUUID(), order.id, {
      action: 'complete_packing',
      expected_version: 4,
      quantity_g: '600.000',
      inspection_confirmed: true,
      note: '',
    });
    await processOrder(owner, randomUUID(), order.id, {
      action: i === 0 ? 'store' : 'sell',
      expected_version: 5,
      note: '',
    });
    const saved = (await getFermentation(owner, id)).orders.items.find((o) => o.id === order.id)!;
    expect(saved.stage_status).toBe('completed');
    expect(saved.processing_state).toBe(i === 0 ? 'stored' : 'sold');
    expect(saved.oven_output_g).toBe('700.000');
    expect(saved.filter_output_g).toBe('650.000');
    expect(saved.packing_output_g).toBe('600.000');
    expect(saved.available_g).toBe(i === 0 ? '600.000' : '0.000');
    await expect(
      processOrder(owner, randomUUID(), order.id, {
        action: 'sell',
        expected_version: 5,
        note: '',
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  }
  expect((await getFermentation(owner, id)).fermentation.balance_g).toBe('23000.000');
  expect(await reconcileMaterials()).toEqual([]);
});
