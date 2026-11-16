import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../browser-fixtures';
import { migrate } from '../../scripts/migrate';
import { testMember } from '../fixtures';
import { createCatalogItem } from '../../src/server/catalog';
import type { CatalogItem } from '../../src/contracts/catalog';
let login: Awaited<ReturnType<typeof testMember>>;
let owner: Awaited<ReturnType<typeof testMember>>;
let type: CatalogItem;
let raw: CatalogItem;
let supplier: CatalogItem;
let otherType: CatalogItem;
test.beforeAll(async () => {
  await migrate();
  login = await testMember();
  owner = await testMember('owner');
  type = await createCatalogItem(login.member, randomUUID(), 'types', {
    name: `نوع استلام ${randomUUID().slice(0, 8)}`,
  });
  otherType = await createCatalogItem(login.member, randomUUID(), 'types', {
    name: `نوع مستقل ${randomUUID().slice(0, 8)}`,
  });
  raw = await createCatalogItem(login.member, randomUUID(), 'products', {
    name: `خشب اختبار ${randomUUID().slice(0, 8)}`,
    kind: 'raw',
  });
  supplier = await createCatalogItem(login.member, randomUUID(), 'suppliers', {
    name: `مورد اختبار ${randomUUID().slice(0, 8)}`,
    contact: '',
  });
});
async function signIn(page: Page, credentials = login) {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(credentials.email);
  await page.getByLabel('كلمة المرور').fill(credentials.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await page.getByRole('link', { name: 'المشتريات', exact: true }).click();
}
async function choose(page: Page, label: string, item: CatalogItem) {
  const dialog = page.getByRole('dialog');
  const searchToggle = dialog.getByRole('button', {
    name: `البحث في الخيارات · ${label}`,
    exact: true,
  });
  if ((await searchToggle.getAttribute('aria-expanded')) === 'false') await searchToggle.click();
  await dialog
    .getByRole('textbox', { name: `بحث الخيارات · ${label}`, exact: true })
    .fill(item.name);
  await expect(
    dialog
      .getByRole('combobox', { name: label, exact: true })
      .locator(`option[value="${item.id}"]`),
  ).toHaveCount(1);
  await dialog.getByRole('combobox', { name: label, exact: true }).selectOption(item.id);
}
async function fill(page: Page, reference: string) {
  await page.getByRole('button', { name: 'تسجيل استلام', exact: true }).click();
  await choose(page, 'المورد', supplier);
  await page.getByRole('dialog').getByLabel('رقم فاتورة أو سند المورد').fill(reference);
  await page.getByRole('dialog').getByRole('button', { name: 'متابعة', exact: true }).click();
  await choose(page, 'تصنيف العود', type);
  await choose(page, 'اسم المنتج (مادة خام)', raw);
  await page.getByRole('dialog').getByLabel('الوزن الصافي بالجرام').fill('٢٥٠٠٠٫١٢٥');
}
test('receives exact Arabic weight, resets product when type changes, shows stock and reverses without deleting history', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(
    page.getByRole('button', { name: 'تسجيل المواد الموجودة مسبقًا', exact: true }),
  ).toHaveCount(0);
  const reference = `E2E-${randomUUID().slice(0, 8)}`;
  await fill(page, reference);
  await choose(page, 'تصنيف العود', otherType);
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'اسم المنتج (مادة خام)', exact: true }),
  ).toHaveValue('');
  await choose(page, 'تصنيف العود', type);
  await choose(page, 'اسم المنتج (مادة خام)', raw);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'اعتماد الاستلام', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByLabel('البحث بالمرجع أو المورد أو المنتج').fill(reference);
  const row = page.getByRole('row').filter({ hasText: reference });
  await expect(row).toContainText('25000.125');
  await row.getByRole('link', { name: 'عرض التفاصيل' }).click();
  await expect(page).toHaveURL(/\/purchases\/[0-9a-f-]{36}$/);
  const receiptUrl = page.url();
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toContainText('25000.125');
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toContainText('25000.125');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('receipt-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('receipt-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/purchases/stock');
  await page.getByLabel('البحث بالمنتج أو رقم الدفعة أو المرجع').fill(reference);
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toContainText('25000.125');
  await page.goto(receiptUrl);
  await page.getByRole('button', { name: 'إلغاء الاستلام', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByLabel('سبب إلغاء الاستلام')
    .fill('استلام اختباري مسجل بالخطأ');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'تأكيد إلغاء الاستلام', exact: true })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('ملغى', { exact: true })).toBeVisible();
  const line = page.getByRole('row').filter({ hasText: raw.name });
  await expect(line.getByRole('cell').nth(2)).toContainText('25000.125');
  await expect(line.getByRole('cell').nth(3)).toContainText('0');
  await page.goto('/purchases/stock');
  await page.getByLabel('البحث بالمنتج أو رقم الدفعة أو المرجع').fill(reference);
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toHaveCount(0);
});
test('recovers committed receipt after response loss and prevents reusing a supplier reference', async ({
  page,
}) => {
  await signIn(page);
  const reference = `LOST-${randomUUID().slice(0, 8)}`;
  await fill(page, reference);
  await page.route('**/api/v1/receipts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'اعتماد الاستلام', exact: true })
    .click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).toBeVisible();
  await page.reload();
  await page.unroute('**/api/v1/receipts');
  await page.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).not.toBeVisible();
  await page.getByLabel('البحث بالمرجع أو المورد أو المنتج').fill(reference);
  await expect(page.getByRole('row').filter({ hasText: reference })).toHaveCount(1);
  await fill(page, reference);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'اعتماد الاستلام', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('هذا المرجع مسجل');
});
test('owner records opening stock separately; server rejects manager opening and anonymous reads', async ({
  page,
  request,
}) => {
  expect((await request.get('/api/v1/receipts')).status()).toBe(401);
  await signIn(page);
  const denied = await page.request.post('/api/v1/receipts', {
    headers: { Origin: 'http://localhost:3109', 'Idempotency-Key': randomUUID() },
    data: {
      kind: 'opening',
      supplier_id: null,
      reference: '',
      note: 'جرد اختبار',
      lines: [{ type_id: type.id, product_id: raw.id, quantity_g: '1.000' }],
    },
  });
  expect(denied.status()).toBe(403);
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await signIn(page, owner);
  await page.getByRole('button', { name: 'تسجيل المواد الموجودة مسبقًا', exact: true }).click();
  const note = `جرد افتتاحي ${randomUUID().slice(0, 8)}`;
  await page.getByRole('dialog').getByLabel('لماذا تسجّل هذه المواد؟').selectOption('other');
  await page.getByRole('dialog').getByLabel('وضّح السبب').fill(note);
  await page.getByRole('dialog').getByRole('button', { name: 'متابعة', exact: true }).click();
  await choose(page, 'تصنيف العود', type);
  await choose(page, 'اسم المنتج (مادة خام)', raw);
  await page.getByRole('dialog').getByLabel('الوزن الصافي بالجرام').fill('100');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'مراجعة البيانات', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'حفظ المواد وإضافتها إلى الرصيد' })
    .click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'تسجيل المواد الموجودة مسبقًا' })
    .first()
    .getByRole('link', { name: 'عرض التفاصيل' })
    .click();
  await expect(page.getByText(note, { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toContainText('100');
});

test('creates a clear type and raw material inside receiving and recovers a lost creation response', async ({
  page,
}, testInfo) => {
  await signIn(page, owner);
  await page.getByRole('button', { name: 'تسجيل المواد الموجودة مسبقًا', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('لماذا تسجّل هذه المواد؟').selectOption('existing');
  await expect(d.getByRole('textbox')).toHaveCount(0);
  await d.getByRole('button', { name: 'متابعة', exact: true }).click();
  const typeName = `عود نوع جديد ${randomUUID().slice(0, 8)}`;
  const rawName = `خشب درجة أولى ${randomUUID().slice(0, 8)}`;
  await d.getByRole('button', { name: 'إضافة تصنيف عود', exact: true }).click();
  await d.getByLabel('اسم تصنيف العود الجديد').fill(typeName);
  await d.getByRole('button', { name: 'حفظ واختيار', exact: true }).click();
  await expect(
    d.getByRole('combobox', { name: 'تصنيف العود', exact: true }).locator('option:checked'),
  ).toHaveText(typeName);
  await d.getByRole('button', { name: 'إضافة منتج خام لهذا التصنيف', exact: true }).click();
  await d.getByLabel('اسم المنتج الخام الجديد').fill(rawName);
  let committed = false;
  await page.route('**/api/v1/catalog/products', async (route) => {
    if (route.request().method() === 'POST') {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort('failed');
      committed = true;
    } else await route.continue();
  });
  await d.getByRole('button', { name: 'حفظ واختيار', exact: true }).click();
  await expect.poll(() => committed, { timeout: 15000 }).toBe(true);
  await page.unroute('**/api/v1/catalog/products');
  await d.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(
    d
      .getByRole('combobox', { name: 'اسم المنتج (مادة خام)', exact: true })
      .locator('option:checked'),
  ).toHaveText(rawName);
  await expect(
    d.getByRole('combobox', { name: 'تصنيف العود', exact: true }).locator('option:checked'),
  ).toHaveText(typeName);
  await d.getByLabel('الوزن الصافي بالجرام', { exact: true }).fill('1250');
  await page.screenshot({ path: testInfo.outputPath('receiving-clear-fields.png') });
  await d.getByRole('button', { name: 'مراجعة البيانات', exact: true }).click();
  await expect(d.getByText(rawName, { exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'حفظ المواد وإضافتها إلى الرصيد', exact: true }).click();
  await expect(d).not.toBeVisible();
  await page.getByLabel('البحث بالمرجع أو المورد أو المنتج').fill(rawName);
  await expect(page.getByRole('row').filter({ hasText: '1250' })).toHaveCount(1);
});
