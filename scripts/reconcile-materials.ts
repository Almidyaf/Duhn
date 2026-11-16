import './env';
import { reconcileMaterials } from '../src/server/material-ledger';
import { getPool } from '../src/server/db';
try {
  const differences = await reconcileMaterials();
  if (differences.length) {
    console.error('Material reconciliation failed; no data was changed.', differences);
    process.exitCode = 1;
  } else console.log('Material balances match the movement ledger. No data was changed.');
} catch {
  console.error('Could not verify material balances. Check database access.');
  process.exitCode = 1;
} finally {
  await getPool().end();
}
