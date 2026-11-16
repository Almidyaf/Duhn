import { test, expect } from '../browser-fixtures';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { startFixture } from '../production-fixtures';
test('notification bell shows production movements, supports read state and opens the operation', async ({
  page,
}, testInfo) => {
  await migrate();
  const owner = await testMember('owner');
  const f = await startFixture(owner.member);
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner.email);
  await page.getByLabel('كلمة المرور').fill(owner.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  const dialog = page.getByRole('dialog', { name: 'الإشعارات', exact: true });
  const notice = dialog.getByRole('article').filter({ hasText: f.product.name });
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText('بدأ تخمير دفعة');
  await notice.getByRole('button', { name: 'تعليم كمقروء', exact: true }).click();
  await expect(notice.getByRole('button', { name: 'تعليم كمقروء', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('notifications-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await notice.getByRole('link', { name: 'فتح العملية' }).click();
  await expect(page).toHaveURL(new RegExp('/production/' + f.batch.fermentation.id));
  await page.reload();
  await page.getByRole('button', { name: /^الإشعارات/ }).click();
  await expect(
    dialog
      .getByRole('article')
      .filter({ hasText: f.product.name })
      .getByRole('button', { name: 'تعليم كمقروء', exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'تعليم الكل كمقروء' }).click();
  await expect(dialog.getByText('0 غير مقروءة', { exact: true })).toBeVisible();
});
