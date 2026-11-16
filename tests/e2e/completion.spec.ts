import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { test, expect } from '../browser-fixtures';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { startFixture, matureFermentation } from '../production-fixtures';
import { readyFermentation, withdrawFermentation } from '../../src/server/fermentation';
import { createAsset } from '../../src/server/assets';
import { startOven } from '../../src/server/oven';
import { assertTestDatabase } from '../../scripts/env';
test('operator flow completes oven, filter, packing, stores output and shows inventory report', async ({
  page,
}, testInfo) => {
  await migrate();
  const owner = await testMember('owner'),
    f = await startFixture(owner.member),
    id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner.member, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const batch = await withdrawFermentation(owner.member, randomUUID(), id, {
      expected_version: 2,
      quantity_g: '1000.000',
    }),
    order = batch.orders.items[0];
  const asset = await createAsset(owner.member, randomUUID(), {
    name: 'فرن مسار كامل ' + randomUUID().slice(0, 6),
    category: 'oven',
    location: '',
    notes: '',
  });
  await startOven(owner.member, randomUUID(), order.id, {
    expected_version: 1,
    asset_id: asset.id,
    asset_version: 1,
    duration_minutes: 1,
  });
  assertTestDatabase();
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
  await admin.query(
    "UPDATE stage_runs SET started_at=now()-interval '2 minutes',due_at=now()-interval '1 minute' WHERE production_order_id=$1",
    [order.id],
  );
  await admin.end();
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner.email);
  await page.getByLabel('كلمة المرور').fill(owner.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto('/production/' + id);
  const region = page.getByRole('region', { name: 'إجراءات جزء 1', exact: true });
  await region.getByLabel('سبب التوقف', { exact: true }).fill('توقف الغاز للاختبار');
  await region.getByRole('button', { name: 'إيقاف مؤقت للفرن', exact: true }).click();
  await expect(region.getByRole('button', { name: 'استئناف الفرن', exact: true })).toBeVisible();
  await region.getByRole('checkbox').check();
  await region.getByRole('button', { name: 'استئناف الفرن', exact: true }).click();

  await region.getByLabel('الوزن الناتج بالجرام', { exact: true }).fill('700');
  await region.getByRole('checkbox').check();
  await region.getByRole('button', { name: 'إنهاء الفرن وتسجيل الناتج', exact: true }).click();
  await expect(region.getByRole('button', { name: 'بدء التصفية', exact: true })).toBeVisible();
  await expect(
    region.getByRole('heading', { name: 'التصفية · الجزء 01', exact: true }),
  ).toBeVisible();
  await expect(region).toContainText(`B-${f.batch.fermentation.code.padStart(6, '0')} / 01`);
  await expect(region).toContainText(f.product.name);
  await expect(region).toContainText('الكمية الداخلة إلى التصفية');
  await region.screenshot({ path: testInfo.outputPath('filter-context-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await region.screenshot({ path: testInfo.outputPath('filter-context-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.reload();
  await region.getByRole('button', { name: 'بدء التصفية', exact: true }).click();
  await region.getByLabel('الوزن الناتج بالجرام', { exact: true }).fill('650');
  await region.getByRole('checkbox').check();
  await region.getByRole('button', { name: 'إنهاء التصفية', exact: true }).click();
  await region.getByRole('button', { name: 'بدء التعبئة', exact: true }).click();
  await expect(region.getByLabel('الوزن الناتج بالجرام', { exact: true })).toHaveValue('650');
  await region.getByLabel('الوزن الناتج بالجرام', { exact: true }).fill('600');
  await region.getByRole('checkbox').check();
  await region.getByRole('button', { name: 'إنهاء التعبئة', exact: true }).click();
  await expect(region).toContainText('60%');
  await region.getByRole('button', { name: 'نقل إلى المخزون', exact: true }).click();
  await region.getByRole('button', { name: 'تأكيد النقل', exact: true }).click();
  await expect(region).toHaveCount(0);
  const collapse = page.getByLabel('طي الأجزاء المكتملة', { exact: true });
  await collapse.uncheck();
  await expect(region).toContainText('نُقل إلى المخزون');
  await collapse.check();
  await expect(region).toHaveCount(0);
  await page.getByRole('button', { name: 'عرض تفاصيل الجزء 01', exact: true }).click();
  await expect(region).toBeVisible();
  await page
    .getByRole('region', { name: 'الأجزاء المسحوبة للإنتاج (1)', exact: true })
    .screenshot({ path: testInfo.outputPath('separated-parts.png') });
  await page.reload();
  await expect(region).toHaveCount(0);
  await page.getByRole('button', { name: 'عرض تفاصيل الجزء 01', exact: true }).click();
  await expect(region).toContainText('600 جم');
  await page.locator('.production-path > summary').click();
  await page
    .getByRole('region', { name: 'مسار الإنتاج', exact: true })
    .screenshot({ path: testInfo.outputPath('production-completed.png') });
  await page.getByRole('link', { name: 'التقارير', exact: true }).click();
  await expect(
    page
      .getByRole('heading', { name: 'المنتج النهائي المتاح الآن', exact: true })
      .locator('..')
      .getByRole('row')
      .filter({ hasText: f.product.name }),
  ).toContainText('600');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
