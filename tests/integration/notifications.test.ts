import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db';
import { testMember } from '../fixtures';
import { startFixture, matureFermentation } from '../production-fixtures';
import { listNotifications, readNotifications } from '../../src/server/notifications';
beforeAll(migrate);
afterAll(async () => {
  await getPool().end();
});
it('projects movement and timed alerts once, keeps user reads independent and restricts access', async () => {
  const owner = (await testMember('owner')).member,
    other = (await testMember()).member;
  const f = await startFixture(owner);
  await matureFermentation(f.batch.fermentation.id);
  await Promise.all([listNotifications(owner), listNotifications(other)]);
  const rows = (
    await getPool().query('SELECT * FROM notifications WHERE href=$1', [
      '/production/' + f.batch.fermentation.id,
    ])
  ).rows;
  expect(rows.some((n) => n.title === 'بدأ تخمير دفعة')).toBe(true);
  expect(rows.some((n) => n.title === 'التخمير: حان موعد الفحص')).toBe(true);
  expect(rows.some((n) => n.title === 'التخمير: تأخر تأكيد الفحص')).toBe(true);
  expect(rows.some((n) => n.title === 'التخمير: اقترب موعد الفحص')).toBe(false);
  const ids = rows.map((r) => r.id);
  await readNotifications(owner, ids);
  await readNotifications(owner, ids);
  await listNotifications(owner);
  expect(
    (
      await getPool().query('SELECT count(*)::int AS n FROM notifications WHERE href=$1', [
        '/production/' + f.batch.fermentation.id,
      ])
    ).rows[0].n,
  ).toBe(rows.length);
  expect(
    (
      await getPool().query(
        'SELECT count(*)::int AS n FROM notification_reads WHERE user_id=$1 AND notification_id=ANY($2::text[])',
        [owner.id, ids],
      )
    ).rows[0].n,
  ).toBe(rows.length);
  expect(
    (
      await getPool().query('SELECT count(*)::int AS n FROM notification_reads WHERE user_id=$1', [
        other.id,
      ])
    ).rows[0].n,
  ).toBe(0);
  const operator = (await testMember('operator')).member;
  await expect(listNotifications(operator)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(readNotifications(operator, [`event:${randomUUID()}`])).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});
