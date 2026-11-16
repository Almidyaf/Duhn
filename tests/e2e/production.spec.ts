import { randomUUID } from 'node:crypto';
import { test, expect } from '../browser-fixtures';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { productionFixture, matureFermentation } from '../production-fixtures';
import type { Page } from '@playwright/test';
import type { CatalogItem } from '../../src/contracts/catalog';
import { createAsset } from '../../src/server/assets';
let owner: Awaited<ReturnType<typeof testMember>>;
let f: Awaited<ReturnType<typeof productionFixture>>;
test.beforeAll(async () => {
  await migrate();
  owner = await testMember('owner');
  f = await productionFixture(owner.member, false);
});
async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner.email);
  await page.getByLabel('كلمة المرور').fill(owner.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
}
async function choose(page: Page, label: string, item: CatalogItem) {
  const d = page.getByRole('dialog');
  const searchToggle = d.getByRole('button', { name: `البحث في الخيارات · ${label}`, exact: true });
  if ((await searchToggle.getAttribute('aria-expanded')) === 'false') await searchToggle.click();
  await d.getByRole('textbox', { name: `بحث الخيارات · ${label}`, exact: true }).fill(item.name);
  const select = d.getByRole('combobox', { name: label, exact: true });
  await expect(select.locator(`option[value="${item.id}"]`)).toHaveCount(1);
  await select.selectOption(item.id);
}
test('owner configures and approves then starts, inspects and partially withdraws; a lost response cannot duplicate output', async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await signIn(page);
  await page.getByRole('link', { name: 'إعدادات المصنع', exact: true }).click();
  await page.getByLabel('اسم المصنع', { exact: true }).fill('مصنع اختبار المتصفح');
  await page.getByLabel('المنطقة الزمنية للمصنع', { exact: true }).selectOption('Asia/Riyadh');
  await page.getByLabel('أول أيام الأسبوع', { exact: true }).selectOption('0');
  await page.getByLabel('راجعت توافق هذه الدقة').check();
  await page.getByRole('button', { name: 'حفظ الإعدادات', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('تم حفظ الإجراء');
  await page.goto(`/purchases/catalog/${f.product.id}`);
  await page.getByRole('button', { name: 'اعتماد وتفعيل هذا الإصدار', exact: true }).click();
  const approval = page.getByRole('dialog');
  await approval.getByLabel('ملاحظة الاعتماد').fill('مراجعة اختبارية وليست وصفة مصنع');
  await approval.getByLabel('راجعت المادة الخام').check();
  await approval.getByRole('button', { name: 'تأكيد الاعتماد والتفعيل', exact: true }).click();
  await expect(approval).not.toBeVisible();
  await expect(page.getByText('المعتمدة للدفعات الجديدة', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'خط الإنتاج', exact: true }).click();
  await page.getByRole('button', { name: 'بدء تخمير جديد', exact: true }).click();
  await choose(page, 'اسم المنتج المراد إنتاجه', f.product);
  await page.getByRole('dialog').getByRole('button', { name: 'متابعة', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('دفعة الخام', { exact: true })).toHaveValue(
    f.receipt.lines[0].lot_id,
  );
  await page.getByRole('dialog').getByLabel('الكمية بالجرام', { exact: true }).fill('٢٥٠٠٠');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('25000', { exact: true })).toBeVisible();
  const startDialog = page.getByRole('dialog');
  await startDialog.getByRole('button', { name: 'تعديل مدة التخمير', exact: true }).click();
  await startDialog.getByLabel('المدة', { exact: true }).fill('0');
  await startDialog.getByRole('button', { name: 'حفظ المدة', exact: true }).click();
  await expect(startDialog.getByRole('alert')).toContainText('أدخل مدة');
  await expect(
    startDialog.getByRole('button', { name: 'بدء التخمير', exact: true }),
  ).toBeDisabled();
  await startDialog.getByLabel('المدة', { exact: true }).fill('٢');
  await startDialog.getByLabel('وحدة المدة', { exact: true }).selectOption('1440');
  await startDialog.getByRole('button', { name: 'حفظ المدة', exact: true }).click();
  await expect(startDialog.getByText('2 يوم', { exact: true })).toBeVisible();
  await startDialog.getByRole('button', { name: 'تعديل مدة التخمير', exact: true }).click();
  await startDialog.getByLabel('المدة', { exact: true }).fill('9');
  await startDialog
    .getByRole('group', { name: 'تعديل مدة التخمير', exact: true })
    .getByRole('button', { name: 'إلغاء', exact: true })
    .click();
  await expect(startDialog.getByText('2 يوم', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'السابق', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('الكمية بالجرام', { exact: true })).toHaveValue(
    '٢٥٠٠٠',
  );
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath('start-review-desktop.png'), fullPage: true });
  await expect(startDialog.getByText('2 يوم', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('start-review-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('dialog').getByRole('button', { name: 'بدء التخمير', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('البحث بالمنتج أو رقم دفعة التخمير').fill(f.product.name);
  const row = page.getByRole('row').filter({ hasText: f.product.name });
  await expect(row).toContainText('25000');
  await row.getByRole('link', { name: 'متابعة الدفعة' }).click();
  await expect(page).toHaveURL(/\/production\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;
  const persisted = await (await page.request.get(`/api/v1/fermentations/${id}`)).json();
  expect(
    Date.parse(persisted.fermentation.due_at) - Date.parse(persisted.fermentation.started_at),
  ).toBe(2 * 86400000);
  await expect(
    page.getByRole('button', { name: 'اعتماد الجاهزية للسحب الجزئي', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('توقيت المصنع: Asia/Riyadh', { exact: true })).toBeVisible();
  await matureFermentation(id);
  await page.reload();
  await page.getByLabel('فحصت المادة وأؤكد صلاحيتها لسحب كمية للإنتاج.').check();
  await page.getByRole('button', { name: 'اعتماد الجاهزية للسحب الجزئي', exact: true }).click();
  await expect(page.getByText('تخمير مستمر · متاح للسحب', { exact: true })).toBeVisible();
  await page.getByLabel('الكمية المراد إخراجها بالجرام').fill('5000');
  let committed = false;
  await page.route('**/withdrawals', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
    committed = true;
  });
  await page.getByRole('button', { name: 'إرسال كمية إلى خط الإنتاج', exact: true }).click();
  await expect.poll(() => committed, { timeout: 15000 }).toBe(true);
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).toBeVisible();
  await page.reload();
  await page.unroute('**/withdrawals');
  await page.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('fermentation-balance')).toContainText('20000');
  await expect(page.getByRole('row').filter({ hasText: 'بانتظار بدء الفرن' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'بانتظار بدء الفرن' })).toContainText(
    '5000',
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('fermentation-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('fermentation-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('الكمية المراد إخراجها بالجرام').fill('20000.001');
  await page.getByRole('button', { name: 'إرسال كمية إلى خط الإنتاج', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('أكبر من الرصيد');
  await expect(page.getByTestId('fermentation-balance')).toContainText('20000');
});
test('starts a withdrawn portion in a selected oven and recovers a lost response', async ({
  page,
}, testInfo) => {
  const { startFixture } = await import('../production-fixtures');
  const { readyFermentation, withdrawFermentation } = await import('../../src/server/fermentation');
  const fixture = await startFixture(owner.member);
  const id = fixture.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner.member, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const batch = await withdrawFermentation(owner.member, randomUUID(), id, {
    expected_version: 2,
    quantity_g: '1000.000',
  });
  const order = batch.orders.items[0];
  const oven = await createAsset(owner.member, randomUUID(), {
    name: `فرن متصفح ${randomUUID().slice(0, 8)}`,
    category: 'oven',
    location: '',
    notes: '',
  });
  await signIn(page);
  await page.goto(`/production/${id}`);
  await page.getByRole('button', { name: 'بدء الفرن', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('البحث عن فرن', { exact: true }).fill(oven.name);
  await expect(dialog.getByRole('combobox', { name: 'الفرن', exact: true })).toHaveValue(oven.id);
  await dialog.getByLabel('مدة الفرن', { exact: true }).fill('2');
  await dialog.getByLabel('وحدة المدة', { exact: true }).selectOption('1');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('oven-start-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  let ovenCommitted = false;
  await page.route(`**/production-orders/${order.id}/start`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
    ovenCommitted = true;
  });
  await dialog.getByRole('button', { name: 'بدء الفرن', exact: true }).click();
  await expect.poll(() => ovenCommitted, { timeout: 15000 }).toBe(true);
  await expect(dialog.getByText('يوجد طلب لم نتأكد من نتيجته')).toBeVisible();
  await page.reload();
  await page.unroute(`**/production-orders/${order.id}/start`);
  await page.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).not.toBeVisible();
  const row = page.getByRole('row').filter({ hasText: oven.name });
  await expect(row).toContainText('قيد التشغيل');
  await expect(row.getByRole('timer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'بدء الفرن', exact: true })).toHaveCount(0);
  await page.reload();
  const result = await (await page.request.get(`/api/v1/fermentations/${id}`)).json();
  const saved = result.orders.items[0];
  expect(saved.stage_version).toBe(2);
  expect(Date.parse(saved.due_at) - Date.parse(saved.started_at)).toBe(120000);
  expect(result.fermentation.balance_g).toBe('24000.000');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('oven-running-desktop.png'), fullPage: true });
});
test('rejects anonymous production reads and unauthorised configuration without exposing data', async ({
  request,
  page,
}) => {
  expect((await request.get('/api/v1/fermentations')).status()).toBe(401);
  const manager = await testMember();
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(manager.email);
  await page.getByLabel('كلمة المرور').fill(manager.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await page.goto('/settings');
  await expect(page.getByLabel('اسم المصنع', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'حفظ الإعدادات' })).toHaveCount(0);
  const denied = await page.request.patch('/api/v1/settings', {
    headers: { Origin: 'http://localhost:3109', 'Idempotency-Key': randomUUID() },
    data: {
      name: 'غير مسموح',
      timezone: 'UTC',
      week_starts_on: 0,
      measurement_confirmed: true,
      expected_version: 1,
    },
  });
  expect(denied.status()).toBe(403);
});
