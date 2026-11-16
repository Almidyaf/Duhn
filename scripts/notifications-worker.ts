import './env';
import { getPool } from '../src/server/db';
import { syncNotifications } from '../src/server/notifications';
import type { Member } from '../src/server/members';
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log('Notification scheduler started (15 seconds).');
while (!stopping) {
  try {
    const member = (
      await getPool().query<Member>(
        `SELECT u.id,u.name,m.role FROM app_members m JOIN "user" u ON u.id=m.user_id WHERE m.active AND m.role IN ('owner','manager') ORDER BY m.user_id LIMIT 1`,
      )
    ).rows[0];
    if (member) await syncNotifications(member);
  } catch {
    console.error('Notification scheduler could not refresh; retrying.');
  }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
await getPool().end();
