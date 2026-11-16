import { test, expect } from '../browser-fixtures';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { productionFixture } from '../production-fixtures';
let owner: Awaited<ReturnType<typeof testMember>>, operator: Awaited<ReturnType<typeof testMember>>;
test.beforeAll(async () => {
  await migrate();
  owner = await testMember('owner');
  operator = await testMember('operator');
  await productionFixture(owner.member);
});
test('opens reports, filters calendar and custom periods, handles invalid dates and mobile layout', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner.email);
  await page.getByLabel('كلمة المرور').fill(owner.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/login$/);
  await page.getByRole('link', { name: 'التقارير', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'التقارير ولوحة الإدارة', exact: true }),
  ).toBeVisible();
  await page.getByLabel('الفترة', { exact: true }).selectOption('year');
  await page.getByLabel('تاريخ ضمن الفترة').fill('2026-11-06');
  await page.getByRole('button', { name: 'عرض التقرير' }).click();
  await expect(page.getByRole('heading', { name: /حركة الفترة:/ })).toContainText('2026-01-01');
  await page.getByLabel('الفترة', { exact: true }).selectOption('custom');
  await page.getByLabel('من تاريخ').fill('2000-01-01');
  await page.getByLabel('إلى تاريخ').fill('2000-01-01');
  await page.getByRole('button', { name: 'عرض التقرير' }).click();
  await expect(page.getByText('لا توجد حركة منتجات في الفترة المختارة.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/reports?period=custom&from=2026-12-01&to=2026-01-01');
  await expect(page.getByRole('alert')).toContainText('تاريخ النهاية');
});
test('reports require an authorised manager or owner', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/login$/);
  await page.getByLabel('البريد الإلكتروني').fill(operator.email);
  await page.getByLabel('كلمة المرور').fill(operator.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/login$/);
  await page.goto('/reports');
  await expect(page).toHaveURL(/access$/);
});
