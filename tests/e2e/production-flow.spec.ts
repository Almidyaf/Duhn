import { randomUUID } from 'node:crypto';
import { test, expect } from '../browser-fixtures';
import { testMember } from '../fixtures';
import { migrate } from '../../scripts/migrate';
import { startFixture, matureFermentation } from '../production-fixtures';
import { readyFermentation, withdrawFermentation } from '../../src/server/fermentation';
import { createAsset } from '../../src/server/assets';
import { startOven } from '../../src/server/oven';
test('interactive production diagram follows each portion and keeps remaining fermentation visible', async ({
  page,
}, testInfo) => {
  await migrate();
  const owner = await testMember('owner');
  const f = await startFixture(owner.member);
  const id = f.batch.fermentation.id;
  await matureFermentation(id);
  await readyFermentation(owner.member, randomUUID(), id, {
    expected_version: 1,
    inspection_confirmed: true,
  });
  const first = await withdrawFermentation(owner.member, randomUUID(), id, {
    expected_version: 2,
    quantity_g: '1000.000',
  });
  const second = await withdrawFermentation(owner.member, randomUUID(), id, {
    expected_version: 3,
    quantity_g: '2000.000',
  });
  const a = first.orders.items[0],
    b = second.orders.items[0];
  const oven = await createAsset(owner.member, randomUUID(), {
    name: 'فرن المسار ' + randomUUID().slice(0, 6),
    category: 'oven',
    location: '',
    notes: '',
  });
  await startOven(owner.member, randomUUID(), a.id, {
    expected_version: 1,
    asset_id: oven.id,
    asset_version: oven.version,
    duration_minutes: 60,
  });
  await page.goto('/login');
  await page.getByLabel('البريد الإلكتروني').fill(owner.email);
  await page.getByLabel('كلمة المرور').fill(owner.password);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  await page.goto('/production/' + id);
  const paths = page.locator('.production-paths');
  await expect(paths.locator('.production-path')).toHaveCount(2);
  const graph = page
    .getByRole('group', { name: 'مسار الجزء 01', exact: true })
    .getByRole('region', { name: 'مسار الإنتاج', exact: true });
  const otherGraph = page.getByRole('group', { name: 'مسار الجزء 02', exact: true });
  await expect(otherGraph).toContainText('بانتظار بدء الفرن');
  await expect(page.getByLabel('عرض مسار جزء الإنتاج')).toHaveCount(0);
  await expect(graph.getByRole('button', { name: /^التخمير/ })).toBeVisible();

  await expect(graph).toContainText(oven.name);
  await expect(graph.getByRole('progressbar')).toBeVisible();
  await expect(graph.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /تقدم المدة .*%/);
  await expect(
    page.getByRole('row').filter({ hasText: oven.name }).getByRole('progressbar'),
  ).toBeVisible();
  const flame = graph.locator('.animated-flame.active .flame-outer').first();
  expect(await flame.evaluate((el) => getComputedStyle(el).animationName)).toBe('flame-lick');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const animation = await graph
    .locator('.stage-card-icon.oven > svg')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe('none');
  expect(await flame.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await expect(graph.getByRole('button', { name: /^الفرن/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
  await graph.getByRole('button', { name: /^التخمير/ }).click();
  await expect(graph).toContainText('22000 جم');
  await expect(graph).toContainText('تخمير مستمر');
  await graph.getByRole('button', { name: /^التصفية/ }).click();
  await expect(graph).toContainText('بانتظار اكتمال الفرن');
  await expect(graph.getByRole('progressbar')).toHaveCount(0);

  await otherGraph.getByRole('button', { name: 'بدء الفرن لهذا الجزء', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'بدء الفرن', exact: true })).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'إلغاء', exact: true })
    .first()
    .click();

  await paths.screenshot({ path: testInfo.outputPath('production-flow-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await graph.screenshot({ path: testInfo.outputPath('production-flow-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
