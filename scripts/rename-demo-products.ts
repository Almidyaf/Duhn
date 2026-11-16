import './env';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../src/server/db';
import type { Member } from '../src/server/members';
import {
  getCatalogItem,
  updateCatalogItem,
  listRecipes,
  createRecipe,
} from '../src/server/catalog';
import { getFactorySettings, approveRecipe } from '../src/server/settings';
const db = new URL(process.env.DATABASE_URL!);
if (
  !['localhost', '127.0.0.1'].includes(db.hostname) ||
  db.pathname !== '/duhn' ||
  process.env.NODE_ENV === 'production'
)
  throw new Error('Local demo only');
const fixture = JSON.parse(readFileSync('.local/demo-fixture-v1.json', 'utf8'));
const names = [
  {
    type: 'عود تايلندي — ترات',
    raw: 'عود تايلندي للتقطير — ترات',
    product: 'دهن العود التايلندي — ترات',
  },
  { type: 'عود هندي', raw: 'عود هندي للتقطير', product: 'دهن العود الهندي' },
  { type: 'عود كمبودي', raw: 'عود كمبودي للتقطير', product: 'دهن العود الكمبودي' },
  { type: 'عود ماليزي', raw: 'عود ماليزي للتقطير', product: 'دهن العود الماليزي' },
];
async function main() {
  const owner = (
    await getPool().query<Member>(
      `SELECT u.id,u.name,m.role FROM "user" u JOIN app_members m ON m.user_id=u.id WHERE u.email=$1 AND m.role='owner' AND m.active`,
      ['demo@duhn.test'],
    )
  ).rows[0];
  if (!owner) throw new Error('Demo owner required');
  for (const [index, nameset] of names.entries()) {
    const i = index + 1;
    for (const field of ['type', 'raw', 'product'] as const) {
      const entity = field === 'type' ? 'types' : 'products';
      const old = await getCatalogItem(owner, entity, fixture[`${field}-${i}`].result.id);
      if (!old.name.includes('تجريبي')) throw new Error('Refusing to rename a non-demo record');
      const name = `${nameset[field]} — تجريبي`;
      if (old.name !== name)
        await updateCatalogItem(owner, randomUUID(), entity, old.id, {
          name,
          active: old.active,
          expected_version: old.version,
        });
    }
    const product = await getCatalogItem(owner, 'products', fixture[`product-${i}`].result.id);
    const raw = await getCatalogItem(owner, 'products', fixture[`raw-${i}`].result.id);
    const recipes = await listRecipes(owner, product.id);
    const active = recipes.items.find((r) => r.active);
    if (!active) throw new Error('Active demo recipe missing');
    if (active.product_snapshot.name === product.name && active.raw_snapshot.name === raw.name)
      continue;
    let next = recipes.items.find(
      (r) =>
        r.status === 'draft' &&
        r.product_snapshot.name === product.name &&
        r.raw_snapshot.name === raw.name,
    );
    if (!next) {
      const created = await createRecipe(owner, randomUUID(), product.id, {
        expected_version: product.version,
        raw_product_id: raw.id,
        policy: active.policy,
        note: 'توحيد أسماء العرض التجريبي؛ مدد المحاكاة كما هي.',
      });
      next = created.recipe;
    }
    const latest = await getCatalogItem(owner, 'products', product.id);
    const settings = await getFactorySettings(owner);
    await approveRecipe(owner, randomUUID(), product.id, next.id, {
      expected_version: latest.version,
      settings_version: settings.version,
      note: 'اعتماد تسمية تجريبية محدثة؛ ليست وصفة تشغيل فعلي',
      process_confirmed: true,
    });
    console.log(product.name);
  }
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : 'Rename failed');
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
