import './env';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../src/server/db';
import type { Member } from '../src/server/members';
import { createCatalogItem, createRecipe } from '../src/server/catalog';
import { getFactorySettings, updateFactorySettings, approveRecipe } from '../src/server/settings';
import { createReceipt } from '../src/server/receipts';
import {
  fermentationOptions,
  startFermentation,
  readyFermentation,
  withdrawFermentation,
  getFermentation,
} from '../src/server/fermentation';
import { createAsset } from '../src/server/assets';
import { factoryProfile } from '../src/config/factory-profile';

// Explicit local demo command. Never deletes, rewrites history, or changes existing settings.
const db = new URL(process.env.DATABASE_URL!);
if (
  !['localhost', '127.0.0.1'].includes(db.hostname) ||
  db.pathname !== '/duhn' ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('Local duhn demo database only.');
const file = '.local/demo-fixture-v1.json';
mkdirSync('.local', { recursive: true });
type Entry = { key: string; payload: unknown; result?: unknown; done?: boolean };
const state: Record<string, Entry> = (() => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
})();
function save() {
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}
async function step<T, P>(
  name: string,
  payload: P,
  run: (key: string, payload: P) => Promise<T>,
): Promise<T> {
  const entry = (state[name] ??= { key: randomUUID(), payload });
  if (entry.done) return entry.result as T;
  save();
  const result = await run(entry.key, entry.payload as P);
  entry.result = result;
  entry.done = true;
  save();
  return result;
}
async function main() {
  const owner = (
    await getPool().query<Member>(
      `SELECT u.id,u.name,m.role FROM "user" u JOIN app_members m ON m.user_id=u.id WHERE u.email=$1 AND m.role='owner' AND m.active=true`,
      ['demo@duhn.test'],
    )
  ).rows[0];
  if (!owner) throw new Error('Active demo owner required.');
  let settings = await getFactorySettings(owner);
  if (!settings.configured)
    settings = await step(
      'demo-settings',
      {
        name: factoryProfile.name,
        timezone: factoryProfile.timezone,
        week_starts_on: 1,
        measurement_confirmed: true as const,
        expected_version: settings.version,
      },
      (key, data) => updateFactorySettings(owner, key, data),
    );
  for (const [category, name] of [
    ['oven', 'فرن تجريبي 1'],
    ['fermentation_vessel', 'وعاء تخمير تجريبي 1'],
    ['scale', 'ميزان تجريبي'],
  ] as const) {
    await step(
      `asset-${category}`,
      { name, category, location: 'منطقة العرض التجريبي', notes: 'بيانات اختبار فقط' },
      (key, data) => createAsset(owner, key, data),
    );
  }
  const supplier = await step(
    'supplier',
    { name: 'مورد تجريبي — مواد العود', contact: '' },
    (key, data) => createCatalogItem(owner, key, 'suppliers', data),
  );
  const batches: { id: string; withdraw: string | null }[] = [];
  for (const [i, origin, received, quantity, withdrawal] of [
    [1, 'تايلندي — ترات', '60000.000', '25000.000', '5000.000'],
    [2, 'هندي', '45000.000', '15000.000', '3000.000'],
    [3, 'كمبودي', '35000.000', '10000.000', null],
    [4, 'ماليزي', '50000.000', '50000.000', '30000.000'],
  ] as const) {
    const type = await step(`type-${i}`, { name: `عود ${origin} — تجريبي` }, (key, data) =>
      createCatalogItem(owner, key, 'types', data),
    );
    const raw = await step(
      `raw-${i}`,
      { name: `عود ${origin} للتقطير — تجريبي`, type_id: type.id, kind: 'raw' as const },
      (key, data) => createCatalogItem(owner, key, 'products', data),
    );
    const product = await step(
      `product-${i}`,
      { name: `دهن العود ${origin} — تجريبي`, type_id: type.id, kind: 'finished' as const },
      (key, data) => createCatalogItem(owner, key, 'products', data),
    );
    const timing = {
      duration_minutes: i === 3 ? 10080 : 1,
      warning_minutes: 0,
      grace_minutes: 30,
      time_basis: 'elapsed' as const,
      resume_policy: 'require_review' as const,
    };
    const recipe = await step(
      `recipe-${i}`,
      {
        expected_version: product.version,
        raw_product_id: raw.id,
        policy: {
          fermentation: timing,
          oven: { ...timing, duration_minutes: 240, time_basis: 'active' as const },
        },
        note: 'وصفة عرض تجريبي فقط، ليست تعليمات تصنيع فعلية.',
      },
      (key, data) => createRecipe(owner, key, product.id, data),
    );
    await step(
      `approval-${i}`,
      {
        expected_version: recipe.product_version,
        settings_version: settings.version,
        note: 'اعتماد محاكاة بطلب المستخدم؛ لا يستخدم للإنتاج الفعلي',
        process_confirmed: true as const,
      },
      (key, data) => approveRecipe(owner, key, product.id, recipe.recipe.id, data),
    );
    await step(
      `receipt-${i}`,
      {
        kind: 'purchase' as const,
        supplier_id: supplier.id,
        reference: `DEMO-V1-${i}`,
        note: 'رصيد تجريبي بطلب المستخدم',
        lines: [{ type_id: type.id, product_id: raw.id, quantity_g: received }],
      },
      (key, data) => createReceipt(owner, key, data),
    );
    const options = await fermentationOptions(owner, product.id);
    const source = options.sources.items[0];
    const batch = await step(
      `fermentation-${i}`,
      {
        product_id: product.id,
        recipe_id: recipe.recipe.id,
        raw_lot_id: source?.id,
        source_version: source?.version,
        settings_version: options.settings_version,
        quantity_g: quantity,
      },
      (key, data) => startFermentation(owner, key, data),
    );
    batches.push({ id: batch.fermentation.id, withdraw: withdrawal });
  }
  console.log('Demo products, assets, receipts and four fermentation batches created.');
  for (const [i, batch] of batches.entries()) {
    if (!batch.withdraw) continue;
    const current = await getFermentation(owner, batch.id);
    const delay = Math.max(0, Date.parse(current.fermentation.due_at) - Date.now() + 250);
    if (delay) {
      console.log('Waiting for the real demo timer before simulated inspection.');
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 60000)));
    }
    const ready = await step(
      `ready-${i + 1}`,
      { expected_version: current.fermentation.version, inspection_confirmed: true as const },
      (key, data) => readyFermentation(owner, key, batch.id, data),
    );
    await step(
      `withdraw-${i + 1}`,
      { expected_version: ready.fermentation.version, quantity_g: batch.withdraw },
      (key, data) => withdrawFermentation(owner, key, batch.id, data),
    );
  }
  console.log(
    'Demo ready: 190000 g received; 100000 g entered fermentation; 38000 g awaiting oven; 62000 g remain in fermentation; 90000 g raw stock.',
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Demo failed');
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
