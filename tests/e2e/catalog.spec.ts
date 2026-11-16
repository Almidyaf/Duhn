import type { Page } from '@playwright/test';
import { test, expect } from '../browser-fixtures';
import { randomUUID } from 'node:crypto';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { createCatalogItem } from '../../src/server/catalog';
let login: Awaited<ReturnType<typeof testMember>>;
let operator: Awaited<ReturnType<typeof testMember>>;
async function signIn(page: Page, credentials = login) {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(credentials.email);
  await page.getByLabel('كلمة المرور').fill(credentials.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
test.beforeAll(async () => {
  await migrate();
  login = await testMember();
  operator = await testMember('operator');
});
test('purchase navigation has six icon destinations with stable URLs and mobile layout', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto('/purchases/catalog?view=finished');
  const nav = page.getByRole('navigation', { name: 'صفحات المشتريات' });
  await expect(nav.getByRole('link')).toHaveCount(6);
  await expect(nav.locator('svg')).toHaveCount(6);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('دهون العود');
  await expect(nav.getByRole('link', { name: 'دهون العود', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await nav.getByRole('link', { name: 'الموردون', exact: true }).click();
  await expect(page).toHaveURL(/view=suppliers/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الموردون');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الموردون');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('دهون العود');
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('الموردون');
  for (const label of ['استلام المواد', 'أرصدة المخزون', 'التصنيفات', 'المواد الخام']) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  }
  await expect(page.locator('.catalog-tabs')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('purchase-navigation-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('purchase-navigation-mobile.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 740 });
  const box = await nav.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
test('type-first catalog, recipe revision copy, supplier, persistence and mobile', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.getByRole('link', { name: 'المشتريات', exact: true }).click();
  await page.getByRole('link', { name: 'المواد الخام', exact: true }).click();
  const type = `نوع واجهة ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'إضافة تصنيف عود', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم تصنيف العود').fill(type);
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('البحث في السجل').fill(type);
  await page.getByRole('button', { name: `عرض المواد الخام ${type}`, exact: true }).click();
  const raw = `خام ${randomUUID().slice(0, 8)}`;
  const finished = `دهن ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'إضافة مادة خام', exact: true }).click();
  await dialog.getByLabel('اسم المادة الخام', { exact: true }).fill(raw);
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: raw })).toHaveCount(1);
  await page.getByRole('link', { name: 'دهون العود', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: raw })).toHaveCount(0);
  await page.getByRole('button', { name: 'إضافة دهن عود', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'البحث في الخيارات · تصنيف الدهن', exact: true })
    .click();
  await dialog.getByRole('textbox', { name: 'بحث الخيارات · تصنيف الدهن', exact: true }).fill(type);
  const classification = dialog.getByRole('combobox', { name: 'تصنيف الدهن', exact: true });
  await expect(classification.locator('option').filter({ hasText: type })).toHaveCount(1);
  await classification.selectOption({ label: type });
  await dialog.getByLabel('اسم الدهن أو المنتج النهائي', { exact: true }).fill(finished);
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: finished })).toHaveCount(1);
  await page
    .getByRole('row')
    .filter({ hasText: finished })
    .getByRole('link', { name: 'وصفات المنتج' })
    .click();
  await expect(page.getByRole('heading', { name: finished, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'إصدار جديد', exact: true }).click();
  const pickRaw = async () => {
    await dialog
      .getByRole('button', { name: 'البحث في الخيارات · تصنيف المادة الخام', exact: true })
      .click();
    await dialog
      .getByRole('textbox', { name: 'بحث الخيارات · تصنيف المادة الخام', exact: true })
      .fill(type);
    await expect(
      dialog
        .getByRole('combobox', { name: 'تصنيف المادة الخام', exact: true })
        .locator('option')
        .filter({ hasText: type }),
    ).toHaveCount(1);
    await dialog
      .getByRole('combobox', { name: 'تصنيف المادة الخام', exact: true })
      .selectOption({ label: type });
    await expect(
      dialog
        .getByRole('combobox', { name: 'المادة الخام', exact: true })
        .locator('option')
        .filter({ hasText: raw }),
    ).toHaveCount(1);
    await expect(
      dialog
        .getByRole('combobox', { name: 'المادة الخام', exact: true })
        .locator('option')
        .filter({ hasText: finished }),
    ).toHaveCount(0);
    await dialog
      .getByRole('combobox', { name: 'المادة الخام', exact: true })
      .selectOption({ label: raw });
  };
  await pickRaw();
  for (const stage of ['التخمير', 'الفرن']) {
    const group = dialog.getByRole('group', { name: stage, exact: true });
    await group.getByLabel('المدة بالدقائق', { exact: true }).fill('60');
    await group.getByLabel('تنبيه قبل الانتهاء بالدقائق', { exact: true }).fill('15');
    await group.getByLabel('مهلة التأخير بالدقائق', { exact: true }).fill('10');
    await group.getByLabel('طريقة احتساب الوقت').selectOption('active');
    await group.getByLabel('سياسة الاستئناف').selectOption('require_review');
  }
  await dialog.getByRole('button', { name: 'حفظ إصدار مسودة' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'الإصدار 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'نسخ إلى إصدار جديد' }).click();
  await expect(
    dialog.getByRole('combobox', { name: 'المادة الخام', exact: true }).locator('option:checked'),
  ).toHaveText(raw);
  await dialog
    .getByRole('group', { name: 'الفرن', exact: true })
    .getByLabel('المدة بالدقائق', { exact: true })
    .fill('90');
  await dialog.getByRole('button', { name: 'حفظ إصدار مسودة' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'الإصدار 2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'الإصدار 1', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('recipes-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('recipes-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('link', { name: 'العودة إلى دهون العود' }).click();
  await page.getByRole('link', { name: 'الموردون', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة مورد', exact: true }).click();
  const supplier = `مورد ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('اسم المورد').fill(supplier);
  await dialog.getByLabel('وسيلة التواصل').fill('مرجع اختبار');
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('البحث في السجل').fill(supplier);
  await expect(page.getByRole('row').filter({ hasText: supplier })).toContainText('مرجع اختبار');
});
test('catalog save recovers after committed response loss, without creating a second type', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/purchases/catalog');
  const name = `استعادة نوع ${randomUUID().slice(0, 8)}`;
  await page.route('**/api/v1/catalog/types', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'إضافة تصنيف عود', exact: true }).click();
  await page.getByRole('dialog').getByLabel('اسم تصنيف العود').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).toBeVisible();
  await page.reload();
  await page.unroute('**/api/v1/catalog/types');
  await page.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).not.toBeVisible();
  await page.getByRole('link', { name: 'التصنيفات', exact: true }).click();
  await page.getByLabel('البحث في السجل').fill(name);
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
});
test('rejects stale UI edits and enforces authorization and type filtering at HTTP boundary', async ({
  page,
}) => {
  const type = await createCatalogItem(login.member, randomUUID(), 'types', {
    name: `تعارض ${randomUUID().slice(0, 8)}`,
  });
  await signIn(page);
  await page.goto('/purchases/catalog');
  await page.getByRole('link', { name: 'التصنيفات', exact: true }).click();
  await page.getByLabel('البحث في السجل').fill(type.name);
  await page.getByRole('button', { name: `تعديل ${type.name}`, exact: true }).click();
  const updated = await page.request.patch(`/api/v1/catalog/types/${type.id}`, {
    headers: { Origin: 'http://localhost:3109', 'Idempotency-Key': randomUUID() },
    data: { name: type.name, active: false, expected_version: type.version },
  });
  expect(updated.status()).toBe(200);
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'تغيرت البيانات' })).toContainText(
    'تغيرت البيانات',
  );
  await expect(page.getByRole('row').filter({ hasText: type.name })).toContainText('معطل');
  expect((await page.request.get('/api/v1/catalog/products')).status()).toBe(400);
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await signIn(page, operator);
  expect((await page.request.get('/api/v1/catalog/types')).status()).toBe(403);
  const denied = await page.request.post('/api/v1/catalog/types', {
    headers: { Origin: 'http://localhost:3109', 'Idempotency-Key': randomUUID() },
    data: { name: 'مرفوض' },
  });
  expect(denied.status()).toBe(403);
  await page.goto('/purchases/catalog');
  await expect(page).toHaveURL(/\/access$/);
});

test('add raw material directly from catalog landing and retain it after reload', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/purchases/catalog');
  const suffix = randomUUID().slice(0, 8);
  const type = `نوع مباشر ${suffix}`;
  const raw = `مادة مباشرة ${suffix}`;
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'إضافة تصنيف عود', exact: true }).click();
  await dialog.getByLabel('اسم تصنيف العود').fill(type);
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/view=types/);
  await page.getByRole('link', { name: 'المواد الخام', exact: true }).click();
  await page.getByRole('button', { name: 'إضافة مادة خام', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'البحث في الخيارات · تصنيف العود', exact: true })
    .click();
  await dialog.getByRole('textbox', { name: 'بحث الخيارات · تصنيف العود', exact: true }).fill(type);
  const picker = dialog.getByRole('combobox', { name: 'تصنيف العود', exact: true });
  await expect(picker.locator('option').filter({ hasText: type })).toHaveCount(1);
  await picker.selectOption({ label: type });
  await dialog.getByLabel('اسم المادة الخام', { exact: true }).fill(raw);
  await expect(dialog.locator('input[name=kind]')).toHaveValue('raw');
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: type, exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: raw })).toContainText(type);
  await page.reload();
  await page.getByRole('link', { name: 'التصنيفات', exact: true }).click();
  await page.getByLabel('البحث في السجل').fill(type);
  await page.getByRole('button', { name: `عرض المواد الخام ${type}`, exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: raw })).toContainText(type);
});

test('oil classifications contain multiple oils and filter independently from raw materials', async ({
  page,
}, testInfo) => {
  const suffix = randomUUID().slice(0, 8);
  const classification = await createCatalogItem(login.member, randomUUID(), 'types', {
    name: `هندي ${suffix}`,
  });
  const other = await createCatalogItem(login.member, randomUUID(), 'types', {
    name: `كمبودي ${suffix}`,
  });
  const raw = await createCatalogItem(login.member, randomUUID(), 'products', {
    name: `خشب ${suffix}`,
    kind: 'raw',
  });
  const oil = await createCatalogItem(login.member, randomUUID(), 'products', {
    name: `سيوفي ${suffix}`,
    kind: 'finished',
    raw_product_id: raw.id,
  });
  const otherRaw = await createCatalogItem(login.member, randomUUID(), 'products', {
    name: `خشب كمبودي ${suffix}`,
    kind: 'raw',
  });
  const otherOil = await createCatalogItem(login.member, randomUUID(), 'products', {
    name: `كمبودي ${suffix}`,
    kind: 'finished',
    raw_product_id: otherRaw.id,
  });
  await signIn(page);
  await page.goto('/purchases/catalog');
  await expect(page.locator('.catalog-guide, .record-note')).toHaveCount(0);
  await page.getByRole('link', { name: 'التصنيفات', exact: true }).click();
  await page.getByLabel('البحث في السجل').fill(classification.name);
  await page
    .getByRole('button', { name: `عرض الدهون ${classification.name}`, exact: true })
    .click();
  await expect(page.getByRole('row').filter({ hasText: oil.name })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: raw.name })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: otherOil.name })).toHaveCount(0);
  await page.getByRole('button', { name: 'إضافة دهن عود', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('combobox', { name: 'تصنيف الدهن', exact: true })).toHaveValue(
    classification.id,
  );
  const secondOil = `سيوفي معتق ${suffix}`;
  await dialog.getByLabel('اسم الدهن أو المنتج النهائي', { exact: true }).fill(secondOil);
  await dialog.getByRole('button', { name: 'حفظ البيانات' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: secondOil })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: oil.name })).toBeVisible();
  await page.getByRole('button', { name: 'البحث في الخيارات · تصنيف الدهن', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'بحث الخيارات · تصنيف الدهن', exact: true })
    .fill(other.name);
  const filter = page.getByRole('combobox', { name: 'تصنيف الدهن', exact: true });
  await expect(filter.locator('option').filter({ hasText: other.name })).toHaveCount(1);
  await filter.selectOption(other.id);
  await expect(page.getByRole('row').filter({ hasText: otherOil.name })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: oil.name })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: secondOil })).toHaveCount(0);
  await filter.selectOption('');
  await page.getByLabel('البحث في السجل').fill(suffix);
  await expect(page.getByRole('row').filter({ hasText: suffix })).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath('oil-classifications-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath('oil-classifications-mobile.png'),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole('link', { name: 'دهون العود', exact: true }).click();
  await page.getByLabel('البحث في السجل').fill(secondOil);
  await expect(page.getByRole('row').filter({ hasText: secondOil })).toContainText(
    classification.name,
  );
});
