import { test, expect } from '../browser-fixtures';
import { randomUUID } from 'node:crypto';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';

let login: { email: string; password: string };
test.beforeAll(async () => {
  await migrate();
  login = await testMember();
});
test('Arabic login, persistent asset, edit, mobile layout and logout', async ({
  page,
}, testInfo) => {
  await page.goto('/assets');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('البريد الإلكتروني').fill(login.email);
  await page.getByLabel('كلمة المرور').fill(login.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'الأصول والمعدات' })).toBeVisible();
  const name = `فرن ${randomUUID().slice(0, 8)}`;
  await page.getByRole('button', { name: 'إضافة أصل', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('اسم الأصل').fill(name);
  await dialog.getByLabel('الفئة').selectOption('oven');
  await dialog.getByLabel('الموقع').fill('منطقة الإنتاج');
  await dialog.getByRole('button', { name: 'حفظ الأصل' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('البحث باسم الأصل').fill(name);
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
  await page.reload();
  await page.getByLabel('البحث باسم الأصل').fill(name);
  await page.getByRole('button', { name: `تعديل ${name}`, exact: true }).click();
  await dialog.getByLabel('متاح للاستخدام').uncheck();
  await dialog.getByRole('button', { name: 'حفظ الأصل' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('معطل');
  await page.screenshot({ path: testInfo.outputPath('assets-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'الأصول والمعدات' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('assets-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')]
      .map((el) => ({
        tag: el.tagName,
        cls: el.className,
        left: el.getBoundingClientRect().left,
        right: el.getBoundingClientRect().right,
      }))
      .filter((el) => el.left < 0 || el.right > innerWidth)
      .slice(0, 20),
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test('recovers a committed request after the response is lost and the page reloads', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(login.email);
  await page.getByLabel('كلمة المرور').fill(login.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).toHaveURL(/\/assets$/);
  const name = `استعادة ${randomUUID().slice(0, 8)}`;
  await page.route('**/api/v1/assets', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'إضافة أصل', exact: true }).first().click();
  await page.getByRole('dialog').getByLabel('اسم الأصل').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'حفظ الأصل' }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).toBeVisible();
  await page.reload();
  await page.unroute('**/api/v1/assets');
  await page.getByRole('button', { name: 'التحقق من الحفظ', exact: true }).click();
  await expect(page.getByText('يوجد طلب لم نتأكد من نتيجته')).not.toBeVisible();
  await page.getByLabel('البحث باسم الأصل').fill(name);
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
});
test('rejects anonymous writes and public account creation', async ({ request }) => {
  const asset = await request.post('/api/v1/assets', {
    data: { name: 'غير مصرح', category: 'oven' },
    headers: { Origin: 'http://localhost:3109', 'Idempotency-Key': randomUUID() },
  });
  expect(asset.status()).toBe(401);
  const signup = await request.post('/api/auth/sign-up/email', {
    data: {
      name: 'غير مصرح',
      email: `blocked-${randomUUID()}@duhn.invalid`,
      password: randomUUID(),
    },
    headers: { Origin: 'http://localhost:3109' },
  });
  expect(signup.ok()).toBeFalsy();
});
