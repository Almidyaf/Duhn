import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import { getCatalogItem, updateCatalogItem } from '../../src/server/catalog';
import { getFactoryReport } from '../../src/server/reports';
import {
  getFermentation,
  readyFermentation,
  withdrawFermentation,
} from '../../src/server/fermentation';
import { createReceipt, voidReceipt } from '../../src/server/receipts';
import { configureFactory, startFixture, matureFermentation } from '../production-fixtures';
import { testMember } from '../fixtures';
import type { Member } from '../../src/server/members';
let owner: Member;
beforeAll(async () => {
  await migrate();
  owner = (await testMember('owner')).member;
  await configureFactory(owner);
});
afterAll(async () => {
  await getPool().end();
});
it('counts ledger entries once, keeps reversals separate, and preserves remaining fermentation after repeated withdrawals', async () => {
  const today = new Date().toISOString().slice(0, 10),
    range = { from: today, to: today };
  const before = await getFactoryReport(owner, range);
  const fixture = await startFixture(owner);
  await matureFermentation(fixture.batch.fermentation.id);
  const ready = await readyFermentation(owner, randomUUID(), fixture.batch.fermentation.id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  await withdrawFermentation(owner, randomUUID(), ready.fermentation.id, {
    expected_version: ready.fermentation.version,
    quantity_g: '5000.000',
  });
  const next = await getFermentation(owner, ready.fermentation.id);
  await withdrawFermentation(owner, randomUUID(), ready.fermentation.id, {
    expected_version: next.fermentation.version,
    quantity_g: '3000.000',
  });
  const final = await getFermentation(owner, ready.fermentation.id);
  expect(final.fermentation).toMatchObject({
    status: 'ready',
    balance_g: '17000.000',
    withdrawal_count: 2,
    started_at: next.fermentation.started_at,
  });
  const receipt = await createReceipt(owner, randomUUID(), {
    kind: 'opening',
    supplier_id: null,
    reference: '',
    note: 'إلغاء رصيد تقرير اختباري',
    lines: [{ product_id: fixture.raw.id, quantity_g: '1000.000' }],
  });
  await voidReceipt(owner, randomUUID(), receipt.receipt.id, {
    expected_version: receipt.receipt.version,
    reason: 'تحقق من عرض الإلغاء مستقلًا',
  });
  const after = await getFactoryReport(owner, range);
  expect(Number(after.totals.opening) - Number(before.totals.opening)).toBe(26000);
  expect(Number(after.totals.reversed) - Number(before.totals.reversed)).toBe(1000);
  expect(Number(after.totals.fermented) - Number(before.totals.fermented)).toBe(25000);
  expect(Number(after.totals.withdrawn) - Number(before.totals.withdrawn)).toBe(8000);
  expect(Number(after.current.fermentation) - Number(before.current.fermentation)).toBe(17000);
  expect(Number(after.current.oven) - Number(before.current.oven)).toBe(8000);
  expect(after.products.find((p) => p.id === fixture.product.id)).toMatchObject({
    entered: '25000.000',
    withdrawn: '8000.000',
  });
  const originalName = fixture.product.name;
  const currentProduct = await getCatalogItem(owner, 'products', fixture.product.id);
  const renamed = `${originalName} محدث`;
  await updateCatalogItem(owner, randomUUID(), 'products', fixture.product.id, {
    name: renamed,
    active: true,
    expected_version: currentProduct.version,
  });
  expect((await getFermentation(owner, ready.fermentation.id)).fermentation.product_name).toBe(
    renamed,
  );
  const snapshot = await getPool().query(
    "SELECT product_snapshot->>'name' AS name FROM fermentations WHERE id=$1",
    [ready.fermentation.id],
  );
  expect(snapshot.rows[0].name).toBe(originalName);
  expect((await getFactoryReport(owner, range)).totals).toEqual(after.totals);
  const empty = await getFactoryReport(owner, { from: '2000-01-01', to: '2000-01-01' });
  expect(Number(empty.totals.fermented)).toBe(0);
  expect(empty.current).toEqual(after.current);
  await expect(getFactoryReport({ ...owner, role: 'operator' }, range)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
